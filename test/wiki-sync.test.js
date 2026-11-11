'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const {
  wikiId,
  redirectUrl,
  authorization,
  callbackCode,
  WikiApi,
  validatePage,
  syncState,
  request,
} = require('../src/wiki-api');

test('HTTPエラー・リダイレクトで秘密の応答本文を表示せず、JSON以外を拒否する', async (t) => {
  let status = 302,
    body = 'secret-code-token',
    count = 0;
  t.mock.method(https, 'request', (_url, _options, callback) => {
    count++;
    const req = new EventEmitter();
    req.end = () =>
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = status;
        callback(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
        req.emit('close');
      });
    req.destroy = (error) => {
      req.emit('error', error);
      req.emit('close');
    };
    return req;
  });
  await assert.rejects(request('https://w.atwiki.jp/_api/v1/wikis/sample/whoami'), (error) => {
    assert.equal(error.status, 302);
    assert.doesNotMatch(error.message, /secret-code-token/);
    return true;
  });
  assert.equal(count, 1);
  status = 409;
  await assert.rejects(request('https://w.atwiki.jp/'), /本家が更新/);
  status = 200;
  await assert.rejects(request('https://w.atwiki.jp/'), /正しいJSON/);
  body = JSON.stringify({ ok: true });
  assert.deepEqual(await request('https://w.atwiki.jp/'), { ok: true });
});
const { SyncStore, registerWikiSync } = require('../src/wiki-sync');

const page = (source = 'base', etag = '"1-a"') => ({ pageid: 1, pagename: 'テスト', source, etag });
const config = {
  wiki: 'sample',
  clientId: 'client',
  clientSecret: 'secret',
  redirect: 'https://callback.example/return',
  accessToken: 'access',
  refreshToken: 'refresh',
  expires: Date.now() + 3600000,
};
function secrets(initial = config) {
  let value = JSON.stringify(initial);
  return {
    get: async () => value,
    store: async (_key, next) => {
      value = next;
    },
    delete: async () => {
      value = undefined;
    },
  };
}
test('Wiki URLは公式HTTPSホストに限定し、偽装ホスト・資格情報を拒否する', () => {
  assert.equal(wikiId('https://w.atwiki.jp/sample/pages/123.html'), 'sample');
  assert.equal(wikiId(' sample '), 'sample');
  assert.throws(() => wikiId('_api'));
  assert.throws(() => wikiId('../sample'));
  for (const value of [
    'http://w.atwiki.jp/a/',
    'https://w.atwiki.jp.evil.test/a/',
    'https://user:secret@w.atwiki.jp/a/',
    'https://w.atwiki.jp:8443/a/',
    'https://w.atwiki.jp/_api/',
    'file:///a',
  ])
    assert.throws(() => wikiId(value));
  assert.equal(redirectUrl(config.redirect), config.redirect);
  for (const value of [
    'http://example.org/cb',
    'vscode://extension/callback',
    'https://example.org/cb?code=x',
    'https://example.org/#x',
  ])
    assert.throws(() => redirectUrl(value));
});
test('OAuthのPKCEとstate・戻り先・期限を照合する', () => {
  const pending = authorization(config),
    url = new URL(pending.url);
  assert.equal(
    url.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(pending.verifier).digest('base64url'),
  );
  assert.equal(url.searchParams.get('audience'), 'https://w.atwiki.jp/_api/v1');
  assert.equal(url.searchParams.get('scope'), 'user:read wiki:read wiki:write offline_access');
  const returned = `${config.redirect}?code=valid&state=${pending.state}`;
  assert.equal(callbackCode(returned, config, pending), 'valid');
  for (const value of [
    returned.replace('callback.example', 'evil.example'),
    returned.replace('/return', '/wrong'),
    returned.replace(pending.state, 'wrong'),
    returned + '&code=other',
    returned + '&state=other',
    returned + '&error=access_denied',
  ])
    assert.throws(() => callbackCode(value, config, pending));
  assert.throws(() => callbackCode(returned, config, { ...pending, created: Date.now() - 600001 }));
});
test('APIの投稿は公式ホストへ全文とETagを送り、応答を検証する', async () => {
  let request;
  const api = new WikiApi(secrets(), async (url, options) => {
    request = { url, ...options };
    return { data: page('new', '"1-b"') };
  });
  assert.equal((await api.publish(config, page(), 'new')).etag, '"1-b"');
  assert.equal(request.url, 'https://w.atwiki.jp/_api/v1/wikis/sample/pages/1');
  assert.equal(request.method, 'PUT');
  assert.equal(request.headers['If-Match'], '"1-a"');
  assert.equal(request.headers.Authorization, 'Bearer access');
  assert.deepEqual(JSON.parse(request.body), { body: 'new' });
  assert.match(request.headers['Idempotency-Key'], /^[a-f0-9-]{36}$/);
  await assert.rejects(api.call(config, '/pages/1/../../outside'));
  for (const invalid of [
    { ...page(), etag: '' },
    { ...page(), source: undefined },
    { ...page(), pageid: -1 },
  ])
    assert.throws(() => validatePage(invalid));
});
test('失効前のトークン更新はローテーションされた秘密情報を保存する', async () => {
  const vault = secrets({ ...config, expires: 0 });
  let calls = 0;
  const api = new WikiApi(vault, async (url, options) => {
    calls++;
    assert.equal(url, 'https://auth.atwiki.jp/oauth2/token');
    assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'refresh');
    return { access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600 };
  });
  assert.equal((await api.session()).accessToken, 'next-access');
  assert.equal(JSON.parse(await vault.get()).refreshToken, 'next-refresh');
  await api.session();
  assert.equal(calls, 1);
});
test('不正なトークン応答では保存済みの接続を失わない', async () => {
  const vault = secrets({ ...config, expires: 0 }),
    original = await vault.get();
  const api = new WikiApi(vault, async () => ({ access_token: 'x', expires_in: 3600 }));
  await assert.rejects(api.session(), /トークン応答/);
  assert.equal(await vault.get(), original);
});
test('同期の3方向比較は一致・片側変更・競合を区別する', () => {
  assert.equal(syncState('base', 'new', 'new'), 'equal');
  assert.equal(syncState('base', 'base', 'remote'), 'remote');
  assert.equal(syncState('base', 'local', 'base'), 'local');
  assert.equal(syncState('base', 'local', 'remote'), 'conflict');
});
test('同期基準を永続化し、不正な別ファイルの関連付けを拒否する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SyncStore(root),
    uri = 'file:///wiki/test.atwiki';
  assert.equal(await store.read(uri), undefined);
  await store.save(uri, 'sample', page());
  await store.save(uri, 'sample', page('new', '"1-b"'));
  assert.equal((await new SyncStore(root).read(uri)).page.source, 'new');
  const entry = JSON.parse(await fs.readFile(store.file(uri), 'utf8'));
  entry.uri = 'file:///other';
  await fs.writeFile(store.file(uri), JSON.stringify(entry));
  await assert.rejects(store.read(uri), /同期情報/);
});

