'use strict';
const { escapeHtml, safeStyle } = require('./syntax');
const ALLOWED = new Set(
  'a abbr address b bdi bdo blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr'.split(
    ' ',
  ),
);
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
function decode(value) {
  return value.replace(/&(?:#(x[\da-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (raw, n) =>
    n
      ? String.fromCodePoint(
          Math.min(0x10ffff, n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n),
        )
      : { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[
          raw.toLowerCase()
        ] || raw,
  );
}
function sanitizeHtml(source, options = {}, warn = () => {}) {
  const stack = [];
  let html = '',
    pos = 0;
  const tokens = /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
  for (const match of source.matchAll(tokens)) {
    html += escapeHtml(decode(source.slice(pos, match.index)));
    pos = match.index + match[0].length;
    const raw = match[0],
      tag = raw.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
    if (!tag) continue;
    if (!ALLOWED.has(tag)) {
      warn(`HTMLの実行・埋め込み要素を除外: ${tag}`);
      continue;
    }
    if (raw.startsWith('</')) {
      const at = stack.lastIndexOf(tag);
      if (at >= 0) while (stack.length > at) html += `</${stack.pop()}>`;
      continue;
    }
    let attrs = '';
    const rest = raw.slice(raw.toLowerCase().indexOf(tag) + tag.length, -1);
    for (const a of rest.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const key = a[1].toLowerCase(),
        value = decode(a[2] ?? a[3] ?? a[4] ?? '');
      if (['title', 'alt', 'dir', 'lang'].includes(key)) attrs += ` ${key}="${escapeHtml(value)}"`;
      else if (key === 'id') attrs += ` id="${escapeHtml(options.makeId?.(value) || value)}"`;
      else if (key === 'class')
        attrs += ` class="${escapeHtml(
          value
            .split(/\s+/)
            .map((v) => `wiki-${v.replace(/[^\w-]/g, '')}`)
            .join(' '),
        )}"`;
      else if (key === 'style') attrs += ` style="${escapeHtml(safeStyle(value, warn))}"`;
      else if (
        ['width', 'height', 'colspan', 'rowspan', 'start', 'value'].includes(key) &&
        /^\d{1,5}%?$/.test(value)
      )
        attrs += ` ${key}="${value}"`;
      else if (key === 'open' && tag === 'details') attrs += ' open';
      else if (
        key === 'href' &&
        tag === 'a' &&
        /^(https?:\/\/|mailto:|tel:|#)/i.test(value) &&
        !/[\x00-\x20]/.test(value)
      )
        attrs += ` href="${escapeHtml(value)}" rel="noopener noreferrer"`;
      else if (key === 'src' && tag === 'img') {
        const src = options.resolveImage?.(value);
        if (src) attrs += ` src="${escapeHtml(src)}"`;
        else warn('HTML画像の参照先を解決できません');
      } else warn(`HTML属性を除外: ${key}`);
    }
    html += `<${tag}${attrs}>`;
    if (!VOID.has(tag)) stack.push(tag);
  }
  html += escapeHtml(decode(source.slice(pos)));
  while (stack.length) html += `</${stack.pop()}>`;
  return html;
}
module.exports = { sanitizeHtml, decode };
