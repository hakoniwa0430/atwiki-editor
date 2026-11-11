'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerWikiDiffView } = require('../src/wiki-diff-view');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const uri = (value) => ({ scheme: 'file', fsPath: value, toString: () => value });
  const folders = [
    { name: 'A', uri: uri('/a') },
    { name: 'B', uri: uri('/b') },
  ];
  const commands = {},
    events = {},
    calls = [],
    files = new Map(),
    entries = [];
  const disposable = { dispose() {} };
  const vscode = {
    EventEmitter: class {
      event() {
        return disposable;
      }
      fire() {}
      dispose() {}
    },
    TreeItem: class {
      constructor(label) {
        this.label = label;
      }
    },
    ThemeIcon: class {},
    TreeItemCollapsibleState: { Expanded: 2, None: 0 },
    Uri: { parse: uri },
    workspace: {
      isTrusted: true,
      workspaceFolders: folders,
      textDocuments: [],
      getWorkspaceFolder: (file) =>
        folders.find((folder) => file.fsPath.startsWith(folder.uri.fsPath + '/')),
      openTextDocument: async (uri) => ({ uri }),
      onDidChangeTextDocument: (cb) => {
        events.edit = cb;
        return disposable;
      },
      onDidChangeWorkspaceFolders: (cb) => {
        events.folders = cb;
        return disposable;
      },
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidCreate: () => disposable,
        onDidChange: () => disposable,
        onDidDelete: () => disposable,
      }),
    },
    window: {
      onDidChangeWindowState: (cb) => {
        events.focus = cb;
        return disposable;
      },
      createTreeView: () =>
        Object.assign(disposable, {
          onDidChangeVisibility: (cb) => {
            events.visibility = cb;
            return { dispose() {} };
          },
        }),
      showErrorMessage: (message) => calls.push(message),
    },
    commands: {
      registerCommand: (name, cb) => {
        commands[name] = cb;
        return disposable;
      },
    },
  };
  const context = { subscriptions: [], secrets: { get: async () => 'connected' } };
  const pages = [
    { pageid: 1, pagename: 'One' },
    { pageid: 2, pagename: 'Two' },
  ];
  const services = {
    store: { entries: async () => entries },
    connectionKey: (root) => root,
    api: {
      session: async (key) => ({ wiki: key === '/a' ? 'alpha' : 'beta' }),
      page: async (_config, id) => ({ pageid: id, pagename: 'Page', source: 'remote' }),
    },
    allPages: async () => pages,
    readSaved: async (name) => {
      if (!files.has(name)) throw Object.assign(Error('missing'), { code: 'ENOENT' });
      return files.get(name);
    },
    diff: async (...args) => calls.push(args),
    refresh: () => calls.push('refresh'),
  };
  const view = registerWikiDiffView(vscode, context, services);
  t.after(() => context.subscriptions.forEach((item) => item.dispose()));
  return {
    view,
    services,
    entries,
    files,
    vscode,
    commands,
    calls,
    events,
    uri,
    pages,
    treeView: disposable,
  };
}

test('全ページをフォルダ別に比較し、未取得・未保存編集・本家一覧にないページを区別する', async (t) => {
  const h = setup(t);
  h.entries.push(
    { uri: '/a/one.atwiki', wiki: 'alpha', page: { pageid: 1, pagename: 'One', source: 'base' } },
    { uri: '/a/old.atwiki', wiki: 'alpha', page: { pageid: 3, pagename: 'Old', source: 'old' } },
  );
  h.files.set('/a/one.atwiki', 'base');
  h.vscode.workspace.textDocuments.push({ uri: h.uri('/a/one.atwiki'), getText: () => 'unsaved' });
  await h.view.refresh();
  const roots = h.view.provider.getChildren();
  assert.equal(roots.length, 2);
  const rows = h.view.provider.getChildren(roots[0]);
  assert.deepEqual(
    rows.map((row) => row.state),
    ['conflict', 'missing', 'unavailable'],
  );
  assert.deepEqual(
    roots[1].children.map((row) => row.state),
    ['missing', 'missing'],
  );
  await h.commands['atwiki.openWikiDifference'](rows[0]);
  assert.equal(h.calls[0][0].uri.fsPath, '/a/one.atwiki');
  assert.equal(h.calls[0][1], 'remote');
  await h.commands['atwiki.openWikiDifference'](rows[1]);
  assert.equal(h.calls[1][3], '');
  assert.equal(h.files.get('/a/one.atwiki'), 'base');
  h.view.clear();
  await h.commands['atwiki.openWikiDifference'](rows[0]);
  assert.equal(h.calls.length, 2);
});

