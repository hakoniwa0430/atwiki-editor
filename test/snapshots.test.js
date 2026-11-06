'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SnapshotStore, DirectorySnapshotStore, registerSnapshots } = require('../src/snapshots');

async function root(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-snapshots-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('snapshots survive reopening, preserve exact text and keep histories separate', async (t) => {
  const dir = await root(t),
    store = new SnapshotStore(dir),
    uri = 'file:///wiki/日本語.atwiki';
  const first = await store.save(uri, '初期\r\n\r\n', '公開前');
  const second = await store.save(uri, '変更後\n', '');
  await store.save('file:///other/日本語.atwiki', '別ファイル', '');
  const reopened = new SnapshotStore(dir),
    entries = await reopened.list(uri);
  assert.equal(entries.length, 2);
  assert.equal((await reopened.read(store.key(uri), first.id)).text, '初期\r\n\r\n');
  assert.equal((await reopened.read(store.key(uri), second.id)).text, '変更後\n');
  assert.deepEqual(await reopened.list('file:///unknown'), []);
  await assert.rejects(reopened.read('../outside', first.id));
  await assert.rejects(reopened.read(store.key(uri), '../../outside'));
});

test('commands capture dirty contents, open read-only saved text against the live document and handle cancel/errors', async (t) => {
  const dir = await root(t),
    commands = {},
    providers = {},
    messages = [],
    errors = [],
    diffs = [];
  const document = {
    uri: { scheme: 'file', toString: () => 'file:///wiki/test.atwiki' },
    fileName: path.join(dir, 'test.atwiki'),
    isUntitled: false,
    text: '未保存の内容',
    getText() {
      return this.text;
    },
  };
  let label = '変更前',
    cancelPick = false;
  const disposable = { dispose() {} };
  const api = {
    Uri: { from: (value) => value },
    workspace: {
      registerTextDocumentContentProvider(s, p) {
        providers[s] = p;
        return disposable;
      },
    },
    commands: {
      registerCommand(n, cb) {
        commands[n] = cb;
        return disposable;
      },
      async executeCommand(...args) {
        diffs.push(args);
      },
    },
    window: {
      activeTextEditor: { document },
      async showInputBox() {
        return label;
      },
      async showQuickPick(items) {
        return cancelPick ? undefined : items[0];
      },
      showInformationMessage: (m) => messages.push(m),
      showErrorMessage: (m) => errors.push(m),
    },
  };
  registerSnapshots(api, { globalStorageUri: { fsPath: dir }, subscriptions: [] });
  await commands['atwiki.compareSnapshot']();
  assert.equal(diffs.length, 0);
  await commands['atwiki.saveSnapshot']();
  document.text = 'さらに変更';
  await commands['atwiki.compareSnapshot']();
  assert.equal(diffs[0][0], 'vscode.diff');
  assert.equal(diffs[0][2], document.uri);
  assert.equal(
    await providers['atwiki-snapshot'].provideTextDocumentContent(diffs[0][1]),
    '未保存の内容',
  );
  assert.equal((await new DirectorySnapshotStore().list(document.fileName)).length, 1);
  cancelPick = true;
  await commands['atwiki.selectSnapshot']();
  assert.equal(diffs.length, 1);
  document.isUntitled = true;
  await commands['atwiki.saveSnapshot']();
  assert.match(messages.at(-1), /名前を付けて/);
  document.isUntitled = false;
  label = '失敗';
  const failing = path.join(dir, 'not-a-directory');
  await fs.writeFile(failing, 'x');
  document.fileName = path.join(failing, 'test.atwiki');
  await commands['atwiki.saveSnapshot']();
  assert.equal(errors.length, 1);
});

test('directory history keeps original names, survives moving folders and excludes other files', async (t) => {
  const dir = await root(t),
    store = new DirectorySnapshotStore(),
    file = path.join(dir, '攻略.atwiki');
  const saved = await store.save(file, '日本語\r\n');
  assert.equal(path.basename(saved.file), '攻略.atwiki');
  assert.equal(await fs.readFile(saved.file, 'utf8'), '日本語\r\n');
  await store.save(path.join(dir, '別.atwiki'), '別');
  assert.equal((await store.list(file)).length, 1);
  const moved = path.join(dir, 'moved');
  await fs.mkdir(moved);
  await fs.rename(path.join(dir, '.atwiki-history'), path.join(moved, '.atwiki-history'));
  const entries = await store.list(path.join(moved, '攻略.atwiki'));
  assert.equal(await store.read(entries[0].file), '日本語\r\n');
  await assert.rejects(store.read(path.join(dir, 'outside.txt')));
});

async function restoreApp(
  t,
  { cancel = false, legacy = false, saveOK = true, backupFails = false } = {},
) {
  const dir = await root(t),
    file = path.join(dir, '復元.atwiki'),
    store = new DirectorySnapshotStore(),
    commands = {},
    messages = [],
    errors = [];
  const doc = {
    fileName: file,
    uri: { scheme: 'file', toString: () => 'file:///restore.atwiki' },
    text: '未保存の変更',
    version: 1,
    isUntitled: false,
    getText() {
      return this.text;
    },
    positionAt(offset) {
      return offset;
    },
    async save() {
      if (saveOK) await fs.writeFile(file, this.text);
      return saveOK;
    },
  };
  await fs.writeFile(file, 'ディスクの内容');
  if (legacy)
    await new SnapshotStore(path.join(dir, 'snapshots')).save(
      doc.uri.toString(),
      '過去の内容',
      '旧履歴',
    );
  else await store.save(file, '過去の内容');
  let edits = 0,
    selected;
  const api = {
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    workspace: {
      registerTextDocumentContentProvider() {
        return { dispose() {} };
      },
    },
    commands: {
      registerCommand(n, cb) {
        commands[n] = cb;
        return { dispose() {} };
      },
    },
    window: {
      activeTextEditor: { document: doc },
      showInformationMessage: (m) => messages.push(m),
      showErrorMessage: (m) => errors.push(m),
      async showQuickPick(items) {
        selected = items[0];
        if (backupFails) {
          await fs.rm(path.join(dir, '.atwiki-history'), { recursive: true, force: true });
          await fs.writeFile(path.join(dir, '.atwiki-history'), 'blocked');
        }
        return cancel ? undefined : selected;
      },
      async showTextDocument() {
        return {
          async edit(callback, options) {
            assert.equal(options.undoStopBefore, true);
            assert.equal(options.undoStopAfter, true);
            callback({
              replace(range, text) {
                assert.equal(range.end, doc.text.length);
                doc.text = text;
                doc.version++;
              },
            });
            edits++;
            return true;
          },
        };
      },
    },
  };
  registerSnapshots(api, { globalStorageUri: { fsPath: dir }, subscriptions: [] });
  return {
    doc,
    store,
    file,
    messages,
    errors,
    run: () => commands['atwiki.restoreSnapshot'](),
    edits: () => edits,
  };
}

test('restore saves selected text to disk, retaining unsaved edits in history', async (t) => {
  const app = await restoreApp(t);
  await app.run();
  assert.equal(app.doc.text, '過去の内容');
  assert.equal(await fs.readFile(app.file, 'utf8'), '過去の内容');
  const texts = await Promise.all(
    (await app.store.list(app.file)).map((e) => app.store.read(e.file)),
  );
  assert.ok(texts.includes('未保存の変更'));
  assert.ok(texts.includes('過去の内容'));
  assert.equal(app.edits(), 1);
  assert.equal(app.errors.length, 0);
});

test('canceling restore leaves the file, buffer and history unchanged', async (t) => {
  const app = await restoreApp(t, { cancel: true });
  await app.run();
  assert.equal(app.edits(), 0);
  assert.equal(app.doc.text, '未保存の変更');
  assert.equal(await fs.readFile(app.file, 'utf8'), 'ディスクの内容');
  assert.equal((await app.store.list(app.file)).length, 1);
});

test('legacy snapshots can be restored with a directory backup', async (t) => {
  const app = await restoreApp(t, { legacy: true });
  await app.run();
  assert.equal(await fs.readFile(app.file, 'utf8'), '過去の内容');
  assert.equal((await app.store.list(app.file)).length, 1);
  assert.equal(app.errors.length, 0);
});

test('failed save reports unsaved restoration without claiming success', async (t) => {
  const app = await restoreApp(t, { saveOK: false });
  await app.run();
  assert.equal(app.doc.text, '過去の内容');
  assert.equal(await fs.readFile(app.file, 'utf8'), 'ディスクの内容');
  assert.match(app.errors[0], /保存に失敗/);
  assert.equal(app.messages.length, 0);
});

test('backup failure aborts restore before replacing any content', async (t) => {
  const app = await restoreApp(t, { legacy: true, backupFails: true });
  await app.run();
  assert.equal(app.edits(), 0);
  assert.equal(app.doc.text, '未保存の変更');
  assert.equal(app.errors.length, 1);
});
