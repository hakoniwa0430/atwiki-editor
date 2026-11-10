'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayload } = require('../src/preview-data');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('real image existence is checked on each render, including deletion', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-image-check-'));
  const file = path.join(directory, 'photo.png');
  await fs.writeFile(file, 'fixture');
  t.after(async () => {
    await fs.unlink(file).catch(() => {});
    await fs.rmdir(directory);
  });
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, value) => 'local:///' + value } },
    document: {
      getText: () => '&image(photo.png)',
      fileName: path.join(directory, 'page.atwiki'),
      uri: { toString: () => 'file:///page.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: directory },
    pageName: 'page',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: { get: async () => ({ pages: {}, images: [] }) },
    loadScripts: async () => ({}),
  });
  assert.match((await payload()).html, /<img /);
  await fs.unlink(file);
  const missing = await payload();
  assert.doesNotMatch(missing.html, /<img /);
  assert.match(missing.warnings.join(), /photo.png/);
});

test('page image folders take priority only for bare image names', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-page-images-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of [
    'folder/攻略/photo.png',
    'folder/photo.png',
    'folder/攻略/sub/photo.png',
    'folder/sub/photo.png',
    'folder/攻略/manual.pdf',
    'folder/manual.pdf',
    '別/photo.png',
  ]) {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'fixture');
  }
  let source = '&image(photo.png)';
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, value) => `local:///${value}` } },
    document: {
      getText: () => source,
      fileName: path.join(directory, 'folder/攻略.atwiki'),
      uri: { toString: () => 'file:///folder/攻略.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: directory },
    pageName: 'folder/攻略',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: {
      get: async () => ({
        pages: { 'folder/攻略': { text: '&image(photo.png)' } },
        images: [],
      }),
    },
    loadScripts: async () => ({}),
  });
  for (const markup of ['&image(photo.png)', '&ref(photo.png)']) {
    source = markup;
    const result = await payload();
    assert.ok(result.html.includes('src="local:///folder/攻略/photo.png"'), markup);
    assert.deepEqual(result.warnings, []);
  }
  for (const name of ['sub/photo.png', './photo.png', 'sub\\photo.png']) {
    source = `&image(${name})`;
    const expected = name.startsWith('./') ? 'photo.png' : 'sub/photo.png';
    assert.ok((await payload()).html.includes(`src="local:///folder/${expected}"`));
  }
  source = '&image(photo.png,page=別)';
  assert.ok((await payload()).html.includes('src="local:///別/photo.png"'));
  source = '&ref(manual.pdf)';
  assert.ok((await payload()).html.includes('data-attachment="folder/manual.pdf"'));
  source = '&image(photo.png)';
  await fs.unlink(path.join(directory, 'folder/攻略/photo.png'));
  assert.ok((await payload()).html.includes('src="local:///folder/photo.png"'));
  await fs.unlink(path.join(directory, 'folder/photo.png'));
  const missing = await payload();
  assert.doesNotMatch(missing.html, /<img /);
  assert.match(missing.warnings.join(), /photo.png/);
});

