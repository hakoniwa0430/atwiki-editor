'use strict';

const vscode = require('vscode');
const { PageIndex } = require('./page-index');
const { openPreviewSession } = require('./preview-session');
const { loadPages, resolvePage, loadScripts } = require('./local-pages');

function activate(context) {
  require('./webp-conversion').registerWebp(vscode, context);
  const previews = new Map();
  const pageRoots = new Map();
  const syncStore = new (require('./wiki-sync').SyncStore)(
    require('node:path').join(context.globalStorageUri.fsPath, 'wiki-sync'),
  );
  require('./wiki-sync').registerWikiSync(vscode, context, { store: syncStore });
  if (vscode.workspace.createFileSystemWatcher) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(syncStore.root), '*.json'),
    );
    const invalidate = () => syncStore.invalidateMetadata();
    watcher.onDidCreate(invalidate);
    watcher.onDidChange(invalidate);
    watcher.onDidDelete(invalidate);
    context.subscriptions.push(watcher);
  }
  const index = new PageIndex({
    loadPages,
    async enrichPages(pages) {
      await Promise.all(
        Object.values(pages).map(async (page) => {
          try {
            page.sync = await syncStore.readMetadata(vscode.Uri.file(page.file).toString());
          } catch {
            /* Missing or invalid sync metadata must not prevent local previews. */
          }
        }),
      );
    },
    documents: () => vscode.workspace.textDocuments || [],
    watch: vscode.workspace.createFileSystemWatcher
      ? (root, change) => {
          const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(root), '**/*'),
          );
          watcher.onDidCreate(change);
          watcher.onDidChange(change);
          watcher.onDidDelete(change);
          return watcher;
        }
      : undefined,
  });
  context.subscriptions.push(index);
  require('./auto-link').registerAutoLink(vscode, context, index, pageRoots);
  require('./language-features').registerLanguageFeatures(vscode, context, index, pageRoots);
  require('./diagnostics').registerDiagnostics(vscode, context, index, pageRoots);
  function changed(document, disk = false) {
    if (document.uri.scheme === 'file' || !document.isUntitled)
      index.changed(document.fileName, disk);
    else previews.get(document.uri.toString())?.update();
  }
  for (const event of [
    'onDidOpenTextDocument',
    'onDidCloseTextDocument',
    'onDidSaveTextDocument',
  ]) {
    if (vscode.workspace[event])
      context.subscriptions.push(
        vscode.workspace[event]((document) => changed(document, event === 'onDidSaveTextDocument')),
      );
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('atwiki.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('プレビューするテキストファイルを開いてください。');
        return;
      }
      const document = editor.document,
        key = document.uri.toString();
      if (document.uri.scheme !== 'file' && !document.isUntitled) {
        vscode.window.showInformationMessage('ローカルファイルを開いてください。');
        return;
      }
      if (previews.has(key)) {
        previews.get(key).panel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      openPreviewSession({
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
      });
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => changed(event.document)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('atwiki.preview'))
        for (const preview of previews.values()) preview.update(true);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      if (event.visibleRanges.length)
        previews
          .get(event.textEditor.document.uri.toString())
          ?.scroll(event.visibleRanges[0].start.line);
    }),
    {
      dispose() {
        for (const preview of [...previews.values()]) preview.panel.dispose();
      },
    },
  );
}

module.exports = { activate };
