'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.AtWikiFeatures ||= {}).external = api;
})(globalThis, function () {
  function safeLink(value, base) {
    try {
      const u = new URL(value, base);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
    } catch {
      return null;
    }
  }
  function parseFeed(xml, base, Parser = DOMParser) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD付きフィードには対応していません');
    const document = new Parser().parseFromString(xml, 'application/xml');
    if (
      document.getElementsByTagName('parsererror').length ||
      !['rss', 'RDF', 'feed'].includes(document.documentElement?.localName)
    )
      throw new Error('RSS / AtomのXMLを読み取れません');
    const elements = [...document.getElementsByTagName('*')].filter((el) =>
      ['item', 'entry'].includes(el.localName),
    );
    return elements.slice(0, 200).map((el) => {
      const child = (name) => [...el.children].find((x) => x.localName === name);
      const links = [...el.children].filter((x) => x.localName === 'link');
      const link = links.find(
        (x) => !x.getAttribute('rel') || x.getAttribute('rel') === 'alternate',
      );
      const href = link?.getAttribute('href') || link?.textContent || '';
      return {
        title: child('title')?.textContent?.trim() || '（無題）',
        url: href ? safeLink(href.trim(), base) : null,
        date:
          (
            child('pubDate') ||
            child('published') ||
            child('updated') ||
            child('date')
          )?.textContent?.trim() || '',
      };
    });
  }
  function initialize(container) {
    for (const el of container.querySelectorAll('[data-feed]')) {
      const document = el.ownerDocument;
      try {
        const entries = parseFeed(el.dataset.feed, el.dataset.feedUrl);
        const shown = entries.slice(0, Math.min(50, +el.dataset.limit || 20));
        const list = document.createElement('ul');
        for (const entry of shown) {
          const li = document.createElement('li');
          const label = document.createElement(entry.url ? 'a' : 'span');
          const chars = +el.dataset.charnum;
          label.textContent =
            chars && entry.title.length > chars ? entry.title.slice(0, chars) + '…' : entry.title;
          if (entry.url) {
            label.href = entry.url;
            label.rel = 'noreferrer noopener';
          }
          li.appendChild(label);
          if (el.dataset.showdate === 'true' && entry.date) {
            const date = document.createElement('small');
            date.textContent = ' — ' + entry.date;
            li.appendChild(date);
          }
          list.appendChild(li);
        }
        el.appendChild(list);
        const status = document.createElement('small');
        status.textContent = !shown.length
          ? '記事がありません'
          : [
              el.dataset.count === 'true' ? `${shown.length}件` : '',
              el.dataset.lasttime === 'true' ? `最新: ${entries[0]?.date || '日時不明'}` : '',
            ]
              .filter(Boolean)
              .join(' / ');
        if (status.textContent) el.appendChild(status);
      } catch (error) {
        const message = document.createElement('span');
        message.textContent = ' — ' + error.message;
        el.appendChild(message);
      }
      // Do not retain a second copy of the XML in DOM attributes.
      el.removeAttribute('data-feed');
    }
  }
  return { initialize, parseFeed, safeLink };
});
