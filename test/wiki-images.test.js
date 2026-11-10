'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  extractImages,
  imageUrl,
  syncImages,
  localImage,
  imageTarget,
} = require('../src/wiki-images');
const { createPayload } = require('../src/preview-data');
const one = 'https://img.atwiki.jp/demo/attach/1/2/pic.png';
const two = 'https://img.atwiki.jp/demo/attach/2/3/pic.png';
test('画像URLは接続先Wikiの公式画像ホストに限定し、旧URLとHTMLエスケープを扱う', () => {
  assert.equal(
    imageUrl('http://img.atwikiimg.com/www1.atwiki.jp/demo/attach/1/2/pic.png', 'demo'),
    one,
  );
  assert.deepEqual(extractImages(`<img src="${one}?a=1&amp;b=2"> &image(${one})`, 'demo'), [
    one + '?a=1&b=2',
    one,
  ]);
  for (const url of [
    one.replace('/demo/', '/other/'),
    one.replace('img.atwiki.jp', 'evil.test'),
    one.replace('https:', 'file:'),
    one.replace('img.atwiki.jp', 'secret@img.atwiki.jp'),
    one.replace('.png', '.html'),
  ])
    assert.equal(imageUrl(url, 'demo'), null);
});
test('画像同期は同名画像をページ別に区別し、オフラインのプレビューで本文を変えず表示する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pages = [
    { pageid: 1, pagename: 'ページ' },
    { pageid: 2, pagename: '別ページ' },
  ];
  const page = { ...pages[0], source: '&image(pic.png)' };
  let revision = 'first';
  const fetcher = async (url, kind) =>
    Buffer.from(kind === 'html' ? `<img src="${one}"><img src="${two}">` : url + revision);
  assert.equal((await syncImages(root, 'demo', page, 'ローカル', pages, fetcher)).updated, 2);
  const first = 'ページ/pic.png';
  const metadata = pages.map((page) => ({ ...page, wiki: 'demo' }));
  assert.equal(localImage(one, metadata), first);
  assert.equal(localImage(two, metadata), '別ページ/pic.png');
  assert.equal(localImage(one.replace('/demo/', '/other/'), metadata), null);
  assert.equal((await syncImages(root, 'demo', page, 'ローカル', pages, fetcher)).kept, 2);
  let source = '&image(pic.png)\n&image(pic.png,page=別ページ)\n&image(' + one + ')';
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, name) => 'local:///' + name } },
    document: {
      getText: () => source,
      fileName: path.join(root, 'ローカル.atwiki'),
      uri: { toString: () => 'file:///ローカル.atwiki' },
      lineCount: 3,
    },
    root: { fsPath: root },
    pageName: 'ローカル',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: () => false }),
    mode: () => '',
    index: {
      get: async () => ({
        pages: { ローカル: { sync: metadata[0] }, 別ページ: { sync: metadata[1] } },
        images: [],
      }),
    },
    loadScripts: async () => ({}),
  });
  const preview = await payload();
  assert.equal((preview.html.match(/src="local:\/\/\//g) || []).length, 3);
  assert.deepEqual(preview.warnings, []);
  revision = 'second';
  await syncImages(root, 'demo', page, 'ローカル', pages, fetcher);
  assert.equal(localImage(one, metadata), first);
  assert.equal(await fs.readFile(path.join(root, first), 'utf8'), one + 'second');
  assert.ok(await fs.stat(path.join(root, first)));
  const failed = await syncImages(root, 'demo', page, 'ローカル', pages, async (url, kind) => {
    if (kind === 'html') return fetcher(url, kind);
    throw Error('offline');
  });
  assert.equal(failed.problems.length, 2);
  assert.equal(failed.updated, 0);
  assert.equal(page.source, '&image(pic.png)');
  source = '&image(pic.png)';
  assert.match((await payload()).html, /src="local:/);
});

test('共通画像はpub以下の日本語・空白を含む元の名前を保ち、サムネイルは元画像に統一する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-pub-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const url = 'https://img.atwiki.jp/demo/pub/icons/%E7%94%BB%E5%83%8F%201.PNG';
  const page = { pageid: 1, pagename: 'トップページ', source: `&image(${url})` };
  const result = await syncImages(root, 'demo', page, page.pagename, [page], async (_, kind) =>
    Buffer.from(kind === 'html' ? '' : 'image'),
  );
  assert.deepEqual(result, { updated: 1, kept: 0, problems: [] });
  assert.equal(localImage(url, [{ ...page, wiki: 'demo' }]), 'pub/icons/画像 1.PNG');
  assert.equal(await fs.readFile(path.join(root, 'pub/icons/画像 1.PNG'), 'utf8'), 'image');
  assert.equal(imageTarget(one.replace('/2/pic', '/2/t/pic'), [page]).url, one);
  for (const bad of [
    'https://img.atwiki.jp/demo/pub/a%2Fb.png',
    'https://img.atwiki.jp/demo/pub/%5Cbad.png',
    'https://img.atwiki.jp/demo/pub/NUL.png',
  ])
    assert.throws(() => imageTarget(bad, [page]));
});

test('同期は画像管理ファイルや管理フォルダを作成しない', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-no-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const page = { pageid: 1, pagename: 'ページ', source: `&image(${one})` };
  await syncImages(root, 'demo', page, 'ページ', [page], async (_, kind) =>
    Buffer.from(kind === 'html' ? '' : 'image'),
  );
  assert.deepEqual(await fs.readdir(root), ['ページ']);
  assert.equal(await fs.readFile(path.join(root, 'ページ/pic.png'), 'utf8'), 'image');
});