function harness({
  local = 'base',
  remote = page(),
  base = page(),
  wiki = 'sample',
  sidebar = false,
} = {}) {
  const disk = { text: local };
  const calls = { messages: [], diffs: [], saves: [], posts: [] };
  const uri = (value) => ({
    scheme: value.split(':')[0],
    fsPath: '/wiki/page.atwiki',
    toString: () => value,
  });
  const doc = {
    uri: uri('file:///wiki/page.atwiki'),
    fileName: '/wiki/page.atwiki',
    text: local,
    version: 1,
    getText() {
      return this.text;
    },
    positionAt: (n) => n,
  };
  const api = {
    session: async () => config,
    page: async () => remote,
    publish: async (_config, expected, text) => {
      calls.posts.push({ expected, text });
      return page(text, '"1-c"');
    },
  };
  const context = {
    globalStorageUri: { fsPath: '/storage' },
    secrets: secrets(),
    subscriptions: [],
  };
  const vscode = {
    Uri: { parse: uri },
    ProgressLocation: { Notification: 15 },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    WorkspaceEdit: class {
      replace(_uri, _range, text) {
        this.text = text;
      }
    },
    workspace: {
      isTrusted: true,
      onDidSaveTextDocument: (listener) => {
        calls.onSave = listener;
        return { dispose() {} };
      },
      onDidCloseTextDocument: (listener) => {
        calls.onClose = listener;
        return { dispose() {} };
      },
      registerTextDocumentContentProvider: (_scheme, provider) => {
        calls.provider = provider;
        return { dispose() {} };
      },
      applyEdit: async (edit) => {
        doc.text = edit.text;
        doc.version++;
        return true;
      },
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (...args) => {
        calls.diffs.push(args);
      },
    },
    window: {
      createTreeView: sidebar ? () => {} : undefined,
      registerUriHandler: (handler) => {
        calls.uriHandler = handler;
        return { dispose() {} };
      },
      withProgress: async (_options, task) =>
        task({}, { onCancellationRequested: () => ({ dispose() {} }) }),
      createStatusBarItem: () => (calls.status = { show() {}, dispose() {} }),
      activeTextEditor: { document: doc },
      showInformationMessage: (message) => calls.messages.push(message),
      showErrorMessage: (message) => calls.messages.push(message),
      showWarningMessage: async (...args) => {
        calls.messages.push(args[0]);
        return args[2];
      },
    },
  };
  const store = {
    read: async () => ({ wiki, page: base }),
    save: async (...args) => calls.saves.push(args),
  };
  const actions = registerWikiSync(vscode, context, {
    readSaved: async () => disk.text,
    api,
    store,
    syncImages: async (...args) => {
      (calls.images ||= []).push(args);
      return { updated: 1, kept: 0, problems: [] };
    },
  });
  return { actions, calls, doc, vscode, api, store, context, disk };
}