test('ページ取得失敗を他のページと分け、再更新で回復する', async (t) => {
  const h = setup(t);
  h.services.api.page = async (_config, id) => {
    if (id === 1) throw Error('通信失敗');
    return { source: 'remote' };
  };
  await h.view.refresh();
  assert.deepEqual(
    h.view.provider.getChildren()[0].children.map((row) => row.state),
    ['error', 'missing'],
  );
  h.services.api.page = async () => ({ source: 'remote' });
  await h.view.refresh();
  assert.deepEqual(
    h.view.provider.getChildren()[0].children.map((row) => row.state),
    ['missing', 'missing'],
  );
});

test('起動・時間経過・フォルダ変更では取得せず、手動確認後は終了時刻だけを表示する', async (t) => {
  const h = setup(t);
  let requests = 0;
  h.services.api.session = async () => {
    requests++;
    return { wiki: 'alpha' };
  };
  t.mock.timers.tick(7200000);
  h.events.folders();
  assert.equal(requests, 0);
  assert.deepEqual(h.calls, []);
  assert.equal(h.treeView.message, undefined);
  await h.view.refresh();
  assert.ok(requests > 0);
  assert.match(h.treeView.message, /^確認終了: \d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}$/);
  h.view.clear();
  assert.equal(h.treeView.message, undefined);
  h.vscode.workspace.isTrusted = false;
  h.services.store.entries = async () => {
    throw Error('must not read');
  };
  await h.view.refresh();
  assert.deepEqual(h.view.provider.getChildren(), []);
});

test('メニューを開くたび本家の変更を取得し、閉じる際は取得しない', async (t) => {
  const h = setup(t);
  let requests = 0;
  h.services.api.page = async () => ({ source: `remote-${++requests}` });
  await h.events.visibility({ visible: false });
  assert.equal(requests, 0);
  await h.events.visibility({ visible: true });
  assert.equal(requests, 4);
  assert.equal(h.view.provider.getChildren()[0].children[0].remote.source, 'remote-1');
  await h.events.visibility({ visible: false });
  assert.equal(requests, 4);
  await h.events.visibility({ visible: true });
  assert.equal(requests, 8);
  assert.equal(h.view.provider.getChildren()[0].children[0].remote.source, 'remote-5');
  h.vscode.workspace.isTrusted = false;
  await h.events.visibility({ visible: true });
  assert.equal(requests, 8);
});

test('変更なし・片側変更・欠損ファイルを区別する', async (t) => {
  const h = setup(t);
  h.entries.push({ uri: '/a/one.atwiki', wiki: 'alpha', page: { pageid: 1, source: 'base' } });
  const state = async () => {
    await h.view.refresh();
    return h.view.provider.getChildren()[0].children.find((row) => row.label === 'One').state;
  };
  assert.equal(await state(), 'missing');
  h.files.set('/a/one.atwiki', 'base');
  assert.equal(await state(), 'remote');
  h.files.set('/a/one.atwiki', 'remote');
  assert.equal(await state(), 'equal');
  const root = h.view.provider.getChildren()[0];
  assert.deepEqual(
    h.view.provider.getChildren(root).map((row) => row.label),
    ['Two'],
  );
  assert.equal(h.view.provider.getTreeItem(root).description, '1件');
  let local = 'edited';
  h.vscode.workspace.textDocuments.push({ uri: h.uri('/a/one.atwiki'), getText: () => local });
  h.events.edit();
  t.mock.timers.tick(250);
  await new Promise(setImmediate);
  assert.equal(h.view.provider.getChildren(root).length, 2);
  local = 'remote';
  h.events.edit();
  t.mock.timers.tick(250);
  await new Promise(setImmediate);
  assert.equal(h.view.provider.getChildren(root).length, 1);
  h.vscode.workspace.textDocuments.length = 0;
  h.services.api.page = async () => ({ source: 'base' });
  assert.equal(await state(), 'local');
  h.pages.pop();
  h.files.set('/a/one.atwiki', 'base');
  await h.view.refresh();
  const equalRoot = h.view.provider.getChildren()[0];
  assert.deepEqual(h.view.provider.getChildren(equalRoot), []);
  assert.equal(h.view.provider.getTreeItem(equalRoot).description, '差分なし');
});

