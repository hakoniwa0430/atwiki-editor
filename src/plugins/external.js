'use strict';
const { escapeHtml: esc, splitTop, parameters } = require('../syntax');
const { decode } = require('../safe-html');
const { feedUrl } = require('../feed-loader');
const names =
  'youtube u2b video nicovideo nicovideo2 twitter_widget3 twitter_widget_profile2 twitter_widget_search2 instagram_widget discord_widget showrss rss feedreader'.split(
    ' ',
  );
const FRAME_ORIGINS =
  'https://www.youtube-nocookie.com https://embed.nicovideo.jp https://discord.com https://platform.twitter.com https://syndication.twitter.com';
function webUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}
function youtubeId(value) {
  if (/^[\w-]{11}$/.test(value)) return value;
  const u = webUrl(value);
  if (!u) return null;
  let id;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (
    [
      'youtube.com',
      'www.youtube.com',
      'jp.youtube.com',
      'm.youtube.com',
      'www.youtube-nocookie.com',
    ].includes(u.hostname)
  )
    id = u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}
function nicoId(value) {
  const u = webUrl(value);
  const id =
    u && ['www.nicovideo.jp', 'nicovideo.jp', 'nico.ms'].includes(u.hostname)
      ? u.pathname.split('/').at(-1)
      : value;
  return /^(?:sm|nm|so)\d+$/.test(id || '') ? id : null;
}
function plugin(p, ctx) {
  const parts = splitTop(p.args).map((s) => s.trim());
  // The first argument is the resource URL; remaining arguments are display options.
  const input = parts[0] || '';
  const { values: v, flags } = parameters(parts.slice(1).join(','));
  const body = p.body || '';
  const size = splitTop(body);
  const numeric = (value, fallback, max = 1600) => {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value) || +value < 1 || +value > max) {
      ctx.warn(`${p.name}: サイズ・件数の指定が不正です: ${value}`);
      return fallback;
    }
    return +value;
  };
  const link = (url, label) =>
    `<a href="${esc(url)}" rel="noreferrer noopener">${esc(label || '元ページを開く')}</a>`;
  const frame = (src, url, label, width = 640, height = 360, srcdoc = '') => {
    const fallback = link(url, `${label}で開く`);
    if (!ctx.options.allowExternalEmbeds)
      return `<span class="external-disabled">${fallback}（外部埋め込みは設定で有効化できます）</span>`;
    return `<span class="external-embed"><iframe title="${esc(label)}" ${srcdoc ? `srcdoc="${esc(srcdoc)}" sandbox="allow-scripts allow-popups"` : `src="${esc(src)}" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"`} width="${width}" height="${height}" style="max-width:100%;border:0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; encrypted-media" allowfullscreen></iframe><br>${fallback}<small>（表示できない場合は元ページをご利用ください）</small></span>`;
  };
  if (['youtube', 'u2b', 'video', 'nicovideo', 'nicovideo2'].includes(p.name)) {
    const yt = !p.name.startsWith('nico') && youtubeId(input);
    const nico = !['youtube', 'u2b'].includes(p.name) && nicoId(input);
    if (!yt && !nico) {
      ctx.warn(`${p.name}: 動画URLまたはIDを確認してください`);
      return `<code>${esc(p.raw || input)}</code>`;
    }
    const width = numeric(v.width || size[0], 640),
      height = numeric(v.height || size[1], 360);
    const playerQuery = new URLSearchParams();
    const sourceUrl = webUrl(input);
    if (yt && sourceUrl) {
      const seconds = (value) => {
        if (/^\d+$/.test(value || '')) return +value;
        const match = (value || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        return match && value
          ? (+match[1] || 0) * 3600 + (+match[2] || 0) * 60 + (+match[3] || 0)
          : null;
      };
      for (const key of ['start', 'end']) {
        const raw =
          sourceUrl.searchParams.get(key) ||
          (key === 'start' ? sourceUrl.searchParams.get('t') : null);
        const value = seconds(raw);
        if (value !== null) playerQuery.set(key, String(value));
      }
      const controls = sourceUrl.searchParams.get('controls');
      if (['0', '1'].includes(controls)) playerQuery.set('controls', controls);
    }
    const suffix = playerQuery.size ? '?' + playerQuery : '';
    return yt
      ? frame(
          `https://www.youtube-nocookie.com/embed/${yt}${suffix}`,
          `https://www.youtube.com/watch?v=${yt}`,
          'YouTube',
          width,
          height,
        )
      : frame(
          `https://embed.nicovideo.jp/watch/${nico}`,
          `https://www.nicovideo.jp/watch/${nico}`,
          'ニコニコ動画',
          width,
          height,
        );
  }
  if (p.name === 'discord_widget') {
    const args = parameters(p.args).values;
    if (!/^\d{5,25}$/.test(args.id || '')) {
      ctx.warn('discord_widget: id にサーバーIDを指定してください');
      return '<code>Discord: サーバーID未指定</code>';
    }
    const url = `https://discord.com/widget?id=${args.id}&theme=${args.theme === 'dark' ? 'dark' : 'light'}`;
    return frame(url, url, 'Discord', numeric(args.width, 350), numeric(args.height, 500));
  }
  if (p.name === 'instagram_widget') {
    const u = webUrl(input);
    if (!u || !['www.instagram.com', 'instagram.com', 'instagr.am'].includes(u.hostname)) {
      ctx.warn('instagram_widget: InstagramのURLを指定してください');
      return '<code>Instagram URL不正</code>';
    }
    u.protocol = 'https:';
    return link(u.href, 'Instagramで開く');
  }
  if (p.name === 'twitter_widget_search2')
    return link(`https://x.com/search?q=${encodeURIComponent(input)}`, 'Xで検索');
  if (p.name.startsWith('twitter_')) {
    let url = null;
    if (p.name === 'twitter_widget_profile2' && /^@?\w{1,15}$/.test(input))
      url = `https://twitter.com/${input.replace(/^@/, '')}`;
    else {
      const urls = [
        input,
        ...[...body.matchAll(/(?:href|data-tweet-url)\s*=\s*["']([^"']+)["']/gi)].map((m) =>
          decode(m[1]),
        ),
      ];
      const valid = urls
        .map(webUrl)
        .filter(
          (u) =>
            u &&
            ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'].includes(u.hostname) &&
            /^\/[\w/]+$/.test(u.pathname),
        );
      const selected = valid.find((u) => /\/status\/\d+/.test(u.pathname)) || valid[0];
      if (selected) url = 'https://twitter.com' + selected.pathname;
    }
    if (!url) {
      ctx.warn(`${p.name}: 投稿またはプロフィールのURLを指定してください`);
      return '<code>X: URL未指定</code>';
    }
    const tweet = /\/status\/\d+/.test(url);
    const nonce = ctx.options.scriptNonce || 'external-widget';
    // Reconstruct only the allowed URL. Never execute the pasted embed HTML/scripts.
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src https:; frame-src https://platform.twitter.com https://syndication.twitter.com; connect-src https://*.twitter.com https://*.x.com;"></head><body>${tweet ? '<blockquote class="twitter-tweet">' : ''}<a class="${tweet ? '' : 'twitter-timeline'}" data-dnt="true" href="${esc(url)}">Xで表示</a>${tweet ? '</blockquote>' : ''}<script nonce="${nonce}" async src="https://platform.twitter.com/widgets.js"></script></body></html>`;
    return frame('', url, 'X', 550, 600, doc);
  }
  if (['showrss', 'rss', 'feedreader'].includes(p.name)) {
    const url = feedUrl(input);
    if (!url) {
      ctx.warn(`${p.name}: フィードURLが不正です`);
      return '<code>RSS: URL不正</code>';
    }
    if (!ctx.options.allowExternalFeeds)
      return `<span>${link(url, 'RSSを開く')}（外部RSS取得は設定で有効化できます）</span>`;
    ctx.options.feedRequests?.add(url);
    const entry = ctx.options.feeds?.[url];
    if (!entry) return `<span>${link(url, 'RSSを開く')}（取得待ち・1ページ最大4フィード）</span>`;
    if (entry.error) {
      ctx.warn(`RSS: ${entry.error}`);
      return `<span>${link(url, 'RSSを開く')} — ${esc(entry.error)}</span>`;
    }
    const bv = parameters(body).values;
    const limit = numeric(p.name === 'feedreader' ? bv.limit : v.linelimit, 20, 50);
    for (const flag of flags)
      if (!['showdate', 'countrss', 'lasttime'].includes(flag))
        ctx.warn(`${p.name}: ローカル未対応オプション ${flag}`);
    for (const key of Object.keys(v))
      if (!['linelimit', 'charnum', 'target'].includes(key))
        ctx.warn(`${p.name}: ローカル未対応オプション ${key}`);
    return `<span class="external-feed" data-feed="${esc(entry.xml)}" data-feed-url="${esc(entry.url || url)}" data-limit="${limit}" data-charnum="${numeric(v.charnum, 0, 1000)}" data-showdate="${flags.includes('showdate')}" data-count="${flags.includes('countrss')}" data-lasttime="${flags.includes('lasttime')}">${link(url, 'RSS配信元')}</span>`;
  }
  return null;
}
module.exports = { plugin, names, FRAME_ORIGINS, youtubeId, nicoId };
