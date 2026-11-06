'use strict';
const { escapeHtml: esc, parameters } = require('../syntax');
function plugin(p, ctx, depth = 0, line = 0) {
  const { name, args, body } = p;
  const { warn, options, link } = ctx;
  const { flags, values: v } = parameters(args);
  const text = body ?? args;
  if (name === 'this_page') return esc(options.pageName || 'Untitled');
  if (name === 'wikiname') return esc(options.wikiName || 'ローカルWiki');
  if (name === 'wikiurl') return esc(options.wikiUrl || '');
  if (name === 'link_displaymode')
    return `<button type="button" data-mode="${options.mode === 'mobile' ? 'desktop' : 'mobile'}">${esc(v.text || flags[0] || '表示モード切り替え')}</button>`;
  if (name === 'listbox') {
    warn('listbox: 選択変更はプレビュー内だけに反映し、ファイルには保存しません');
    const selected =
      flags.length > 1 && flags.slice(0, -1).includes(flags.at(-1)) ? flags.pop() : flags[0];
    return `<select aria-label="リストボックス">${flags.map((s) => `<option${s === selected ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  }
  if (name === 'memo' || name === 'memox') {
    warn(`${name}: 入力はプレビュー内だけに反映し、ファイルには保存しません`);
    return `<textarea aria-label="メモ" rows="${Math.min(100, Math.max(1, +v.rows || 5))}" cols="${Math.min(200, Math.max(1, +v.cols || 40))}">${esc(body || '')}</textarea>`;
  }
  if (name === 'this_url')
    return flags.includes('link')
      ? link(v.text || options.pageUrl || options.pageName || '', options.pageName || '', depth + 1)
      : esc(options.pageUrl || '');
  if (name === 'link_up')
    return link(body || v.text || flags[0] || '上へ', '#atwiki-top', depth + 1);
  if (name === 'link_parent') {
    const parent = (options.pageName || '').split('/').slice(0, -1).join('/');
    return link(body || v.text || parent || 'トップページ', parent || 'トップページ', depth + 1);
  }
  if (name === 'link_path') {
    const path = require('node:path').posix;
    const target = path.normalize(
      args.startsWith('/') ? args.slice(1) : `${options.pageName || ''}/${args}`,
    );
    return link(body || target, target === '.' ? 'トップページ' : target, depth + 1);
  }
  if (name === 'link_atwiki') {
    const wiki = (flags[0] || '').replace(/@(?:wiki|www\d*)$/, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(wiki)) {
      warn('link_atwiki のWiki名が不正です');
      return '';
    }
    const url =
      'https://w.atwiki.jp/' +
      wiki +
      '/' +
      (flags[1] ? '?page=' + encodeURIComponent(flags[1]) : '');
    return link(body || flags[1] || wiki, url, depth + 1, false, v.target === 'blank');
  }
  if (name === 'link_wikipedia')
    return link(
      body || flags[0],
      `https://${/^[a-z-]+$/.test(v.lang) ? v.lang : 'ja'}.wikipedia.org/wiki/${encodeURIComponent(flags[0] || '')}`,
      depth + 1,
    );
  if (name === 'topicpath') {
    const pages = (options.pageName || '').split('/');
    return pages.map((s, i) => link(s, pages.slice(0, i + 1).join('/'), depth + 1)).join(' / ');
  }
  if (['back', 'link_back', 'forward', 'link_forward', 'reload'].includes(name))
    return `<button type="button" data-action="${name.replace('link_', '')}">${esc(v.text || flags[0] || { back: '戻る', link_back: '戻る', forward: '進む', link_forward: '進む', reload: '更新する' }[name])}</button>`;
  return null;
}
module.exports = {
  plugin,
  names:
    'this_page wikiname wikiurl link_displaymode listbox memo memox this_url link_up link_parent link_path link_atwiki link_wikipedia topicpath back link_back forward link_forward reload'.split(
      ' ',
    ),
};
