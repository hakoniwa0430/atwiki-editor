'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerWikiBrowser } = require('../src/wiki-browser');

function setup() {
  const commands = {},
    opened = [],
    messages = [];
  const uri = (name) => ({ scheme: 'file', toString: () => name });
  const vscode = {
    commands: {
      registerCommand: (name, action) => {
        commands[name] = action;
      },
    },
    window: {
      activeTextEditor: { document: { uri: uri('active') } },
      showInformationMessage: (message) => messages.push(message),
      showErrorMessage: (message) => messages.push(message),
    },
    Uri: { parse: (url) => url },
    env: {
      openExternal: async (url) => {
        opened.push(url);
        return true;
      },
    },
  };
  const store = {
    read: async (key) =>
      key === 'unlinked'
        ? undefined
        : {
            wiki: 'sample',
            page: { pageid: key === 'active' ? 1 : 2 },
          },
  };
  registerWikiBrowser(vscode, { subscriptions: [] }, store);
  return { commands, opened, messages, uri, vscode, store };
}

test('ブラウザボタンは対象エディターのURIを優先し、引数なしでは編集中ページを開く', async () => {
  const h = setup();
  await h.commands['atwiki.openWikiPageInBrowser']();
  await h.commands['atwiki.openWikiUploadInBrowser'](h.uri('other'));
  assert.deepEqual(h.opened, [
    'https://w.atwiki.jp/sample/pages/1.html',
    'https://w.atwiki.jp/sample/upload/2.html',
  ]);
});

test('未連携・同期情報エラー・ブラウザ起動失敗を案内する', async () => {
  const h = setup();
  const run = h.commands['atwiki.openWikiPageInBrowser'];
  await run(h.uri('unlinked'));
  assert.match(h.messages.pop(), /未連携/);
  assert.equal(h.opened.length, 0);
  h.vscode.env.openExternal = async () => false;
  await run();
  assert.match(h.messages.pop(), /既定のブラウザ/);
  h.store.read = async () => {
    throw Error('同期情報が不正です。');
  };
  await run();
  assert.match(h.messages.pop(), /同期情報が不正/);
});
