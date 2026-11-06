'use strict';
const path = require('node:path');
const { render } = require('./renderer');
function sharedImageUrl(value) {
  if (typeof value !== 'string' || /[\x00-\x20\\]/.test(value)) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return null;
    if (url.hostname === 'img.atwikiimg.com') {
      if (!/^\/www\d+\.atwiki\.jp\//i.test(url.pathname)) return null;
      url.pathname = url.pathname.replace(/^\/www\d+\.atwiki\.jp/i, '');
      url.hostname = 'img.atwiki.jp';
    }
    if (url.hostname !== 'img.atwiki.jp' || !/^\/[\w-]+\/pub\/.+/.test(url.pathname)) return null;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}
function createPayload({
  vscode,
  document,
  root,
  pageName,
  panel,
  config,
  mode,
  nonce,
  index,
  loadScripts,
  imageExists,
  loadFeeds = require('./feed-loader').createFeedLoader(),
}) {
  return async function payload() {
    const verified = new Map(),
      pendingFiles = new Set();
    function resolveImage(value, page, sourcePage, attachment = false) {
      const shared = sharedImageUrl(value);
      if (shared && config().get('allowSharedImages', true)) return shared;
      if (/^https:\/\//i.test(value) && config().get('allowRemoteImages', false)) return value;
      if (!value || /[\x00-\x1f]/.test(value) || /^(?:[a-z][\w+.-]*:|[\\/])/i.test(value))
        return null;
      if (page) value = `${page}/${value}`;
      else {
        const directory = (sourcePage || pageName).split('/').slice(0, -1).join('/');
        if (directory) value = `${directory}/${value}`;
      }
      if (
        document.isUntitled ||
        !value ||
        /[\x00-\x1f]/.test(value) ||
        /^[a-z][\w+.-]*:/i.test(value) ||
        /^[\\/]/.test(value)
      )
        return null;
      const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
      if (
        normalized === '..' ||
        normalized.startsWith('../') ||
        (!attachment && !/\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(normalized))
      )
        return null;
      pendingFiles.add(normalized);
      if (!verified.get(normalized)) return null;
      if (attachment) return normalized;
      return panel.webview.asWebviewUri(vscode.Uri.joinPath(root, normalized)).toString();
    }
    const text = document.getText();
    const indexed = !document.isUntitled
      ? await index.get(root.fsPath || path.dirname(document.fileName))
      : { pages: {}, images: [], truncated: false };
    const directory = pageName.split('/').slice(0, -1).join('/'),
      prefix = directory ? directory + '/' : '';
    const images = (indexed.images || [])
      .filter((s) => s.startsWith(prefix) && !s.slice(prefix.length).includes('/'))
      .map((s) => s.slice(prefix.length));
    const scripts = document.isUntitled
      ? {}
      : await loadScripts(root.fsPath || path.dirname(document.fileName), [
          text,
          ...Object.values(indexed.pages).map((p) => p.text),
        ]);
    const feedRequests = new Set();
    const choices = [];
    let choiceIndex = 0;
    const renderOptions = {
      now: new Date(),
      random: () => ((choices[choiceIndex] ??= Math.random()), choices[choiceIndex++]),
      resolveImage,
      resolveAttachment: (value, page, source) => resolveImage(value, page, source, true),
      images,
      scripts,
      pages: indexed.pages,
      pagesTruncated: indexed.truncated,
      validateLinks: true,
      mode: mode() || config().get('displayMode', 'desktop'),
      wikiName: config().get('wikiName', 'ローカルWiki'),
      wikiUrl: config().get('wikiUrl', ''),
      pageName,
      pageUrl: document.uri.toString(),
      scriptNonce: nonce,
      allowExternalEmbeds: config().get('allowExternalEmbeds', false),
      allowExternalFeeds: config().get('allowExternalFeeds', false),
      feedRequests,
    };
    let result = render(text, renderOptions);
    await Promise.all(
      [...pendingFiles].map(async (name) => {
        const file = path.resolve(root.fsPath, name);
        const valid = imageExists
          ? await imageExists(file)
          : await require('./attachments').resolveAttachment(root.fsPath, name);
        verified.set(name, !!valid);
      }),
    );
    choiceIndex = 0;
    result = render(text, renderOptions);
    if (feedRequests.size) {
      const feeds = await loadFeeds([...feedRequests]);
      choiceIndex = 0;
      result = render(text, { ...renderOptions, feeds });
      if (feedRequests.size > 4) result.warnings.push('RSSの取得は1ページ最大4フィードです');
    }
    if (indexed.truncated)
      result.warnings.push(
        'ローカルページの読み込み上限（500件・合計10MB・深さ8）を超えた項目があります',
      );
    return {
      type: 'render',
      html: result.html,
      warnings: result.warnings,
      diagnostics: result.diagnostics,
      theme: config().get('theme', 'uikit'),
      name: result.title || path.basename(document.fileName),
      lines: document.lineCount,
    };
  };
}
module.exports = { createPayload };
