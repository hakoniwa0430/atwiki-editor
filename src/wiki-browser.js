'use strict';

function registerWikiBrowser(vscode, context, store) {
  for (const [command, route] of [
    ['openWikiPageInBrowser', 'pages'],
    ['openWikiUploadInBrowser', 'upload'],
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand('atwiki.' + command, async (uri) => {
        try {
          const target = uri || vscode.window.activeTextEditor?.document.uri;
          if (!target || target.scheme !== 'file') {
            vscode.window.showInformationMessage('本家ページに連携したファイルを開いてください。');
            return;
          }
          const entry = await store.read(target.toString());
          if (!entry) {
            vscode.window.showInformationMessage(
              'このファイルは本家ページに未連携です。「Wikiの全ページを取得・同期」を実行してください。',
            );
            return;
          }
          const url = `https://w.atwiki.jp/${entry.wiki}/${route}/${entry.page.pageid}.html`;
          if (!(await vscode.env.openExternal(vscode.Uri.parse(url))))
            throw Error('既定のブラウザを開けませんでした。');
        } catch (error) {
          vscode.window.showErrorMessage(`ブラウザで開けませんでした: ${error.message}`);
        }
      }),
    );
  }
}

module.exports = { registerWikiBrowser };
