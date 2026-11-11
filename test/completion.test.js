'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { candidates, registerCompletion, names, options } = require('../src/completion');
const { LOCAL_NAMES } = require('../src/plugins');
test('completion lists implemented names only and uses supported option syntax', () => {
  assert.deepEqual(new Set(names), new Set(LOCAL_NAMES));
  assert.equal(candidates('#flash').length, 0);
  assert.ok(candidates('#you').some((c) => c.label === 'youtube'));
  for (const name of Object.keys(options)) assert.ok(names.includes(name), name);
  assert.ok(candidates('&col').some((c) => c.label === 'color'));
  assert.ok(candidates('#region(op').some((c) => c.insertText === 'open'));
  assert.ok(candidates('&image(a.png,wi').some((c) => c.insertText === 'width='));
  assert.ok(candidates('&link_anchor(A,im').some((c) => c.insertText === 'img='));
  assert.ok(candidates('&link2(別,ta').some((c) => c.insertText === 'target='));
  assert.deepEqual(candidates('// #col'), []);
  assert.deepEqual(candidates('普通の本文'), []);
});
test('completion handles pages, explicit anchors, images, nested and multiline arguments', () => {
  const data = {
    pages: { 別: { text: '&aname(場所){}\n*見出し [#説明]' }, '攻略/基本': '' },
    ownText: '&anchor(未保存){}',
    images: ['攻略/a.png'],
    pageName: '攻略/基本',
  };
  for (const [source, value] of [
    ['[[表示>別', '別'],
    ['#include(攻略/', '攻略/基本'],
    ['[[別#場', '場所'],
    ['&link_anchor(未', '未保存'],
    ['&image(a', 'a.png'],
    ['&infobox(title=[[表示>別', '別'],
    ['&infobox(title=&color(red){文字},\ntri', 'trigger='],
  ])
    assert.ok(
      candidates(source, data).some((c) => c.insertText === value),
      source,
    );
  assert.deepEqual(candidates('#include(別)\n普通の文章', data), []);
  assert.deepEqual(
    candidates('[[別#', data).map((c) => c.label),
    ['場所'],
  );
  for (const prefix of ['[[#', '[[表示>#', '[[別#', '&link_anchor(']) {
    assert.deepEqual(
      candidates(prefix, {
        ownText: '*見出し\n**小見出し [#説明]',
        pages: { 別: '*見出し\n**小見出し [#説明]' },
      }),
      [],
    );
  }
});
test('provider avoids IO for syntax, releases indexes and honors cancellation', async () => {
  let provider,
    scans = 0,
    releases = 0;
  const api = {
    languages: {
      registerCompletionItemProvider(selector, p) {
        provider = p;
        return { dispose() {} };
      },
    },
    workspace: {},
    Range: class {
      constructor(...args) {
        this.args = args;
      }
    },
    CompletionItem: class {
      constructor(label) {
        this.label = label;
      }
    },
  };
  const context = { subscriptions: [] };
  registerCompletion(
    api,
    context,
    {
      retain: () => () => releases++,
      get: async () => {
        scans++;
        return { pages: { 別: '' } };
      },
    },
    new Map(),
  );
  let text = '#col';
  const doc = {
    uri: { scheme: 'file', toString: () => 'file:///wiki/test.atwiki' },
    fileName: '/wiki/test.atwiki',
    getText: () => text,
  };
  assert.ok(
    (await provider.provideCompletionItems(doc, { line: 0, character: 4 }, {})).some(
      (i) => i.label === 'color',
    ),
  );
  assert.equal(scans, 0);
  text = '[[別';
  assert.ok(
    (await provider.provideCompletionItems(doc, { line: 0, character: 3 }, {})).some(
      (i) => i.label === '別',
    ),
  );
  assert.equal(releases, 1);
  assert.deepEqual(
    await provider.provideCompletionItems(
      doc,
      { line: 0, character: 3 },
      { isCancellationRequested: true },
    ),
    [],
  );
  assert.equal(scans, 1);
  assert.equal(context.subscriptions.length, 1);
});
