'use strict';
const path = require('node:path');
const { pageNameFromFile } = require('./page-context');
const crypto = require('node:crypto');
const { createPayload } = require('./preview-data');
const { previewHtml } = require('./preview-html');
const { createPreviewUpdate } = require('./preview-update');
function openPreviewSession({
  vscode,
  context,
  editor,
  document,
  key,
  previews,
  pageRoots,
  index,
  loadScripts,
  resolvePage,
}) {
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');
  const root =
    pageRoots.get(key) ||
    vscode.workspace.getWorkspaceFolder?.(document.uri)?.uri ||
    vscode.Uri.joinPath(document.uri, '..');
  const pageName = pageNameFromFile(
    root.fsPath || path.dirname(document.fileName),
    document.fileName,
  );
  const panel = vscode.window.createWebviewPanel(
    'atwikiPreview',
    `@wiki: ${path.basename(document.fileName)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      localResourceRoots: document.isUntitled ? [media] : [media, root],
      retainContextWhenHidden: true,
    },
  );
  const config = () => vscode.workspace.getConfiguration('atwiki.preview', document.uri);
  panel.iconPath = {
    light: vscode.Uri.joinPath(media, 'icons/atwiki-light.svg'),
    dark: vscode.Uri.joinPath(media, 'icons/atwiki-dark.svg'),
  };
  let displayMode,
    disposed = false;
  const rememberKey = 'atwiki.remember:' + key;
  const remembered = { ...(context.workspaceState?.get(rememberKey, {}) || {}) };
  const nonce = crypto.randomBytes(20).toString('hex');
  // Separate from the script nonce, which is also used inside sandboxed user scripts.
  const messageToken = crypto.randomBytes(32).toString('hex');
  function postMessage(message) {
    if (disposed) return;
    return panel.webview.postMessage({
      ...message,
      ...(message.type === 'render' ? { remembered } : {}),
      token: messageToken,
    });
  }
  const state = { panel, update, scroll, anchor: null, ready: false };
  previews.set(key, state);
  const payload = createPayload({
    vscode,
    document,
    root,
    pageName,
    panel,
    config,
    mode: () => displayMode,
    nonce,
    index,
    loadScripts,
  });
  const updates = createPreviewUpdate({
    payload,
    send: postMessage,
    delay: () => config().get('updateDelay', 200),
    onError: (error) =>
      vscode.window.showErrorMessage?.(
        `アットウィキのプレビューを更新できません: ${error.message}`,
      ),
    async afterRender(current) {
      const anchor = state.anchor;
      if (!anchor) return;
      await postMessage({
        type: 'anchor',
        anchor,
        generatedAnchor: state.generatedAnchor === true,
      });
      if (current() && state.anchor === anchor) state.anchor = null;
    },
  });
  function update(immediate = false) {
    return updates.update(immediate);
  }
  const releaseIndex = document.isUntitled
    ? () => {}
    : index.retain(root.fsPath || path.dirname(document.fileName), update);
  function scroll(line) {
    if (config().get('syncScroll', true)) postMessage({ type: 'scroll', line });
  }
  const receive = panel.webview.onDidReceiveMessage(async (message) => {
    if (disposed || !message || typeof message !== 'object') return;
    try {
      if (
        message.type === 'remember' &&
        typeof message.id === 'string' &&
        message.id.length < 200 &&
        typeof message.open === 'boolean' &&
        !['__proto__', 'constructor', 'prototype'].includes(message.id)
      ) {
        remembered[message.id] = message.open;
        await context.workspaceState?.update(rememberKey, remembered);
      }
      if (message.type === 'attachment' && typeof message.path === 'string')
        await require('./attachments').openAttachment(vscode, root, message.path);
      if (message.type === 'reload')
        index.invalidate(root.fsPath || path.dirname(document.fileName));
      if (message.type === 'ready' || message.type === 'reload') {
        state.ready = true;
        await update(true);
      }
      if (message.type === 'mode' && ['desktop', 'mobile'].includes(message.mode)) {
        displayMode = message.mode;
        await update(true);
      }
      if (message.type === 'page' && typeof message.page === 'string' && !document.isUntitled) {
        const hash = message.page.indexOf('#');
        const name = hash < 0 ? message.page : message.page.slice(0, hash);
        let anchor = hash < 0 ? '' : message.page.slice(hash + 1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          /* literal malformed percent escape */
        }
        const resolved = await resolvePage(
          root.fsPath || path.dirname(document.fileName),
          name,
          document.fileName,
          (await index.get(root.fsPath || path.dirname(document.fileName))).pages,
        );
        if (!resolved) {
          vscode.window.showInformationMessage(`ローカルページが見つかりません: ${name}`);
          return;
        }
        const target = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved.file));
        pageRoots.set(target.uri.toString(), vscode.Uri.file(resolved.root));
        const targetEditor = await vscode.window.showTextDocument(target, {
          viewColumn:
            message.newWindow === true
              ? vscode.ViewColumn.Beside
              : editor.viewColumn || vscode.ViewColumn.One,
        });
        if (
          Number.isInteger(message.line) &&
          message.line >= 0 &&
          message.line < target.lineCount
        ) {
          const position = new vscode.Position(message.line, 0);
          targetEditor.selection = new vscode.Selection(position, position);
          targetEditor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
          );
        }
        await vscode.commands.executeCommand('atwiki.openPreview');
        if (anchor) {
          const next = previews.get(target.uri.toString());
          if (next) {
            next.anchor = anchor;
            next.generatedAnchor = message.generatedAnchor === true;
            if (next.ready) await next.update(true);
          }
        }
      }
      if (message.type === 'back')
        await vscode.commands.executeCommand('workbench.action.navigateBack');
      if (message.type === 'forward')
        await vscode.commands.executeCommand('workbench.action.navigateForward');
      if (
        message.type === 'reveal' &&
        Number.isInteger(message.line) &&
        message.line >= 0 &&
        message.line < document.lineCount
      ) {
        const target = await vscode.window.showTextDocument(document, {
          viewColumn: editor.viewColumn || vscode.ViewColumn.One,
          preserveFocus: false,
        });
        const position = new vscode.Position(message.line, 0);
        target.selection = new vscode.Selection(position, position);
        target.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
      }
      if (
        message.type === 'external' &&
        typeof message.url === 'string' &&
        /^(https?:\/\/|mailto:|tel:)/i.test(message.url) &&
        !/[\x00-\x20]/.test(message.url)
      ) {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(message.url, true));
        } catch {
          /* malformed links are ignored */
        }
      }
    } catch (error) {
      if (!disposed)
        vscode.window.showErrorMessage?.('アットウィキの操作に失敗しました: ' + error.message);
    }
  });
  panel.onDidDispose(() => {
    disposed = true;
    updates.dispose();
    releaseIndex();
    receive.dispose();
    previews.delete(key);
  });
  panel.webview.html = previewHtml(vscode, panel, media, nonce, messageToken);
}
module.exports = { openPreviewSession };
