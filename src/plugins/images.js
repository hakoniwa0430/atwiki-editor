'use strict';
const { escapeHtml: esc, lengthValue, parameters, splitTop } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, options, inline, link } = ctx;
  const { parts, flags, values: v } = parameters(args);
  const text = body ?? args;
  if (['image', 'image2', 'ref', 'blankimg', 'lightbox', 'gyazo'].includes(name))
    return image(p, ctx, depth);
  if (name === 'random_img') {
    const candidates = (body ? splitTop(body) : flags).filter(Boolean);
    return candidates.length
      ? image(
          {
            ...p,
            name: 'image',
            args: [
              candidates[Math.floor((options.random?.() ?? Math.random()) * candidates.length)],
              ...Object.entries(v).map(([k, value]) => k + '=' + value),
            ].join(','),
          },
          ctx,
          depth,
        )
      : '';
  }
  if (name === 'slide_img' || name === 'img_slide') {
    const candidates =
      name === 'img_slide'
        ? options.images || []
        : splitTop(body || '')
            .map((s) => s.trim())
            .filter(Boolean);
    if (!candidates.length) warn(`${name}: 表示できるローカル画像がありません`);
    const images = candidates.map((src) =>
      image(
        {
          ...p,
          name: 'image',
          args: [src, ...parts.filter((s) => /^(width|height)=/.test(s)), 'inline'].join(','),
          body: null,
        },
        ctx,
        depth,
      ),
    );
    return `<div class="image-slides" data-auto="${!!v.auto}" data-interval="${Math.max(1, +v.auto || +v.time || +v.interval || 3) * 1000}" data-slide="0" style="text-align:${['left', 'right', 'center'].includes(v.position) ? v.position : 'left'}"><div class="slide-items">${images.map((html, i) => `<div${i ? ' hidden' : ''}>${html}</div>`).join('')}</div><button type="button" data-slide-step="-1">前へ</button><button type="button" data-slide-step="1">次へ</button><button type="button" data-slide-play>再生 / 停止</button></div>`;
  }
  return null;
}
function image(p, ctx, depth) {
  const {
    parts,
    flags,
    values: v,
  } = parameters(p.args + (p.name === 'gyazo' && p.body ? ',' + p.body : ''));
  let input = parts[0];
  if (p.name === 'gyazo' && /^https:\/\/gyazo.com\/[a-f0-9]+$/.test(input))
    input = input.replace('gyazo.com/', 'i.gyazo.com/') + '.png';
  const positionalPage =
    p.name === 'ref'
      ? flags
          .slice(1)
          .find(
            (s) =>
              !['left', 'right', 'center', 'inline', 'float', 'blank'].includes(s) &&
              !/^https?:\/\//i.test(s),
          )
      : undefined;
  if (p.name === 'ref' && !/\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:[?#]|$)/i.test(input)) {
    const attachment = ctx.options.resolveAttachment?.(
      input,
      v.page || positionalPage,
      ctx.sourcePage,
    );
    if (attachment)
      return (
        '<a href="#" data-attachment="' + esc(attachment) + '">' + esc(v.title || input) + '</a>'
      );
    ctx.warn('添付ファイルの参照先を解決できません: ' + input);
    return '<span class="unsupported">' + esc(input) + '</span>';
  }
  const src = ctx.options.resolveImage?.(input, v.page || positionalPage, ctx.sourcePage);
  if (!src) {
    ctx.warn(`画像の参照先を解決できません: ${input}`);
    return `<span class="unsupported">画像: ${esc(input)}</span>`;
  }
  const width = lengthValue(v.width || v.x || (p.name === 'blankimg' ? '128' : '')),
    height = lengthValue(v.height || v.y || (p.name === 'blankimg' ? '128' : '')),
    align = flags.find((s) => ['left', 'center', 'right'].includes(s));
  let style = (width ? `width:${width};` : '') + (height ? `height:${height};` : '');
  if (v.percent && /^\d+$/.test(v.percent)) style += `width:${Math.min(1000, +v.percent)}%;`;
  if (/^[1-9]$/.test(v.border)) style += `border:${v.border}px solid currentColor;`;
  let html = `<img src="${esc(src)}" alt="${esc(v.alt || input)}"${v.title ? ` title="${esc(v.title)}"` : ''}${style ? ` style="${style}"` : ''} loading="lazy">`;
  if (p.name === 'lightbox' || p.name === 'blankimg')
    html = `<button class="image-popup" type="button" data-image="${esc(src)}" aria-label="${esc(v.title || input)}">${v.link === 'image' || p.name === 'blankimg' ? html : esc(v.title || 'Thumbnail')}</button>`;
  else {
    const target = v.linkpage || flags.slice(1).find((s) => /^https?:\/\//i.test(s));
    if (target) html = ctx.link(html, target, depth + 1, true, flags.includes('blank'));
  }
  if (!flags.includes('inline') && (align || p.name === 'image' || p.name === 'image2'))
    html = `<div style="text-align:${align || 'left'};${flags.includes('float') && align && align !== 'center' ? `float:${align};` : ''}">${html}</div>`;
  return html;
}
module.exports = {
  plugin,
  names: 'image image2 ref blankimg lightbox gyazo random_img slide_img img_slide'.split(' '),
  image,
};
