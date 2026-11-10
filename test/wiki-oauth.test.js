'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WikiOAuth, REDIRECT } = require('../src/wiki-oauth');

function setup() {
  let handler, cancel, launch, opened;
  const uri = (value) => ({ toString: () => value });
  const context = {
    extension: { id: 'atwiki-local-tools.atwiki-local-preview' },
    subscriptions: [],
  };
  const vscode = {
    Uri: { parse: uri },
    ProgressLocation: { Notification: 15 },
    env: {
      uriScheme: 'vscode',
      asExternalUri: async (value) => value,
      openExternal: async (value) => {
        opened = value.toString();
        launch?.(opened);
        return true;
      },
    },
    window: {
      registerUriHandler: (value) => {
        handler = value;
        return { dispose() {} };
      },
      withProgress: async (_options, run) =>
        run(
          {},
          {
            isCancellationRequested: false,
            onCancellationRequested: (callback) => {
              cancel = callback;
              return { dispose() {} };
            },
          },
        ),
    },
  };
  const oauth = new WikiOAuth(vscode, context);
  return {
    oauth,
    vscode,
    context,
    setLaunch: (fn) => {
      launch = fn;
    },
    cancel: () => cancel(),
    handle: (value) => handler.handleUri(uri(value)),
    opened: () => opened,
  };
}
const config = { redirect: REDIRECT, clientId: 'client' };
function callback(opened) {
  const auth = new URL(opened);
  assert.equal(auth.searchParams.get('redirect_uri'), REDIRECT);
  const target = new URL(decodeURIComponent(auth.searchParams.get('state')));
  target.searchParams.set('code', 'test-code');
  return target;
}
test('HTTPS中継用stateから戻り先を復元し、VS Codeでコードを一度だけ受け取る', async () => {
  const h = setup();
  h.setLaunch((opened) => {
    const target = callback(opened);
    h.handle(target.href);
    h.handle(target.href);
  });
  const result = await h.oauth.login(config);
  assert.equal(result.code, 'test-code');
  assert.equal(result.pending.verifier.length, 64);
  assert.equal(h.oauth.active, undefined);
});
test('別のnonce・パス・拡張ID・scheme・重複コードのコールバックは無視する', async () => {
  const h = setup();
  h.setLaunch((opened) => {
    const target = callback(opened);
    for (const invalid of [
      target.href.replace('nonce=', 'nonce=wrong'),
      target.href.replace('/oauth-callback', '/wrong'),
      target.href.replace('atwiki-local-tools', 'other'),
      target.href.replace('vscode:', 'https:'),
      target.href + '&code=other',
      target.href + '&nonce=other',
    ]) {
      h.handle(invalid);
      assert.ok(h.oauth.active);
    }
    h.handle(target.href);
  });
  assert.equal((await h.oauth.login(config)).code, 'test-code');
});
test('キャンセル後の認可結果は破棄し、新しい接続を開始できる', async () => {
  const h = setup();
  let old;
  h.setLaunch((opened) => {
    old = callback(opened);
    h.cancel();
  });
  assert.equal(await h.oauth.login(config), undefined);
  h.setLaunch((opened) => {
    h.handle(old.href);
    assert.ok(h.oauth.active);
    h.handle(callback(opened).href);
  });
  assert.equal((await h.oauth.login(config)).code, 'test-code');
});
test('期限切れ・認可拒否・ブラウザ起動失敗・拡張終了で待機を解除する', async () => {
  for (const mode of ['expired', 'denied', 'launch', 'dispose']) {
    const h = setup();
    if (mode === 'launch') h.vscode.env.openExternal = async () => false;
    else
      h.setLaunch((opened) => {
        const target = callback(opened);
        if (mode === 'expired') h.oauth.active.expires = Date.now() - 1;
        if (mode === 'denied') target.searchParams.set('error', 'access_denied');
        if (mode === 'dispose') h.context.subscriptions.at(-1).dispose();
        else h.handle(target.href);
      });
    await assert.rejects(h.oauth.login(config));
    assert.equal(h.oauth.active, undefined);
  }
});
test('asExternalUriの戻り先をその接続に限って使い、次回は再解決する', async () => {
  const h = setup();
  let count = 0;
  h.vscode.env.asExternalUri = async (value) => {
    count++;
    const result = new URL('https://callback.example/return');
    result.searchParams.set('target', value.toString());
    return { toString: () => result.href };
  };
  h.setLaunch((opened) => {
    const target = new URL(callback(opened).searchParams.get('target'));
    target.searchParams.set('code', 'remote-code');
    h.handle(target.href);
  });
  assert.equal((await h.oauth.login(config)).code, 'remote-code');
  await h.oauth.login(config);
  assert.equal(count, 2);
});
