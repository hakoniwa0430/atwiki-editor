'use strict';
const { escapeHtml: esc, colorValue, lengthValue, parameters, safeStyle } = require('../syntax');
const TAGS = {
  bold: 'strong',
  b: 'strong',
  strong: 'strong',
  italic: 'em',
  i: 'em',
  u: 'u',
  underline: 'u',
  del: 'del',
  s: 's',
  strike: 's',
  sub: 'sub',
  sup: 'sup',
  small: 'small',
  big: 'big',
  tt: 'code',
  address: 'address',
  cite: 'cite',
  q: 'q',
};
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body, block } = p;
  const { warn, id, inline } = ctx;
  const { parts, flags, values: v } = parameters(args);
  const text = body ?? args;

  const span = (style, html = inline(body ?? '', depth + 1)) =>
    `<span style="${esc(style)}">${html}</span>`;
  if (Object.hasOwn(TAGS, name)) return `<${TAGS[name]}>${inline(text, depth + 1)}</${TAGS[name]}>`;
  if (name === 'co' || name === 'furigana') return '';
  if (name === 'br') return '<br>';
  if (name === 'hr')
    return `<hr style="${esc((lengthValue(v.width) ? `width:${lengthValue(v.width)};` : '') + (lengthValue(v.height) ? `height:${lengthValue(v.height)};` : '') + (colorValue(v.color) ? `background-color:${v.color};border-color:${v.color};` : ''))}">`;
  if (name === 'nowiki' || name === 'nolink')
    return block ? `<div style="white-space:pre-wrap">${esc(text)}</div>` : esc(text);
  if (name === 'tab' || name === 't') return '\t';
  if (name === 'mark_reg') return '®';
  if (name === 'mark_copy') return '©';
  if (name === 'space' || name === 'nbsp')
    return (flags.length ? flags : ['1'])
      .map((s) => (s === 'br' ? '<br>' : '&nbsp;'.repeat(Math.min(100, Math.max(1, +s || 1)))))
      .join('');
  if (name === 'clear') return '<div style="clear:both"></div>';
  if (name === 'color' || name === 'bgcolor') {
    const fg = colorValue(parts[0]),
      bg = colorValue(parts[1]);
    if (!fg || (parts[1] && !bg)) warn(`${name} の無効な色指定`);
    return span(
      `${fg ? `${name === 'bgcolor' ? 'background-color' : 'color'}:${fg};` : ''}${bg ? `background-color:${bg};` : ''}`,
    );
  }
  if (name === 'size') {
    const size = lengthValue(args);
    if (!size) warn('size の無効なサイズ');
    return span(size ? `font-size:${size};` : '');
  }
  if (name === 'sizex') {
    const sizes = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large'];
    const index = args === '0' ? 3 : /^[+-]\d$/.test(args) ? +args + 3 : +args - 1;
    const size = sizes.includes(args) ? args : sizes[index];
    if (!size) warn('sizex の無効なサイズ');
    return span(`font-size:${size || 'medium'};`);
  }
  if (name === 'nobold') return span('font-weight:normal;');
  if (name === 'underdot')
    return span(
      `border-bottom:${flags.find((s) => /^[1-9]px$/.test(s)) || '1px'} dotted ${flags.find(colorValue) || 'currentColor'};`,
    );
  if (name === 'font') {
    let style = '',
      colors = 0;
    const decorations = [];
    for (const value of flags) {
      if (value === 'b') style += 'font-weight:bold;';
      else if (value === 'i') style += 'font-style:italic;';
      else if (['u', 'o', 'l'].includes(value))
        decorations.push({ u: 'underline', o: 'overline', l: 'line-through' }[value]);
      else if (lengthValue(value)) style += `font-size:${lengthValue(value)};`;
      else if (colorValue(value)) style += `${colors++ ? 'background-color' : 'color'}:${value};`;
      else warn(`font の指定: ${value}`);
    }
    if (decorations.length) style += `text-decoration:${decorations.join(' ')};`;
    return span(style);
  }
  if (name === 'ruby')
    return `<ruby>${inline(body || '', depth + 1)}<rp>（</rp><rt>${esc(args)}</rt><rp>）</rp></ruby>`;
  if (
    [
      'spanclass',
      'spanid',
      'spanstyle',
      'div',
      'divclass',
      'divid',
      'divstyle',
      'style',
      'expand',
      'left',
      'right',
      'center',
      'blockquote',
    ].includes(name)
  ) {
    const tag = name.startsWith('span') ? 'span' : name === 'blockquote' ? 'blockquote' : 'div';
    let attrs = '',
      style = '';
    if (name.endsWith('class'))
      attrs += ` class="${esc(parts.map((s) => 'wiki-' + s.replace(/[^\w-]/g, '')).join(' '))}"`;
    if (name.endsWith('id')) attrs += ` id="${esc(id(args))}"`;
    if (name.endsWith('style') || name === 'style') style = safeStyle(args, warn);
    if (['left', 'right', 'center'].includes(name)) style = `text-align:${name};`;
    if (name === 'expand' && lengthValue(args))
      style = `width:${lengthValue(args)};max-width:none;`;
    if (name === 'div') {
      if (v.id) attrs += ` id="${esc(id(v.id))}"`;
      if (v.class) attrs += ` class="wiki-${esc(v.class.replace(/[^\w-]/g, ''))}"`;
      for (const k of ['width', 'height'])
        if (lengthValue(v[k])) style += `${k}:${lengthValue(v[k])};`;
      for (const k of ['color', 'bgcolor'])
        if (colorValue(v[k])) style += `${k === 'color' ? k : 'background-color'}:${v[k]};`;
    }
    return `<${tag}${attrs}${style ? ` style="${esc(style)}"` : ''}>${ctx.renderBody(p, depth, line)}</${tag}>`;
  }
  return null;
}
module.exports = {
  plugin,
  names: [
    ...Object.keys(TAGS),
    ...'br hr co furigana nowiki nolink tab t mark_reg mark_copy space nbsp clear color bgcolor size sizex font nobold underdot ruby spanclass spanid spanstyle div divclass divid divstyle style expand left right center blockquote'.split(
      ' ',
    ),
  ],
};
