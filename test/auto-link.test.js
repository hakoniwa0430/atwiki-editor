'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { autoLink, registerAutoLink } = require('../src/auto-link');

test('longest page names win, metacharacters are literal, and repeat runs are idempotent', () => {
  const names = ['魔法工房', '魔法工房攻略', 'A+B'];
  const result = autoLink('魔法工房攻略と魔法工房、A+B。\r\n', names);
  assert.deepEqual(result, { text: '[[魔法工房攻略]]と[[魔法工房]]、[[A+B]]。\r\n', count: 3 });
  assert.deepEqual(autoLink(result.text, names), { text: result.text, count: 0 });
});

test('ineligible names, current page, and user exclusions stay unchanged', () => {
  const names = [
    'トップページ',
    'メニュー',
    '右メニュー',
    '更新履歴',
    '短い',
    '親/子ページ',
    '現在地',
    '非公開',
    'コメントログ',
    '正常名',
  ];
  const result = autoLink(names.join('、'), names, {
    currentPage: '現在地',
    excludedPages: ['非公開'],
  });
  assert.equal(result.count, 1);
  assert.equal(result.text, names.slice(0, -1).join('、') + '、[[正常名]]');
  assert.equal(autoLink('正常名', names, { currentPage: 'コメントログ/1' }).count, 0);
});

test('headings, lists, plugins, nested regions, URLs, and existing links are protected', () => {
  const protectedLines = [
    '*魔法工房',
    '-魔法工房',
    '+魔法工房',
    '|魔法工房|',
    ' 魔法工房',
    '//魔法工房',
    '&color(red){魔法工房}と魔法工房',
    '#include(魔法工房)',
    '#region(魔法工房)',
    '魔法工房',
    '#region()',
    '魔法工房',
    '#endregion',
    '魔法工房',
    '#endregion',
    '#div(){',
    '魔法工房',
    '#div(){魔法工房}',
    '}',
    '#pre(){{',
    '魔法工房',
    '}}',
    '&color(red){',
    '魔法工房',
    '}',
    '[[魔法工房>別ページ]]',
    'https://example.com/魔法工房',
    '[[表示名>',
    '魔法工房]]',
    '$$',
    '魔法工房',
    '$$',
  ].join('\n');
  const result = autoLink(protectedLines + '\n魔法工房', ['魔法工房']);
  assert.equal(result.text, protectedLines + '\n[[魔法工房]]');
  assert.equal(result.count, 1);
});

test('unfinished constructs protect the remaining document', () => {
  for (const opening of ['#div(){', '#pre(){{', '&color(red){', '#region()', '[[リンク>', '$$']) {
    const source = opening + '\n魔法工房';
    assert.equal(autoLink(source, ['魔法工房']).text, source);
  }
});

test('inline math does not suppress later prose and existing links leave surrounding text editable', () => {
  assert.deepEqual(autoLink('$$魔法工房$$\n魔法工房', ['魔法工房']), {
    text: '$$魔法工房$$\n[[魔法工房]]',
    count: 1,
  });
  assert.deepEqual(autoLink('魔法工房と[[魔法工房]]、魔法工房', ['魔法工房']), {
    text: '[[魔法工房]]と[[魔法工房]]、[[魔法工房]]',
    count: 2,
  });
});

function setup({ truncated = false, changed = false, applied = true, fail = false } = {}) {
  let command,
    edits = [],
    released = 0;
  const messages = [];
  const document = {
    uri: { scheme: 'file', toString: () => 'file:///wiki/本文.atwiki' },
    fileName: '/wiki/本文.atwiki',
    version: 1,
    getText: () => '魔法工房',
    positionAt: (n) => n,
  };
  const vscode = {
    commands: {
      registerCommand: (name, fn) => {
        assert.equal(name, 'atwiki.autoLinkPageNames');
        command = fn;
        return {};
      },
    },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    workspace: { getConfiguration: () => ({ get: () => [] }) },
    window: {
      activeTextEditor: {
        document,
        edit: async (fn, options) => {
          fn({ replace: (range, text) => edits.push({ range, text, options }) });
          return applied;
        },
      },
      showInformationMessage: (message) => messages.push(message),
      showWarningMessage: (message) => messages.push(message),
      showErrorMessage: (message) => messages.push(message),
    },
  };
  const index = {
    retain: () => () => released++,
    invalidate() {},
    get: async () => {
      if (fail) throw Error('read failure');
      if (changed) document.version++;
      return { pages: { 魔法工房: {} }, truncated };
    },
  };
  registerAutoLink(vscode, { subscriptions: [] }, index, new Map());
  return { run: () => command(), edits, messages, released: () => released };
}

test('command makes one undoable edit and reports success without saving', async () => {
  const app = setup();
  await app.run();
  assert.equal(app.edits.length, 1);
  assert.equal(app.edits[0].text, '[[魔法工房]]');
  assert.deepEqual(app.edits[0].options, { undoStopBefore: true, undoStopAfter: true });
  assert.match(app.messages[0], /1 箇所/);
  assert.equal(app.released(), 1);
});

test('command refuses truncated scans and stale edits, and releases index on errors', async () => {
  for (const options of [{ truncated: true }, { changed: true }, { fail: true }]) {
    const app = setup(options);
    await app.run();
    assert.equal(app.edits.length, 0);
    assert.equal(app.messages.length, 1);
    assert.equal(app.released(), 1);
  }
  const app = setup({ applied: false });
  await app.run();
  assert.match(app.messages[0], /適用できません/);
});