test('改行コードだけが違う本文を差分一覧に残さず、空白の変更は表示する', async (t) => {
  const h = setup(t);
  h.pages.splice(1);
  h.entries.push({ uri: '/a/one.atwiki', wiki: 'alpha', page: { pageid: 1, source: 'old' } });
  h.services.api.page = async () => ({ source: 'one\r\ntwo\r\n' });
  h.files.set('/a/one.atwiki', 'one\ntwo\n');
  await h.view.refresh();
  assert.deepEqual(h.view.provider.getChildren(h.view.provider.getChildren()[0]), []);
  h.files.set('/a/one.atwiki', 'one \ntwo\n');
  await h.view.refresh();
  assert.equal(h.view.provider.getChildren(h.view.provider.getChildren()[0]).length, 1);
});

test('Wiki本文の末尾に単独CRがあってもエディターと同じ改行として比較する', async (t) => {
  const h = setup(t);
  h.pages.splice(1);
  h.entries.push({ uri: '/a/one.atwiki', wiki: 'alpha', page: { pageid: 1, source: 'body\r' } });
  h.services.api.page = async () => ({ source: 'body\r' });
  h.files.set('/a/one.atwiki', 'body\n');
  await h.view.refresh();
  assert.deepEqual(h.view.provider.getChildren(h.view.provider.getChildren()[0]), []);
  h.vscode.workspace.textDocuments.push({ uri: h.uri('/a/one.atwiki'), getText: () => 'body\r\n' });
  await h.view.refresh();
  assert.deepEqual(h.view.provider.getChildren(h.view.provider.getChildren()[0]), []);
  h.vscode.workspace.textDocuments.length = 0;
  h.files.set('/a/one.atwiki', 'body');
  await h.view.refresh();
  assert.equal(h.view.provider.getChildren(h.view.provider.getChildren()[0]).length, 1);
});

test('一覧表示後の本家更新は差分を開くと再取得し、一致した行を除外する', async (t) => {
  const h = setup(t);
  h.entries.push({ uri: '/a/one.atwiki', wiki: 'alpha', page: { pageid: 1, source: 'base' } });
  h.files.set('/a/one.atwiki', 'posted');
  await h.view.refresh();
  const root = h.view.provider.getChildren()[0];
  const row = root.children.find((row) => row.uri);
  h.services.api.page = async () => ({ source: 'posted' });
  await h.commands['atwiki.openWikiDifference'](row);
  assert.equal(h.calls[0][1], 'posted');
  assert.equal(row.state, 'equal');
  assert.ok(!h.view.provider.getChildren(root).includes(row));
});

test('Wikiをブラウザで更新して戻った際、表示中の一覧を再取得する', async (t) => {
  const h = setup(t);
  h.treeView.visible = true;
  await h.view.refresh();
  h.services.api.page = async () => ({ source: 'updated' });
  await h.events.focus({ focused: true });
  assert.equal(h.view.provider.getChildren()[0].children[0].remote.source, 'updated');
  h.treeView.visible = false;
  h.services.api.page = async () => {
    throw Error('must not request');
  };
  await h.events.focus({ focused: true });
  assert.equal(h.view.provider.getChildren()[0].children[0].remote.source, 'updated');
});
