'use strict';
const { pageNameFromFile, filePageRoot } = require('./page-context');
const { readPlugin } = require('./syntax');

const DEFAULT_EXCLUDED = [
  'トップページ',
  'メニュー',
  '右メニュー',
  'ヘルプ',
  'まとめサイト作成支援ツール',
  '更新履歴',
];

function autoLink(source, pageNames, { currentPage = '', excludedPages = [] } = {}) {
  const excluded = new Set([...DEFAULT_EXCLUDED, ...excludedPages, currentPage]);
  const names = [...new Set(pageNames)]
    .filter(
      (name) =>
        [...name].length >= 3 &&
        !excluded.has(name) &&
        !/[\/\\\[\]<>#&|\r\n]/.test(name) &&
        !/コメント.*ログ|ログ.*コメント/.test(name),
    )
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!names.length || /コメント.*ログ|ログ.*コメント/.test(currentPage))
    return { text: source, count: 0 };
  const pattern = new RegExp(
    names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gu',
  );
  let count = 0,
    offset = 0,
    protectedUntil = 0,
    regions = 0;
  const text = source
    .split(/(?<=\n)/)
    .map((line) => {
      const start = offset;
      offset += line.length;
      if (start < protectedUntil) return line;
      if (/^\s*#region\b/i.test(line)) {
        regions++;
        return line;
      }
      if (/^\s*#endregion\b/i.test(line)) {
        regions = Math.max(0, regions - 1);
        return line;
      }
      if (regions) return line;
      // Multi-line links and math must never expose their inner lines to conversion.
      for (const match of line.matchAll(/\[\[|\$\$/g)) {
        const at = start + match.index;
        if (at < protectedUntil) continue;
        const close = source.indexOf(match[0] === '[[' ? ']]' : '$$', at + 2);
        protectedUntil = close < 0 ? source.length : close + 2;
        if (close < 0 || close + 2 > offset) {
          return line;
        }
      }
      // Protect complete multi-line plugins, including unfinished bodies while typing.
      let pluginLine = false;
      for (const match of line.matchAll(/(?:^\s*#[a-zA-Z]\w*|&[a-zA-Z]\w*(?=[({;]))/g)) {
        pluginLine = true;
        const at = start + match.index + match[0].search(/[&#]/);
        const plugin = readPlugin(source, at);
        protectedUntil = Math.max(protectedUntil, plugin ? plugin.end : source.length);
      }
      // Treat non-prose syntax conservatively (tables, HTML, preformatted text, comments).
      if (pluginLine || /^(?:\s|[*\-+#|:>]|\/\/)/.test(line) || /[<>]|\$\$/.test(line)) return line;
      // Keep existing links, URLs and incomplete links intact; only transform plain spans.
      const tokens = /(\[\[[\s\S]*?(?:\]\]|$)|(?:https?|ftp):\/\/[^\s]+|mailto:[^\s]+)/gi;
      let cursor = 0,
        result = '';
      const replace = (plain) =>
        plain.replace(pattern, (name) => {
          count++;
          return `[[${name}]]`;
        });
      for (const match of line.matchAll(tokens)) {
        result += replace(line.slice(cursor, match.index)) + match[0];
        cursor = match.index + match[0].length;
      }
      return result + replace(line.slice(cursor));
    })
    .join('');
  return { text, count };
}

function registerAutoLink(vscode, context, index, pageRoots) {
  context.subscriptions.push(
    vscode.commands.registerCommand('atwiki.autoLinkPageNames', async () => {
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (
        !document ||
        document.uri.scheme !== 'file' ||
        !/\.(atwiki|atw|txt)$/i.test(document.fileName)
      ) {
        await vscode.window.showInformationMessage(
          '自動リンクを適用する .atwiki / .atw / .txt ファイルを開いてください。',
        );
        return;
      }
      const version = document.version,
        source = document.getText();
      const root = filePageRoot(vscode, document, pageRoots);
      const release = index.retain(root, () => {});
      try {
        index.invalidate(root);
        const data = await index.get(root);
        if (data.truncated) {
          await vscode.window.showWarningMessage(
            'ページ一覧の読み込み上限を超えたため、自動リンクを中止しました。Wiki用フォルダを小さくしてください。',
          );
          return;
        }
        const result = autoLink(source, Object.keys(data.pages), {
          currentPage: pageNameFromFile(root, document.fileName),
          excludedPages: vscode.workspace
            .getConfiguration('atwiki.autoLink', document.uri)
            .get('excludedPages', []),
        });
        if (document.isClosed || document.version !== version) {
          await vscode.window.showWarningMessage(
            '処理中に本文が変更されました。自動リンクを再実行してください。',
          );
          return;
        }
        if (!result.count) {
          await vscode.window.showInformationMessage('自動リンクに変換するページ名はありません。');
          return;
        }
        const applied = await editor.edit(
          (edit) =>
            edit.replace(
              new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
              result.text,
            ),
          { undoStopBefore: true, undoStopAfter: true },
        );
        if (applied)
          await vscode.window.showInformationMessage(
            `${result.count} 箇所のページ名をリンクに変換しました。「元に戻す」で取り消せます。`,
          );
        else
          await vscode.window.showWarningMessage(
            '自動リンクを適用できませんでした。本文を確認して再実行してください。',
          );
      } catch (error) {
        await vscode.window.showErrorMessage(
          `ページ名の自動リンクに失敗しました: ${error.message}`,
        );
      } finally {
        release();
      }
    }),
  );
}

module.exports = { autoLink, registerAutoLink };
