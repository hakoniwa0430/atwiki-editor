'use strict';
const { escapeHtml: esc, colorValue, parameters } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args } = p;
  const { options } = ctx;
  const { flags, values: v } = parameters(args);

  if (['pc', 'mobile', 'exk', 'exp', 'exkp'].includes(name)) {
    const mobile = options.mode === 'mobile';
    const show =
      name === 'pc' || name === 'exk'
        ? !mobile
        : name === 'mobile' || name === 'exp'
          ? mobile
          : !(mobile ? flags.length === 0 || flags.includes('k') : flags.includes('p'));
    return show ? ctx.renderBody(p, depth, line) : '';
  }
  if (name === 'settitle' || name === 'setpagename') {
    ctx.title = args;
    return '';
  }
  if (name === 'hiduke') {
    if (args) ctx.date = args;
    const date = new Date(ctx.date);
    return args || Number.isNaN(date.getTime())
      ? ''
      : `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`;
  }
  if (name === 'nomenu' || name === 'nomenu2') return '';
  if (name === 'areaedit')
    return flags.includes('end')
      ? ''
      : `<button type="button" data-reveal="${line + 1}">部分編集</button>`;
  if (name === 'gaugeset') {
    ctx.gauge = v;
    return '';
  }
  if (name === 'gauge') {
    const config = ctx.gauge || {},
      limit = Math.min(10000, Math.max(1, +config.limit || 20));
    let remaining = limit;
    const segments = flags
      .slice(0, 9)
      .map((s, i) => {
        const n = Math.min(remaining, Math.max(0, Math.floor(+s || 0)));
        remaining -= n;
        return `<span style="color:${colorValue(config['col' + (i + 1)]) || 'currentColor'};${config.back === 'on' ? `background-color:${colorValue(config['col' + (i + 1)]) || 'currentColor'};` : ''}">${esc(config.char || '|').repeat(n)}</span>`;
      })
      .join('');
    return `<span class="gauge" style="background-color:${colorValue(config.bgcol) || 'transparent'}">${segments}${'&nbsp;'.repeat(remaining)}</span>`;
  }
  if (name === 'presen') {
    if (options.presentation) return '';
    if (v.page) {
      const page = options.pages?.[v.page];
      if (page === undefined) {
        ctx.warn('presen: ページが見つかりません: ' + v.page);
        return '';
      }
      const result = require('../renderer').render(typeof page === 'string' ? page : page.text, {
        ...options,
        pageName: v.page,
        presentation: true,
        resolveImage: (file, page, source) => options.resolveImage?.(file, page, source || v.page),
      });
      if (!result.headings.some((h) => h.level === 1)) {
        ctx.warn('presen: 大見出しがありません');
        return '';
      }
      for (const warning of result.warnings) ctx.warn(warning);
      return (
        '<button type="button" data-present data-incremental="' +
        flags.includes('incremental') +
        '">プレゼンテーション表示</button><template data-presentation-source>' +
        result.html +
        '</template>'
      );
    }
    return `<button type="button" data-present data-incremental="${flags.includes('incremental') || flags.includes('incrementa')}">プレゼンテーション表示</button>`;
  }
  return null;
}
module.exports = {
  plugin,
  names:
    'pc mobile exk exp exkp settitle setpagename hiduke nomenu nomenu2 areaedit gaugeset gauge presen'.split(
      ' ',
    ),
};