test('取得・投稿・比較の終了後に差分一覧を更新する', async (t) => {
  let refreshed = 0;
  t.mock.method(require('../src/wiki-diff-view'), 'registerWikiDiffView', () => ({
    refresh: async () => {
      refreshed++;
    },
    clear() {},
  }));
  const h = harness({ sidebar: true });
  await h.actions.pullCurrentWikiPage();
  assert.equal(refreshed, 1);
  await h.actions.publishWikiPage();
  assert.equal(refreshed, 2);
  await h.actions.compareWikiPage();
  assert.equal(refreshed, 3);
  await h.actions.refreshWikiDifferences();
  assert.equal(refreshed, 4);
});

test('同期と投稿の完了結果が通知され、ステータスバーにも残る', async () => {
  const h = harness();
  await h.actions.pullCurrentWikiPage();
  assert.match(h.calls.messages.at(-1), /同期完了/);
  assert.match(h.calls.status.tooltip, /画像: 1件/);
  h.doc.text = 'new';
  h.disk.text = 'new';
  await h.actions.publishWikiPage();
  assert.match(h.calls.messages.at(-1), /投稿完了/);
  assert.match(h.calls.status.text, /投稿完了/);
  assert.equal(h.calls.status.command, 'atwiki.showSyncResult');
});

test('通信失敗を操作名付きで通知し、実行中表示を残さない', async () => {
  const h = harness();
  h.api.session = async () => {
    throw Error('通信エラー');
  };
  await h.actions.pullCurrentWikiPage();
  assert.match(h.calls.messages.at(-1), /同期に失敗しました: 通信エラー/);
  assert.match(h.calls.status.text, /\$\(error\)/);
  await h.actions.publishWikiPage();
  assert.match(h.calls.messages.at(-1), /投稿に失敗しました/);
});

test('投稿後の同期基準保存失敗は投稿自体の失敗と区別する', async () => {
  const h = harness({ local: 'new' });
  h.store.save = async () => {
    throw Error('保存エラー');
  };
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts.length, 1);
  assert.match(h.calls.messages.at(-1), /投稿は完了しましたが、同期基準の保存に失敗/);
  assert.match(h.calls.status.text, /\$\(warning\)/);
});
test('ファイル選択による更新は指定した1ファイルだけを送信する', async () => {
  const h = harness({ local: 'selected content' });
  h.vscode.window.activeTextEditor = undefined;
  h.vscode.window.showOpenDialog = async (options) => {
    assert.equal(options.canSelectMany, false);
    return [h.doc.uri];
  };
  h.vscode.workspace.openTextDocument = async (uri) => {
    assert.equal(uri, h.doc.uri);
    return h.doc;
  };
  await h.actions.updateWikiPage();
  assert.equal(h.calls.posts.length, 1);
  assert.equal(h.calls.posts[0].text, 'selected content');
  assert.match(h.calls.messages[0], /page.atwiki/);
});

test('更新ボタンと右クリックはアクティブな別ファイルではなく指定URIを使う', async () => {
  const h = harness({ local: 'target' });
  h.vscode.window.activeTextEditor = { document: { getText: () => 'other' } };
  h.vscode.window.showOpenDialog = async () => assert.fail('指定済みなら選択し直さない');
  h.vscode.workspace.openTextDocument = async (uri) => {
    assert.equal(uri, h.doc.uri);
    return h.doc;
  };
  await h.actions.updateWikiPage(h.doc.uri, [h.doc.uri]);
  assert.equal(h.calls.posts.length, 1);
  assert.equal(h.calls.posts[0].text, 'target');
});