async function preview(text, settings = {}) {
  return createPayload({
    vscode: { Uri: { joinPath: (_, value) => `local:///${value}` } },
    document: {
      getText: () => text,
      fileName: '/wiki/folder/page.atwiki',
      uri: { toString: () => 'file:///wiki/folder/page.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: '/wiki' },
    pageName: 'folder/page',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
    mode: () => '',
    index: { get: async () => ({ pages: {}, images: [] }) },
    loadScripts: async () => ({}),
    imageExists: async (file) => file.replaceAll('\\', '/').endsWith('/folder/picture.png'),
  })();
}

test('shared images render by default through image and ref with legacy URL normalization', async () => {
  for (const source of [
    'https://img.atwiki.jp/demo/pub/sub/画像.png',
    'http://img.atwiki.jp/demo/pub/sub/画像.png',
    '//img.atwiki.jp/demo/pub/sub/画像.png',
    'http://img.atwikiimg.com/www42.atwiki.jp/demo/pub/sub/画像.png',
  ]) {
    for (const markup of [`&image(${source},width=120)`, `#ref(${source},別ページ)`]) {
      const result = await preview(markup);
      assert.match(
        result.html,
        /src="https:\/\/img.atwiki.jp\/demo\/pub\/sub\/%E7%94%BB%E5%83%8F.png"/,
      );
      assert.deepEqual(result.warnings, []);
    }
  }
});

test('missing local images are reported at their source line', async () => {
  const result = await preview('本文\n&image(missing.png)');
  assert.doesNotMatch(result.html, /<img /);
  assert.ok(result.diagnostics.some((d) => d.line === 1 && d.message.includes('missing.png')));
  assert.match((await preview('&image(picture.png)')).html, /<img /);
});

test('shared image permission can be disabled and general HTTPS permission still works', async () => {
  const markup = '&image(https://img.atwiki.jp/demo/pub/picture.png)';
  assert.doesNotMatch((await preview(markup, { allowSharedImages: false })).html, /<img /);
  assert.match(
    (await preview(markup, { allowSharedImages: false, allowRemoteImages: true })).html,
    /<img /,
  );
  assert.match(
    (await preview('&image(https://example.com/picture.png)', { allowRemoteImages: true })).html,
    /<img /,
  );
});

test('unrelated and malformed URLs do not fall through to local files on nested pages', async () => {
  for (const source of [
    'https://example.com/picture.png',
    'https://img.atwiki.jp.evil.test/demo/pub/picture.png',
    'https://img.atwiki.jp@evil.test/demo/pub/picture.png',
    'https://img.atwiki.jp:444/demo/pub/picture.png',
    'https://img.atwiki.jp/demo/attach/1/2/picture.png',
    'https://img.atwiki.jp/demo/pub/../private/picture.png',
    'file:///private/picture.png',
    '//example.com/picture.png',
  ]) {
    assert.doesNotMatch((await preview(`&image(${source})`)).html, /<img /, source);
  }
  assert.match(
    (await preview('&image(picture.png)')).html,
    /src="local:\/\/\/folder\/picture.png"/,
  );
});

test('selected presentation resolves local images relative to its own page', async () => {
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, value) => 'local:///' + value } },
    document: {
      getText: () => '#presen(page=target/page)',
      fileName: '/wiki/home.atwiki',
      uri: { toString: () => 'file:///wiki/home.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: '/wiki' },
    pageName: 'home',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: {
      get: async () => ({
        pages: { 'target/page': { text: '*Target\n&image(picture.png)' } },
        images: [],
      }),
    },
    loadScripts: async () => ({}),
    imageExists: async (file) => file.replaceAll('\\', '/').endsWith('/target/picture.png'),
  });
  const result = await payload();
  assert.match(result.html, /src="local:\/\/\/target\/picture.png"/);
  assert.equal(result.warnings.length, 0);
});

test('random images use the same choice during file verification and final rendering', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-random-image-'));
  await fs.writeFile(path.join(directory, 'a.png'), 'fixture');
  await fs.writeFile(path.join(directory, 'b.png'), 'fixture');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, value) => 'local:///' + value } },
    document: {
      getText: () => '&random_img(a.png,b.png)',
      fileName: path.join(directory, 'page.atwiki'),
      uri: { toString: () => 'file:///page.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: directory },
    pageName: 'page',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: { get: async () => ({ pages: {}, images: [] }) },
    loadScripts: async () => ({}),
  });
  // A replay that makes a new random choice would request an unverified file.
  const random = Math.random;
  let calls = 0;
  Math.random = () => (++calls % 2 ? 0 : 0.99);
  try {
    const result = await payload();
    assert.ok(result.html.includes('src="local:///a.png"'));
    assert.equal(calls, 1);
    assert.deepEqual(result.warnings, []);
  } finally {
    Math.random = random;
  }
});
