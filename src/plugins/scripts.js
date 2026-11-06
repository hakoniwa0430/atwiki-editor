'use strict';
const { escapeHtml: esc, parameters } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, options, inline } = ctx;

  if (name === 'include_js') {
    const script = options.scripts?.[args];
    if (script === undefined) {
      warn(`include_js: ローカルJSファイルが見つからないか読み込み範囲外です: ${args}`);
      return `<code class="unsupported">${esc(p.raw || args)}</code>`;
    }
    return plugin({ ...p, name: 'javascript', body: script, args: '' }, ctx, depth, line);
  }
  if (name === 'javascript' || name === 'js') {
    const nonce = options.scriptNonce || 'local-script';
    const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';"></head><body><script nonce="${nonce}">${body || args}</script></body></html>`;
    return `<iframe title="JavaScript ローカルプレビュー（隔離実行）" sandbox="allow-scripts" srcdoc="${esc(document)}"></iframe>`;
  }
  return null;
}
module.exports = { plugin, names: 'include_js javascript js'.split(' ') };