test('ファイル選択のキャンセル・複数選択・不正な対象は送信しない', async () => {
  const h = harness({ local: 'local' });
  h.vscode.window.showOpenDialog = async () => undefined;
  h.vscode.workspace.openTextDocument = async () => assert.fail('開かない');
  await h.actions.updateWikiPage();
  await h.actions.updateWikiPage(h.doc.uri, [h.doc.uri, h.doc.uri]);
  await h.actions.updateWikiPage({ scheme: 'https', fsPath: '/a.atwiki' });
  await h.actions.updateWikiPage({ scheme: 'file', fsPath: '/a.png' });
  await h.actions.updateWikiPage({ scheme: 'file', fsPath: '/.atwiki-history/a.txt' });
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.messages.length, 4);
});

test('指定ファイルの未接続・競合・確認中の変更・投稿キャンセルを拒否する', async () => {
  for (const mode of ['unlinked', 'conflict', 'changed', 'cancel']) {
    const h = harness({ local: 'local', remote: mode === 'conflict' ? page('remote') : page() });
    h.vscode.workspace.openTextDocument = async () => h.doc;
    if (mode === 'unlinked') h.store.read = async () => undefined;
    h.vscode.window.showWarningMessage = async () => {
      if (mode === 'cancel') return undefined;
      if (mode === 'changed') h.disk.text = 'changed';
      return 'この内容を投稿';
    };
    await h.actions.updateWikiPage(h.doc.uri);
    assert.equal(h.calls.posts.length, 0, mode);
    assert.equal(h.calls.saves.length, 0, mode);
  }
});

test('本家のみの更新は本文の保存後に基準を更新する', async () => {
  const h = harness({ remote: page('remote', '"1-b"') });
  await h.actions.pullCurrentWikiPage();
  assert.equal(h.doc.text, 'remote');
  assert.equal(h.calls.saves.length, 0);
  h.disk.text = h.doc.text;
  await h.calls.onSave(h.doc);
  assert.equal(h.calls.saves[0][2].source, 'remote');
  assert.equal(h.calls.images.length, 1);
});

test('取り込みを破棄して再度開いた場合も再取得でき、投稿は競合で止まる', async () => {
  const h = harness({ remote: page('remote', '"1-b"') });
  await h.actions.pullCurrentWikiPage();
  h.calls.onClose(h.doc);
  h.doc.text = h.disk.text;
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.saves.length, 0);
  await h.actions.pullCurrentWikiPage();
  assert.equal(h.doc.text, 'remote');
});

test('同期メタデータは欠損を含めてキャッシュし保存と無効化で更新する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SyncStore(root);
  const read = t.mock.method(store, 'read');
  const uri = 'file:///page.atwiki';
  await Promise.all([store.readMetadata(uri), store.readMetadata(uri)]);
  assert.equal(read.mock.callCount(), 1);
  await store.save(uri, 'sample', page());
  assert.deepEqual(await store.readMetadata(uri), {
    wiki: 'sample',
    pageid: 1,
    pagename: 'テスト',
  });
  await store.readMetadata(uri);
  assert.equal(read.mock.callCount(), 2);
  await fs.unlink(store.file(uri));
  store.invalidateMetadata();
  assert.equal(await store.readMetadata(uri), undefined);
  assert.equal(read.mock.callCount(), 3);
});
test('競合では取り込みも投稿も本文・基準を変更しない', async () => {
  const h = harness({ local: 'local', remote: page('remote', '"1-b"') });
  await h.actions.pullCurrentWikiPage();
  await h.actions.publishWikiPage();
  assert.equal(h.doc.text, 'local');
  assert.equal(h.calls.saves.length, 0);
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.diffs.length, 2);
});
test('確認済みの投稿は取得時のETagを使い、新しい基準を保存する', async () => {
  const h = harness({ local: 'local' });
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts[0].expected.etag, '"1-a"');
  assert.equal(h.calls.posts[0].text, 'local');
  assert.equal(h.calls.saves[0][2].etag, '"1-c"');
});
test('投稿確認中の保存済み本文の変更とキャンセルでは送信しない', async () => {
  for (const cancel of [true, false]) {
    const h = harness({ local: 'local' });
    h.vscode.window.showWarningMessage = async () => {
      if (cancel) return undefined;
      h.doc.text = 'changed';
      h.disk.text = 'changed';
      h.doc.version++;
      return 'この内容を投稿';
    };
    await h.actions.publishWikiPage();
    assert.equal(h.calls.posts.length, 0);
    assert.equal(h.calls.saves.length, 0);
  }
});

