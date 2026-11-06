'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { render } = require('../src/renderer');
const { createPayload } = require('../src/preview-data');
const { publicIPv4, feedUrl, download, createFeedLoader } = require('../src/feed-loader');
const { safeLink, parseFeed } = require('../media/interactions/external');
const external = require('../src/plugins/external');

test('feed extraction handles RSS/Atom fields and excludes executable links', () => {
  const element = (localName, textContent = '', attributes = {}, children = []) => ({
    localName,
    textContent,
    children,
    getAttribute: (name) => attributes[name] || null,
  });
  const entry = element('entry', '', {}, [
    element('title', '<img onerror=alert(1)>'),
    element('link', '', { href: '/article' }),
    element('updated', '2026-11-03'),
  ]);
  const item = element('item', '', {}, [
    element('title', 'RSS'),
    element('link', 'javascript:alert(1)'),
    element('pubDate', 'Tue, 03 Nov 2026'),
  ]);
  class Parser {
    parseFromString() {
      return {
        documentElement: { localName: 'feed' },
        getElementsByTagName: (tag) => (tag === '*' ? [entry, item] : []),
      };
    }
  }
  const entries = parseFeed('<feed/>', 'https://example.com/feed', Parser);
  assert.equal(entries[0].url, 'https://example.com/article');
  assert.equal(entries[0].title, '<img onerror=alert(1)>');
  assert.equal(entries[0].date, '2026-11-03');
  assert.equal(entries[1].url, null);
  assert.throws(() => parseFeed('<!DOCTYPE rss><rss/>', 'https://example.com', Parser));
  class ErrorParser {
    parseFromString() {
      return { getElementsByTagName: () => [{}] };
    }
  }
  assert.throws(() => parseFeed('not xml', 'https://example.com', ErrorParser));
});

test('preview loads feed initializer and restricts frame providers', () => {
  const html = require('../src/preview-html').previewHtml(
    { Uri: { joinPath: (...parts) => parts.join('/') } },
    { webview: { asWebviewUri: (x) => x, cspSource: 'https://local.example' } },
    'media',
    'nonce123',
    'token123',
  );
  assert.match(html, /interactions\/external.js/);
  assert.match(html, /frame-src 'self' https:\/\/www.youtube-nocookie.com/);
  assert.doesNotMatch(html, /frame-src \*/);
  assert.match(
    render('&youtube(https://youtu.be/RBgFHC723Mk?t=1m30s&end=120&controls=0)', {
      allowExternalEmbeds: true,
    }).html,
    /start=90&amp;end=120&amp;controls=0/,
  );
});

