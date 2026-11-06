'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PageIndex } = require('../src/page-index');
const { loadPages } = require('../src/local-pages');
test('shared scans preserve unsaved edits without changing the cached disk contents', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'Page.atwiki');
  await fs.writeFile(file, 'disk');
  let reads = 0,
    documents = [];
  const index = new PageIndex({
    loadPages: async (...args) => {
      reads++;
      return loadPages(...args);
    },
    documents: () => documents,
  });
  t.after(() => index.dispose());
  const [a, b] = await Promise.all([index.get(root), index.get(root)]);
  assert.equal(reads, 1);
  assert.equal(a.pages.Page.text, 'disk');
  assert.equal(b.pages.Page.text, 'disk');
  documents = [{ uri: { scheme: 'file' }, fileName: file, getText: () => 'dirty' }];
  assert.equal((await index.get(root)).pages.Page.text, 'dirty');
  documents = [];
  assert.equal((await index.get(root)).pages.Page.text, 'disk');
  assert.equal(reads, 1);
});
test('a root watcher refreshes additions, changes and removals for every retained preview', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-watch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let changed,
    watched = 0,
    disposed = 0,
    notifications = 0;
  const index = new PageIndex({
    loadPages,
    watch: (root, callback) => {
      watched++;
      changed = callback;
      return {
        dispose() {
          disposed++;
        },
      };
    },
  });
  t.after(() => index.dispose());
  const releaseA = index.retain(root, () => notifications++),
    releaseB = index.retain(root, () => notifications++);
  assert.equal(watched, 1);
  await index.get(root);
  const file = path.join(root, 'Added.txt');
  await fs.writeFile(file, 'added');
  changed();
  assert.equal((await index.get(root)).pages.Added.text, 'added');
  await fs.writeFile(file, 'changed');
  changed();
  assert.equal((await index.get(root)).pages.Added.text, 'changed');
  await fs.unlink(file);
  changed();
  assert.equal((await index.get(root)).pages.Added, undefined);
  assert.equal(notifications, 6);
  releaseA();
  assert.equal(disposed, 0);
  releaseB();
  assert.equal(disposed, 1);
});
test('an invalidated in-flight scan is never returned as the current index', async () => {
  let finish,
    scans = 0;
  const index = new PageIndex({
    loadPages: () =>
      ++scans === 1
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve({ pages: { New: { text: 'new' } }, images: [] }),
  });
  const loading = index.get('/wiki');
  await Promise.resolve();
  index.invalidate('/wiki');
  finish({ pages: { Old: { text: 'old' } }, images: [] });
  assert.deepEqual(Object.keys((await loading).pages), ['New']);
  assert.equal(scans, 2);
  index.dispose();
});
test('unrelated documents do not invalidate other roots; saves do invalidate their root', async () => {
  let scans = 0,
    notifications = 0;
  const index = new PageIndex({
    loadPages: async () => {
      scans++;
      return { pages: {}, images: [] };
    },
  });
  index.retain('/wiki', () => notifications++);
  await index.get('/wiki');
  index.changed('/other/page.atwiki', true);
  assert.equal(notifications, 0);
  index.changed('/wiki/page.atwiki');
  await index.get('/wiki');
  assert.equal(scans, 1);
  index.changed('/wiki/page.atwiki', true);
  await index.get('/wiki');
  assert.equal(scans, 2);
  assert.equal(notifications, 2);
  index.dispose();
});
test('failed scans can be retried', async () => {
  let scans = 0;
  const index = new PageIndex({
    loadPages: async () => {
      if (++scans === 1) throw Error('read error');
      return { pages: {}, images: [] };
    },
  });
  await assert.rejects(index.get('/wiki'), /read error/);
  await index.get('/wiki');
  assert.equal(scans, 2);
  index.dispose();
});