test('更新・投稿の差分と送信は保存済み本文だけを使う', async () => {
  for (const action of ['publishWikiPage', 'updateWikiPage']) {
    const h = harness({ local: 'saved content' });
    h.doc.text = 'unsaved draft';
    h.vscode.workspace.openTextDocument = async () => h.doc;
    h.vscode.window.showWarningMessage = async (message) => {
      assert.doesNotMatch(message, /未保存/);
      h.doc.text = 'another draft';
      h.doc.version++;
      return 'この内容を投稿';
    };
    await h.actions[action](h.doc.uri);
    assert.equal(h.calls.posts[0].text, 'saved content');
    assert.equal(h.calls.provider.provideTextDocumentContent(h.calls.diffs[0][2]), 'saved content');
    assert.equal(h.doc.text, 'another draft');
    assert.doesNotMatch(h.calls.messages.at(-1), /未保存/);
  }
});
test('投稿競合エラーでは再送せず同期基準も更新しない', async () => {
  const h = harness({ local: 'local' });
  let count = 0;
  h.api.publish = async () => {
    count++;
    throw Error('本家が更新されています。');
  };
  await h.actions.publishWikiPage();
  assert.equal(count, 1);
  assert.equal(h.calls.saves.length, 0);
});
test('同じ本文で投稿済みなら再送せず基準を回復する', async () => {
  const h = harness({ local: 'posted', remote: page('posted', '"1-b"') });
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.saves[0][2].etag, '"1-b"');
});
test('違うWikiや未信頼ワークスペースからの投稿を拒否する', async () => {
  const h = harness({ local: 'local', wiki: 'different' });
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts.length, 0);
  assert.match(h.calls.messages[0], /different/);
  h.vscode.workspace.isTrusted = false;
  h.api.session = () => {
    throw Error('should not access credentials');
  };
  await h.actions.publishWikiPage();
  assert.match(h.calls.messages[1], /信頼/);
});
test('競合解決は明示確認後に基準だけ更新する', async () => {
  const h = harness({ local: 'merged', remote: page('remote', '"1-b"') });
  await h.actions.resolveWikiConflict();
  assert.equal(h.doc.text, 'merged');
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.saves[0][2].source, 'remote');
});

test('接続フローは3項目の入力だけで固定URIの認可を行い秘密情報を保存する', async () => {
  const h = harness();
  h.vscode.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: '/wiki' } }];
  const inputs = ['https://w.atwiki.jp/sample/', 'client', 'secret'];
  let pendingUrl;
  h.vscode.Uri.parse = (value) => ({ toString: () => value });
  h.vscode.env = {
    uriScheme: 'vscode',
    asExternalUri: async (uri) => uri,
    openExternal: async (uri) => {
      pendingUrl = new URL(uri.toString());
      assert.equal(pendingUrl.searchParams.get('redirect_uri'), 'https://vscode.dev/redirect');
      const callback = new URL(decodeURIComponent(pendingUrl.searchParams.get('state')));
      callback.searchParams.set('code', 'code');
      h.calls.uriHandler.handleUri(h.vscode.Uri.parse(callback.href));
      return true;
    },
  };
  h.vscode.window.showInputBox = async () => {
    assert.ok(inputs.length, 'リダイレクトURIなどの追加入力を求めない');
    return inputs.shift();
  };
  h.api.token = async (settings, fields) => {
    assert.equal(settings.wiki, 'sample');
    assert.equal(settings.redirect, 'https://vscode.dev/redirect');
    assert.equal(fields.redirect_uri, settings.redirect);
    assert.equal(inputs.length, 0);
    assert.equal(fields.code, 'code');
    assert.equal(fields.grant_type, 'authorization_code');
    assert.equal(
      crypto.createHash('sha256').update(fields.code_verifier).digest('base64url'),
      pendingUrl.searchParams.get('code_challenge'),
    );
    return { ...settings, accessToken: 'connected' };
  };
  h.api.call = async () => ({ wikiid: 'sample', scopes: ['user:read', 'wiki:read', 'wiki:write'] });
  await h.actions.connectWiki();
  assert.equal(JSON.parse(await h.context.secrets.get()).accessToken, 'connected');
  await h.actions.disconnectWiki();
  assert.equal(await h.context.secrets.get(), undefined);
});

