'use strict';
const completion = require('./completion');
function candidates(prefix, pages = {}, ownText = '', images = [], pageName = '') {
  return completion.candidates(prefix, { pages, ownText, images, pageName });
}
function registerLanguageFeatures(vscode, context, index, roots) {
  completion.registerCompletion(vscode, context, index, roots);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: 'atwiki' }, { language: 'plaintext', pattern: '**/*.txt', scheme: 'file' }],
      {
        provideHover(document, position) {
          const line = document.lineAt(position.line).text;
          let prefix = '';
          for (let i = 0; i <= position.line; i++)
            prefix +=
              document
                .lineAt(i)
                .text.slice(0, i === position.line ? position.character : undefined) +
              (i === position.line ? '' : '\n');
          const q = completion.query(prefix);
          const name = q?.name || line.match(/[&#](\w+)/)?.[1];
          if (!name || !completion.names.includes(name.replace(/_body$/, ''))) return;
          const option = line.slice(0, position.character).match(/([\w]+)$/)?.[1];
          const detail = name.startsWith('slide_img')
            ? 'width は290以上、height は200以上'
            : Object.entries(completion.descriptions)
                .filter(([k]) => option && k.startsWith(option))
                .map(([k, v]) => k + ': ' + v)
                .join(' / ');
          const text = new vscode.MarkdownString();
          text.appendText(
            name.replace(/_body$/, '') +
              ': ' +
              (detail ||
                (completion.options[name]
                  ? '対応オプション: ' + completion.options[name]
                  : 'ローカルプレビュー対応記法')),
          );
          text.isTrusted = false;
          return new vscode.Hover(text);
        },
      },
    ),
  );
}
module.exports = { candidates, registerLanguageFeatures };