test('video URLs preserve queries, reject impostor hosts, and keep a fallback with embeds disabled', () => {
  for (const input of [
    'https://www.youtube.com/watch?v=RBgFHC723Mk&x=1',
    'https://youtu.be/RBgFHC723Mk',
    'https://www.youtube.com/shorts/RBgFHC723Mk',
    'RBgFHC723Mk',
  ]) {
    const source = `&youtube(${input}){300,200}`;
    assert.doesNotMatch(render(source).html, /<iframe/);
    const result = render(source, { allowExternalEmbeds: true });
    assert.match(result.html, /src="https:\/\/www.youtube-nocookie.com\/embed\/RBgFHC723Mk"/);
    assert.match(result.html, /width="300" height="200"/);
    assert.deepEqual(result.warnings, []);
  }
  assert.doesNotMatch(
    render('&youtube(https://youtube.com.evil.test/watch?v=RBgFHC723Mk)', {
      allowExternalEmbeds: true,
    }).html,
    /<iframe/,
  );
  assert.match(
    render('&video(https://www.nicovideo.jp/watch/sm772924)', { allowExternalEmbeds: true }).html,
    /embed.nicovideo.jp\/watch\/sm772924/,
  );
});
test('social embeds reconstruct allowed URLs without executing pasted HTML', () => {
  const result = render(
    '#twitter_widget3(){<a href="https://x.com/atwikijp/status/123456">post</a><script>alert(42)</script><img src="https://evil.test/a">}',
    { allowExternalEmbeds: true },
  );
  assert.match(result.html, /platform.twitter.com\/widgets.js/);
  assert.doesNotMatch(result.html, /alert\(42\)|evil.test/);
  assert.match(result.html, /sandbox="allow-scripts allow-popups"/);
  assert.match(
    render('#discord_widget(id=123456789,theme=dark,width=400)', { allowExternalEmbeds: true })
      .html,
    /theme=dark/,
  );
  assert.doesNotMatch(
    render('#discord_widget(id=oops)', { allowExternalEmbeds: true }).html,
    /<iframe/,
  );
  assert.match(
    render('#instagram_widget(https://www.instagram.com/p/abc/)').html,
    /Instagramで開く/,
  );
  for (const name of external.names)
    assert.equal(require('../src/unsupported')[name], undefined, name);
});
test('public feed transport blocks private addresses, pins DNS and limits redirects', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '198.18.0.1',
  ])
    assert.equal(publicIPv4(address), false, address);
  assert.equal(publicIPv4('8.8.8.8'), true);
  assert.equal(feedUrl('file:///secret'), null);
  assert.equal(feedUrl('https://user:pass@example.com/feed'), null);
  assert.equal(feedUrl('http://example.com/feed'), 'https://example.com/feed');
  let requests = 0;
  await assert.rejects(
    download('https://example.com/feed', 0, {
      lookup: async () => [{ address: '127.0.0.1' }],
      get: () => requests++,
    }),
  );
  assert.equal(requests, 0);
  const dependencies = {
    lookup: async () => [{ address: '8.8.8.8' }],
    get: (url, options, callback) => {
      requests++;
      options.lookup(url.hostname, {}, (error, address) => assert.equal(address, '8.8.8.8'));
      const request = new EventEmitter();
      request.destroy = () => {};
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 302;
        response.headers = { location: 'https://127.0.0.1/private' };
        response.resume = () => {};
        callback(response);
      });
      return request;
    },
  };
  dependencies.lookup = async (host) => [
    { address: host === '127.0.0.1' ? '127.0.0.1' : '8.8.8.8' },
  ];
  await assert.rejects(download('https://example.com/feed', 0, dependencies));
  assert.equal(requests, 1);
  assert.equal(safeLink('javascript:alert(1)', 'https://example.com'), null);
  assert.equal(safeLink('/article', 'https://example.com/feed'), 'https://example.com/article');
});
test('feed loader caches requests and caps each document at four feeds', async () => {
  let calls = 0;
  const load = createFeedLoader(async (url) => {
    calls++;
    return { xml: '<rss/>', url };
  });
  const urls = Array.from({ length: 6 }, (_, i) => 'https://example.com/' + i);
  assert.equal(Object.keys(await load(urls)).length, 4);
  await load(urls);
  assert.equal(calls, 4);
});
test('preview fetches only rendered feeds after opt-in, including feeds in included pages', async () => {
  let calls = 0;
  const make = (allow) =>
    createPayload({
      vscode: {},
      document: {
        getText: () => '#include(別)',
        fileName: '/wiki/main.atwiki',
        uri: { toString: () => 'file:///wiki/main.atwiki' },
        lineCount: 1,
      },
      root: { fsPath: '/wiki' },
      pageName: 'main',
      panel: { webview: {} },
      config: () => ({ get: (key, fallback) => (key === 'allowExternalFeeds' ? allow : fallback) }),
      mode: () => '',
      nonce: 'abc',
      index: {
        get: async () => ({
          pages: {
            別: { text: '#rss(https://example.com/feed,showdate)' },
            無関係: { text: '#rss(https://other.example/feed)' },
          },
          images: [],
        }),
      },
      loadScripts: async () => ({}),
      loadFeeds: async (urls) => {
        calls++;
        assert.deepEqual(urls, ['https://example.com/feed']);
        return {
          [urls[0]]: { xml: '<rss><channel><item><title>A</title></item></channel></rss>' },
        };
      },
    });
  assert.doesNotMatch((await make(false)()).html, /data-feed=/);
  assert.equal(calls, 0);
  assert.match((await make(true)()).html, /data-feed=/);
  assert.equal(calls, 1);
});