test('権限不足の接続では以前の接続情報を保持する', async () => {
  const h = harness(),
    original = await h.context.secrets.get();
  h.vscode.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: '/wiki' } }];
  const inputs = ['https://w.atwiki.jp/sample/', 'client', 'secret'];
  let pending;
  h.vscode.env = {
    uriScheme: 'vscode',
    asExternalUri: async (uri) => uri,
    openExternal: async (uri) => {
      pending = new URL(uri.toString());
      assert.equal(pending.searchParams.get('redirect_uri'), 'https://vscode.dev/redirect');
      const callback = new URL(decodeURIComponent(pending.searchParams.get('state')));
      callback.searchParams.set('code', 'code');
      h.calls.uriHandler.handleUri(h.vscode.Uri.parse(callback.href));
      return true;
    },
  };
  h.vscode.window.showInputBox = async () => {
    assert.ok(inputs.length, 'リダイレクトURIなどの追加入力を求めない');
    return inputs.shift();
  };
  h.api.token = async () => config;
  h.api.call = async () => ({ wikiid: 'sample', scopes: ['wiki:read'] });
  await h.actions.connectWiki();
  assert.equal(await h.context.secrets.get(), original);
  assert.match(h.calls.messages.at(-1), /権限/);
});

test('全ページ同期はエディターを開かず同名ファイルを直接上書きし、ページIDを付けない', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const h = harness();
  const uri = (file) => ({ scheme: 'file', fsPath: file, toString: () => file });
  h.vscode.Uri.file = uri;
  h.vscode.workspace.workspaceFolders = [{ uri: uri(root) }];
  h.vscode.workspace.getWorkspaceFolder = () => undefined;
  const entries = new Map();
  h.store.read = async (key) => entries.get(key);
  h.store.save = async (key, wiki, page) => entries.set(key, { wiki, page });
  let source = 'base';
  h.api.call = async (_config, route) => {
    const query = new URLSearchParams(route.split('?')[1]);
    if (!query.has('cursor'))
      return { items: [{ pageid: 1, pagename: 'テスト' }], next_cursor: 'opaque+/=' };
    assert.equal(query.get('cursor'), 'opaque+/=');
    return { items: [{ pageid: 2, pagename: '../CON' }], next_cursor: null };
  };
  h.api.page = async (_config, id) => ({
    ...page(source),
    pageid: id,
    pagename: id === 1 ? 'テスト' : '../CON',
  });
  h.vscode.workspace.openTextDocument = async () => assert.fail('同期でドキュメントを開かない');
  h.vscode.workspace.applyEdit = async () => assert.fail('同期でエディターを編集しない');
  h.vscode.window.showTextDocument = async () => assert.fail('同期でタブを開かない');
  const file = path.join(root, 'テスト.atwiki');
  await fs.writeFile(file, 'unlinked existing work');
  await h.actions.downloadWikiPage();
  assert.equal(await fs.readFile(file, 'utf8'), 'base');
  assert.equal(
    (await fs.readdir(root)).some((name) => /-\d+\.atwiki$/.test(name)),
    false,
  );
  assert.equal(entries.size, 2);
  assert.equal(h.calls.images.length, 2);
  source = 'updated';
  await h.actions.pullWikiPage();
  assert.equal(await fs.readFile(file, 'utf8'), 'updated');
  await fs.writeFile(file, 'local work');
  source = 'remote conflict';
  await h.actions.pullWikiPage();
  assert.equal(await fs.readFile(file, 'utf8'), 'remote conflict');
  assert.match(h.calls.messages.at(-1), /0件未更新/);
  assert.equal(entries.get(file).page.source, 'remote conflict');
  const other = [...entries.keys()].find((key) => key !== file);
  assert.equal(path.dirname(other), root);
  assert.equal(await fs.readFile(other, 'utf8'), 'remote conflict');
  const dirtyDoc = {
    uri: uri(file),
    text: '',
    getText() {
      return this.text;
    },
  };
  dirtyDoc.text = 'unsaved local work';
  dirtyDoc.isDirty = true;
  h.vscode.workspace.textDocuments = [dirtyDoc];
  source = 'final remote';
  await h.actions.pullWikiPage();
  assert.equal(dirtyDoc.text, 'unsaved local work');
  assert.equal(await fs.readFile(file, 'utf8'), 'final remote');
  await assert.rejects(fs.access(path.join(root, '.atwiki-history')), { code: 'ENOENT' });
});

