'use strict';
const { escapeHtml: esc, parameters } = require('../syntax');
const { sanitizeHtml } = require('../safe-html');
const katex = require('../../vendor/katex/katex-bundle');
const highlight = require('../../vendor/highlight');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body, block } = p;
  const { warn, id, options } = ctx;
  const { flags } = parameters(args);
  const text = body ?? args;
  if (name === 'html' || name === 'html2')
    return sanitizeHtml(text, { ...options, makeId: id }, warn);
  if (name === 'asciiart' || name === 'aa') {
    const html = `<pre class="asciiart">${esc(body || '')}</pre>`;
    return flags.includes('blockquote') ? `<blockquote>${html}</blockquote>` : html;
  }
  if (name === 'highlight' || name === 'codehighlight') {
    const lang = flags.find((s) => s !== 'linenumber'),
      source = (body || '').replace(/^\n|\n$/g, '');
    let code;
    if (lang && !highlight.getLanguage(lang)) {
      warn(`ハイライトの言語定義がありません: ${lang}`);
      code = esc(source);
    } else
      code = lang
        ? highlight.highlight(source, { language: lang, ignoreIllegals: true }).value
        : highlight.highlightAuto(source).value;
    return `<div class="source-code">${
      flags.includes('linenumber')
        ? `<pre class="line-number" aria-hidden="true">${source
            .split('\n')
            .map((s, i) => i + 1)
            .join('\n')}</pre>`
        : ''
    }<pre><code class="hljs">${code}</code></pre></div>`;
  }
  if (name === 'math' || name === 'tex') {
    try {
      return katex.renderToString(body ?? args, {
        displayMode: block,
        throwOnError: true,
        trust: false,
        strict: 'ignore',
        maxExpand: 1000,
        maxSize: 50,
      });
    } catch (error) {
      warn(`数式: ${error.message}`);
      return `<code class="unsupported">${esc(body ?? args)}</code>`;
    }
  }
  if (name === 'icon_fa') return ctx.icon(args);
  return null;
}
module.exports = {
  plugin,
  names: 'html html2 asciiart aa highlight codehighlight math tex icon_fa'.split(' '),
};
