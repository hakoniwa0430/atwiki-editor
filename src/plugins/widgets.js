'use strict';
const {
  escapeHtml: esc,
  colorValue,
  lengthValue,
  parameters,
  splitTop,
  safeStyle,
} = require('../syntax');
const { image } = require('./images');
const qrcode = require('../../vendor/qrcode');
qrcode.stringToBytes = (text) => [...Buffer.from(text, 'utf8')];
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, options, inline, blocks, link } = ctx;
  const { flags, values: v } = parameters(args);
  const text = body ?? args;

  if (name === 'openclose' || name === 'openclose2') {
    const label = inline(v.show || '表示', depth + 1);
    if (name === 'openclose2')
      return `<span class="inline-toggle"><button type="button" data-toggle aria-expanded="${flags.includes('inline')}">${label}</button><span${flags.includes('inline') ? '' : ' hidden'}>${inline(body || '', depth + 1)}</span></span>`;
    return `<details data-line="${line}"${flags.includes('block') ? ' open' : ''} style="${esc(safeStyle(flags.filter((s) => s.includes(':')).join(';'), warn))}"><summary>${label}</summary>${ctx.renderBody(p, depth, line)}</details>`;
  }
  if (name.startsWith('treemenu')) {
    const separator = name === 'treemenu2' ? '|' : ',';
    let items =
      name === 'treemenu' ? flags.filter((s) => s !== 'none') : splitTop(body || '', separator);
    if (name === 'treemenu3')
      items = items.map((s) => s.replace(/^%+/, (m) => '-'.repeat(m.length)));
    const list =
      name === 'treemenu3'
        ? blocks(items.join('\n'), line, depth + 1)
        : `<ul>${items.map((s) => `<li>${inline(s, depth + 1)}</li>`).join('')}</ul>`;
    return `<details${v.flag === 'ex' ? ` data-remember="${ctx.id('tree:' + line)}"` : ''} class="tree-menu${v.treeline === '0' ? ' no-tree-lines' : ''}"${flags.includes('none') ? '' : ' open'} data-line="${line}"><summary>${v.mark && /^https?:/.test(v.mark) ? (options.resolveImage?.(v.mark) ? `<img src="${esc(options.resolveImage(v.mark))}" alt="">` : '') : esc(v.mark || '■')} ${inline(v.title || 'TreeMenu', depth + 1)}</summary>${list}</details>`;
  }
  if (name === 'tooltip')
    return `<span class="tooltip" tabindex="0" title="${esc(body || '')}">${inline(flags[0] || 'ⓘ', depth + 1)}<span class="tooltip-content">${inline(body || '', depth + 1)}</span></span>`;
  if (name === 'infobox') {
    const pic = (url) => image({ name: 'image', args: `${url},inline` }, ctx, depth);
    const title = /^https:\/\//.test(v.title || '')
      ? pic(v.title)
      : inline(v.title || 'ⓘ', depth + 1);
    let inside = (v.url ? pic(v.url) : '') + inline(body || '', depth + 1);
    if (v.link) inside = link(inside, v.link, depth + 1, true);
    const gravity = ['south', 'north', 'west', 'east'].includes(v.gravity) ? v.gravity : 'south',
      size = ['small', 'large'].includes(v.size) ? v.size : 'medium',
      animation = ['fadein', 'flipin'].includes(v.animation) ? v.animation : 'none';
    return `<span class="infobox gravity-${gravity} size-${size} animation-${animation}" data-trigger="${v.trigger === 'hover' ? 'hover' : 'click'}"><button type="button" data-infobox aria-expanded="false">${title}</button><span class="info-content" style="opacity:${animation === 'none' && v.opacity !== undefined ? Math.min(1, Math.max(0, +v.opacity || 0)) : 1}">${inside}</span></span>`;
  }
  if (name === 'marquee') {
    const mode = flags.find((s) => ['scroll', 'slide', 'alternate'].includes(s)) || 'scroll',
      dir = flags.includes('right') ? 'right' : 'left';
    const label = flags
      .filter((s) => !['scroll', 'slide', 'alternate', 'left', 'right'].includes(s))
      .join(',');
    const style =
      (lengthValue(v.size) ? `font-size:${lengthValue(v.size)};` : '') +
      (colorValue(v.color) ? `color:${v.color};` : '') +
      (colorValue(v.bgcolor) ? `background-color:${v.bgcolor};` : '');
    return `<div class="marquee" style="${esc(style)}"><span class="marquee-${mode} marquee-${dir}" style="animation-iteration-count:${/^\d+$/.test(v.loop) ? +v.loop : mode === 'slide' ? 1 : 'infinite'}">${inline(label, depth + 1)}</span></div>`;
  }
  if (name === 'arrow') return ['', '↙', '↓', '↘', '←', 'N', '→', '↖', '↑', '↗'][+args] || '';
  if (name === 'qr') {
    try {
      const code = qrcode(0, 'M');
      const value = body || args || options.wikiUrl;
      if (!value) {
        warn('QRコード: wikiUrl を設定してください');
        return '';
      }
      code.addData(value, 'Byte');
      code.make();
      return code
        .createSvgTag({ cellSize: 4, margin: 16, scalable: true })
        .replace('<svg ', '<svg class="qr-code" role="img" aria-label="QRコード" ');
    } catch (error) {
      warn(`QRコード: ${error.message || error}`);
      return `<code>${esc(text)}</code>`;
    }
  }
  if (name === 'calc')
    return '<div class="calculator"><label>計算式 <input type="text" inputmode="decimal" aria-label="計算式"></label><button type="button" data-calculate>計算</button><output aria-live="polite"></output></div>';
  if (name === 'search_plugin')
    return `<div class="local-search"><label>記法検索 <input type="search" data-local-search></label><ul>${require('../plugins')
      .LOCAL_NAMES.slice()
      .sort()
      .map((s) => `<li data-search-text="${s}"><code>${s}</code></li>`)
      .join('')}</ul></div>`;
  if (name === 'google')
    return '<span class="google-search"><label>Google検索 <input type="search"></label><button type="button" data-google-search>検索</button></span>';
  return null;
}
module.exports = {
  plugin,
  names:
    'openclose openclose2 treemenu treemenu2 treemenu3 tooltip infobox marquee arrow qr calc search_plugin google'.split(
      ' ',
    ),
};