test('フォルダ未選択・循環カーソルでは同期を中止する', async () => {
  const h = harness();
  await h.actions.pullWikiPage();
  assert.match(h.calls.messages.at(-1), /フォルダ/);
  h.vscode.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: '/unused' } }];
  h.api.call = async () => ({ items: [], next_cursor: 'same' });
  await h.actions.pullWikiPage();
  assert.match(h.calls.messages.at(-1), /カーソル/);
});

test('同期処理の並行実行を抑止し、失敗後には再実行できる', async () => {
  const h = harness({ local: 'local' });
  let finish;
  h.api.page = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const running = h.actions.publishWikiPage();
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await h.actions.publishWikiPage();
  assert.match(h.calls.messages.at(-1), /進行中/);
  finish(page());
  await running;
  assert.equal(h.calls.posts.length, 1);
  h.api.page = async () => {
    throw Error('offline');
  };
  await h.actions.compareWikiPage();
  h.api.page = async () => page();
  await h.actions.compareWikiPage();
  assert.equal(h.calls.diffs.length, 2);
});

test('比較は毎回Wikiの最新本文を取得し、未保存の本文と比較する', async () => {
  const h = harness({ local: '未保存の編集' });
  let count = 0;
  h.api.page = async () => ({ ...page('最新' + ++count), updated_at: '2026-11-10T01:00:00Z' });
  await h.actions.compareWikiPage();
  await h.actions.compareWikiPage();
  assert.equal(count, 2);
  for (const [i, diff] of h.calls.diffs.entries()) {
    assert.equal(h.calls.provider.provideTextDocumentContent(diff[1]), '最新' + (i + 1));
    assert.equal(diff[2], h.doc.uri);
    assert.match(diff[3], /2026-11-10T01:00:00Z/);
  }
  assert.equal(h.doc.text, '未保存の編集');
  assert.equal(h.calls.saves.length, 0);
  h.api.page = async () => {
    throw Error('offline');
  };
  await h.actions.compareWikiPage();
  assert.equal(h.calls.diffs.length, 2);
  assert.match(h.calls.messages.at(-1), /offline/);
});

test('ページ追加は空本文を送り、権限を指定しない', async () => {
  let request;
  const api = new WikiApi(secrets(), async (url, options) => {
    request = { url, ...options };
    return { data: page('') };
  });
  await api.create(config, 'テスト');
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), { pagename: 'テスト', body: '' });
});

test('ページ追加で空ファイルを保存し関連付けて開く。同名ファイルは保護する', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-create-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const h = harness();
  h.vscode.workspace.workspaceFolders = [{ uri: { scheme: 'file', fsPath: root } }];
  h.vscode.Uri.file = (file) => ({ fsPath: file, toString: () => file });
  h.vscode.window.showInputBox = async () => '新規';
  let created = 0,
    opened;
  h.api.create = async () => {
    created++;
    return { ...page(''), pagename: '新規' };
  };
  h.vscode.workspace.openTextDocument = async (uri) => uri;
  h.vscode.window.showTextDocument = async (doc) => {
    opened = doc.fsPath;
  };
  await h.actions.createWikiPage();
  assert.equal(await fs.readFile(path.join(root, '新規.atwiki'), 'utf8'), '');
  assert.equal(opened, path.join(root, '新規.atwiki'));
  assert.equal(h.calls.saves.length, 1);
  await h.actions.createWikiPage();
  assert.equal(created, 1);
  assert.match(h.calls.messages.at(-1), /同名/);
});

