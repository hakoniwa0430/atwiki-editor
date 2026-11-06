'use strict';
const { escapeHtml } = require('./syntax');
const { FRAME_ORIGINS } = require('./plugins/external');
function previewHtml(vscode, panel, media, nonce, messageToken) {
  const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'preview.css'));
  const themeCss = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'uikit-preview.css'));
  const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'preview.js'));
  const interactions = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'interactions.js'));
  const dateFormat = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'date-format.js'));
  const featureScripts = [
    'tables',
    'calculator',
    'calendar',
    'images',
    'presentation',
    'clock',
    'external',
  ].map((name) =>
    panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'interactions', name + '.js')),
  );
  const mathCss = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(media, 'vendor/katex/katex.min.css'),
  );
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="atwiki-message-token" content="${messageToken}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https:; font-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src 'self' ${FRAME_ORIGINS}; connect-src https://*.twitter.com https://*.x.com;"><link rel="stylesheet" href="${escapeHtml(mathCss)}"><link rel="stylesheet" href="${escapeHtml(css)}"><link rel="stylesheet" href="${escapeHtml(themeCss)}"><title>アットウィキ プレビュー</title></head><body class="uikit" id="atwiki-top"><header class="toolbar"><span class="brand">@wiki <b>LOCAL PREVIEW</b></span><span id="filename"></span><span id="status" role="status">読み込み中</span></header><details id="warnings" class="warnings" hidden><summary>未対応・注意事項 <span id="warning-count"></span></summary><ul id="warning-list"></ul></details><main id="content" aria-label="アットウィキのプレビュー"></main>${[dateFormat, ...featureScripts].map((src) => `<script nonce="${nonce}" src="${escapeHtml(src)}"></script>`).join('')}<script nonce="${nonce}" src="${escapeHtml(interactions)}"></script><script nonce="${nonce}" src="${escapeHtml(js)}"></script></body></html>`;
}
module.exports = { previewHtml };
