'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { render } = require('../src/renderer');
const { candidates } = require('../src/language-features');
const { createPayload } = require('../src/preview-data');
const { openAttachment } = require('../src/attachments');

test('random images select only filenames and preserve dimensions and page', () => {
  for (const random of [0, 0.3, 0.6, 0.99]) {
    const seen = [];
    const result = render('&random_img(a.png,b.png,width=100,height=50,page=別)', {
      random: () => random,
      resolveImage: (file, page) => {
        seen.push([file, page]);
        return 'local/' + file;
      },
    });
    assert.deepEqual(seen, [[random < 0.5 ? 'a.png' : 'b.png', '別']]);
    assert.match(result.html, /width:100px;height:50px/);
    assert.deepEqual(result.warnings, []);
  }
});

test('lightbox labels, blankimg defaults and image diagnostics follow options', () => {
  const options = { resolveImage: (name) => 'local/' + name };
  assert.match(render('&lightbox(a.png,link=text,title=説明)', options).html, />説明<\/button>/);
  assert.match(render('&lightbox(a.png)', options).html, />Thumbnail<\/button>/);
  assert.match(render('&lightbox(a.png,link=image)', options).html, /<img /);
  assert.match(render('&blankimg(a.png)', options).html, /width:128px;height:128px/);
  assert.match(render('&blankimg(a.png,width=64)', options).html, /width:64px;height:128px/);
  for (const key of ['width', 'height', 'x', 'y']) {
    for (const value of ['oops', '-1', '0', '0px'])
      assert.match(
        render(`&image(a.png,${key}=${value})`, options).warnings.join(),
        new RegExp(key),
      );
    assert.deepEqual(render(`&image(a.png,${key}=120px)`, options).warnings, []);
  }
  assert.match(render('&image(a.png,linkpage=別,blank)', options).html, /data-new-window="true"/);
});

test('ref positional page and tree/image options can be completed', () => {
  assert.ok(candidates('&ref(a.png,攻', { 攻略: '' }).some((c) => c.label === '攻略'));
  assert.ok(candidates('&ref(a.png,wi').some((c) => c.insertText === 'width='));
  for (const name of ['treemenu', 'treemenu2', 'treemenu3'])
    assert.ok(candidates(`#${name}(ti`).some((c) => c.insertText === 'title='));
  assert.ok(candidates('&random_img(a.png,he').some((c) => c.insertText === 'height='));
  assert.ok(candidates('&lightbox(a.png,li').some((c) => c.insertText === 'link='));
});

test('attachment preview checks existence and opens only files inside the wiki', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-attachment-'));
  const root = path.join(directory, 'wiki');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'manual.pdf'), 'fixture');
  await fs.writeFile(path.join(directory, 'outside.pdf'), 'fixture');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let source = '&ref(manual.pdf)';
  const opened = [];
  const vscode = {
    Uri: { joinPath: (_, name) => name, file: (file) => file },
    commands: { executeCommand: (...args) => opened.push(args) },
    window: { showInformationMessage() {} },
  };
  const payload = createPayload({
    vscode,
    root: { fsPath: root },
    pageName: 'page',
    document: {
      getText: () => source,
      fileName: path.join(root, 'page.atwiki'),
      uri: { toString: () => 'file:///page.atwiki' },
      lineCount: 1,
    },
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: { get: async () => ({ pages: {}, images: [] }) },
    loadScripts: async () => ({}),
  });
  assert.match((await payload()).html, /data-attachment="manual.pdf"/);
  await openAttachment(vscode, root, 'manual.pdf');
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'vscode.open');
  for (const name of ['../outside.pdf', 'file:///outside.pdf', '/outside.pdf', 'missing.pdf'])
    await openAttachment(vscode, root, name);
  assert.equal(opened.length, 1);
  source = '&ref(../outside.pdf)';
  assert.doesNotMatch((await payload()).html, /data-attachment/);
  await fs.unlink(path.join(root, 'manual.pdf'));
  source = '&ref(manual.pdf)';
  const missing = await payload();
  assert.match(missing.warnings.join(), /添付ファイル/);
  assert.doesNotMatch(missing.html, /data-attachment/);
});