test('フォルダ別の接続とトークン更新は他のフォルダに影響しない', async () => {
  const { connectionKey } = require('../src/wiki-sync');
  const a = connectionKey('/wiki-a'),
    b = connectionKey('/wiki-b');
  assert.notEqual(a, b);
  assert.equal(a, connectionKey('/wiki-a/child/..'));
  const values = new Map([
    [a, JSON.stringify({ ...config, wiki: 'hoge', expires: 0 })],
    [b, JSON.stringify({ ...config, wiki: 'fuga' })],
  ]);
  const api = new WikiApi(
    { get: async (k) => values.get(k), store: async (k, v) => values.set(k, v) },
    async () => ({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
  );
  assert.equal((await api.session(a)).wiki, 'hoge');
  assert.equal((await api.session(b)).wiki, 'fuga');
  assert.equal(JSON.parse(values.get(a)).accessToken, 'new');
  assert.equal(JSON.parse(values.get(b)).accessToken, 'access');
  await assert.rejects(api.session(connectionKey('/unconnected')), /先に/);
});

test('現在の文書の所属フォルダで接続先を選ぶ', async () => {
  const { connectionKey } = require('../src/wiki-sync');
  const h = harness();
  let root = '/wiki-a';
  h.vscode.workspace.getWorkspaceFolder = () => ({ uri: { fsPath: root } });
  const keys = [];
  h.api.session = async (key) => {
    keys.push(key);
    return config;
  };
  await h.actions.compareWikiPage();
  root = '/wiki-b';
  await h.actions.compareWikiPage();
  assert.deepEqual(keys, [connectionKey('/wiki-a'), connectionKey('/wiki-b')]);
});
test('同じ接続の並行更新は保存完了まで共有し、別接続は待たせない', async () => {
  const values = new Map(['a', 'b'].map((key) => [key, JSON.stringify({ ...config, expires: 0 })]));
  let finishStore;
  let calls = 0;
  const api = new WikiApi(
    {
      get: async (key) => values.get(key),
      store: async (key, value) => {
        if (key === 'a')
          await new Promise((resolve) => {
            finishStore = resolve;
          });
        values.set(key, value);
      },
    },
    async () => {
      calls++;
      return { access_token: 'next', refresh_token: 'rotated', expires_in: 3600 };
    },
  );
  const first = api.session('a');
  while (!finishStore) await new Promise((resolve) => setImmediate(resolve));
  const second = api.session('a');
  assert.equal((await api.session('b')).accessToken, 'next');
  assert.equal(calls, 2);
  finishStore();
  assert.deepEqual(await first, await second);
  await api.session('a');
  assert.equal(calls, 2);
});

test('共有された更新失敗を全呼び出しに返し、次回は再試行する', async () => {
  let calls = 0;
  const api = new WikiApi(secrets({ ...config, expires: 0 }), async () => {
    if (++calls === 1) throw Error('offline');
    return { access_token: 'next', refresh_token: 'rotated', expires_in: 3600 };
  });
  const results = await Promise.allSettled([api.session(), api.session()]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal((await api.session()).accessToken, 'next');
  assert.equal(calls, 2);
});

test('3方向比較は改行だけの違いを無視し、本文の変更は区別する', () => {
  assert.equal(syncState('a\rb', 'a\r\nb', 'a\nb'), 'equal');
  assert.equal(syncState('a\nb', 'a\r\nb', 'a\nc'), 'remote');
  assert.equal(syncState('a\r\nb', 'a\nc', 'a\nb'), 'local');
  assert.equal(syncState('a\nb', 'a\r\nc', 'a\nd'), 'conflict');
});

test('CRLF変換された取り込みを保存すると同期基準を更新する', async () => {
  const h = harness({ base: page('a\nb'), local: 'a\r\nb', remote: page('a\nc', '"1-b"') });
  h.vscode.workspace.applyEdit = async (edit) => {
    h.doc.text = edit.text.replace(/\n/g, '\r\n');
    h.doc.version++;
    return true;
  };
  await h.actions.pullCurrentWikiPage();
  assert.equal(h.doc.text, 'a\r\nc');
  assert.equal(h.calls.saves.length, 0);
  h.disk.text = h.doc.text;
  await h.calls.onSave(h.doc);
  assert.equal(h.calls.saves[0][2].source, 'a\nc');
});

test('改行が違っても保存済み本文が本家と一致すれば基準を更新し投稿しない', async () => {
  const h = harness({ local: 'a\r\nb', remote: page('a\nb') });
  await h.actions.pullCurrentWikiPage();
  assert.equal(h.calls.saves.length, 1);
  await h.actions.publishWikiPage();
  assert.equal(h.calls.posts.length, 0);
  assert.equal(h.calls.saves.length, 2);
});

test('取り込み時や保存時の実際の本文変更では基準を進めない', async () => {
  for (const changeAt of ['replace', 'save']) {
    const h = harness({ remote: page('a\nb') });
    if (changeAt === 'replace') {
      h.vscode.workspace.applyEdit = async () => {
        h.doc.text = 'edited\r\nb';
        h.doc.version++;
        return true;
      };
    }
    await h.actions.pullCurrentWikiPage();
    h.disk.text = 'edited\r\nb';
    await h.calls.onSave(h.doc);
    assert.equal(h.calls.saves.length, 0);
  }
});
