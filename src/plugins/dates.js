'use strict';
const { formatDate } = require('../../media/date-format');
const { escapeHtml: esc, colorValue, parameters } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, options, inline, link } = ctx;
  const { flags, values: v } = parameters(args);
  const span = (style, html = inline(body ?? '', depth + 1)) =>
    `<span style="${esc(style)}">${html}</span>`;
  if (name === 'calendar')
    return `<div class="calendar" data-pages="${esc(JSON.stringify(Object.keys(options.pages || {})))}" data-year="${ctx.now.getFullYear()}" data-month="${ctx.now.getMonth()}" data-language="${v.lang === 'en' ? 'en' : 'ja'}" data-prefix="${esc(flags[0] || '')}" data-force-links="${v.option === 'link'}"><button type="button" data-month-step="-1">前月</button> <span class="calendar-title"></span> <button type="button" data-month-step="1">翌月</button><div class="calendar-grid"></div></div>`;
  if (name === 'now' || name === 'fclock' || name === 'today')
    return `<time data-clock="${name}" data-japanese="${flags.some((s) => s.toLowerCase() === 'j')}">${esc(
      formatDate(
        ctx.now,
        flags.some((s) => s.toLowerCase() === 'j'),
        name === 'today',
      ),
    )}</time>`;
  if (name === 'new' || name === 'new2') {
    const date = new Date(flags[0]),
      hours = (ctx.now - date) / 3600000;
    if (Number.isNaN(date.getTime())) {
      warn(`${name} の日付が不正です`);
      return '';
    }
    const show =
      name === 'new'
        ? hours >= 0 && hours <= 120
        : Math.abs(hours) <= Math.min(1000, +v.time || 24);
    return show
      ? span(
          `color:${colorValue(v.color) || 'red'};`,
          esc(v.show || (hours <= 24 ? 'New!' : 'New')),
        )
      : '';
  }
  if (name === 'countdown' || name === 'countup') {
    if (!args.trim()) return '';
    const date = new Date(flags[0]);
    if (Number.isNaN(date.getTime())) {
      warn(`${name} の日付が不正です`);
      return esc(args);
    }
    const delta = name === 'countup' ? ctx.now - date : date - ctx.now;
    if (delta < 0) return '';
    const rounding = flags.includes('roundup') ? Math.ceil : Math.floor;
    let amount;
    if (flags.includes('y') || flags.includes('yd')) {
      const start = name === 'countup' ? date : ctx.now,
        end = name === 'countup' ? ctx.now : date;
      let years = end.getFullYear() - start.getFullYear(),
        anniversary = new Date(start);
      anniversary.setFullYear(start.getFullYear() + years);
      if (anniversary > end) {
        years--;
        anniversary = new Date(start);
        anniversary.setFullYear(start.getFullYear() + years);
      }
      amount = flags.includes('yd')
        ? `${years}年${rounding((end - anniversary) / 86400000)}日`
        : String(years);
    } else if (flags.includes('v'))
      amount =
        delta >= 86400000 ? `${rounding(delta / 86400000)}日` : `${rounding(delta / 3600000)}時間`;
    else
      amount = String(
        rounding(
          delta /
            (flags.includes('s')
              ? 1000
              : flags.includes('h')
                ? 3600000
                : flags.includes('d')
                  ? 86400000
                  : 60000),
        ),
      );
    return `<span>${amount}</span>`;
  }
  return null;
}
module.exports = {
  plugin,
  names: 'calendar now fclock today new new2 countdown countup'.split(' '),
  formatDate,
};
