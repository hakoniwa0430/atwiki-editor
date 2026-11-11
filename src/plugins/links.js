'use strict';
const { escapeHtml: esc, colorValue, parameters } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, id, inline, link } = ctx;
  const { parts, flags, values: v } = parameters(args);
  if (name === 'aname' || name === 'anchor') {
    const anchor = id(parts[0]);
    if (anchor !== parts[0]) warn('アンカー名の重複');
    const label = inline(body || '', depth + 1);
    return `<span id="${esc(anchor)}" data-atwiki-anchor="true">${v.option === 'nolink' ? label : `<a href="#${esc(anchor)}">${label || '⚓'}</a>`}</span>`;
  }
  if (name === 'link' || name === 'blanklink')
    return link(args, body || args, depth + 1, false, name === 'blanklink');
  if (name === 'link2') {
    const url = flags.find((s) => /^https?:\/\//i.test(s)),
      label = flags.find((s) => s !== 'button' && !/^https?:\/\//.test(s)) || url || '';
    const style =
      (colorValue(v.color) ? 'color:' + v.color + ';' : '') +
      (colorValue(v.bgcolor) ? 'background-color:' + v.bgcolor + ';' : '') +
      (colorValue(v.bordercolor) ? 'border:1px solid ' + v.bordercolor + ';' : '');
    return link(label, url || label, depth + 1, false, v.target === 'blank').replace(
      '<a ',
      '<a title="' +
        esc(v.title || '') +
        '" style="' +
        esc(style) +
        '"' +
        (flags.includes('button') ? ' class="link-button"' : '') +
        ' ',
    );
  }
  if (name === 'link_anchor' || name === 'link_aname') {
    const anchor = flags[0] || '';
    const page = v.anchor_only === 'true' ? '' : v.page || '';
    if (v.img) {
      const src = ctx.options.resolveImage?.(v.img, undefined, ctx.sourcePage);
      if (src)
        return link(
          '<img src="' + esc(src) + '" alt="' + esc(body || anchor) + '">',
          page + '#' + anchor,
          depth + 1,
          true,
        );
      warn('画像の参照先を解決できません: ' + v.img);
    }
    return link(body || anchor, `${page}#${anchor}`, depth + 1);
  }
  if (name === 'mailto' || name === 'link_mail')
    return link(body || parts[0], `mailto:${parts[0]}`, depth + 1);
  if (name === 'tel' || name === 'link_tel')
    return link(body || parts[0], `tel:${parts[0]}`, depth + 1);
  if (name === 'footnote') return ctx.footnote(args, body);
  return null;
}
module.exports = {
  plugin,
  names:
    'aname anchor link blanklink link2 link_anchor link_aname mailto link_mail tel link_tel footnote'.split(
      ' ',
    ),
};
