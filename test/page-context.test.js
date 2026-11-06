'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pageNameFromFile, filePageRoot } = require('../src/page-context');

test('file page names preserve nesting, spelling and unknown extensions', () => {
  const root = path.resolve('wiki');
  for (const [parts, expected] of [
    [['日本語 空白.ATWIKI'], '日本語 空白'],
    [['攻略', '基本.atw'], '攻略/基本'],
    [['攻略', '基本.txt'], '攻略/基本'],
    [['基本.md'], '基本.md'],
    [['基本.atwiki.txt'], '基本.atwiki'],
    [['..', '別.atwiki'], '../別'],
  ])
    assert.equal(pageNameFromFile(root, path.join(root, ...parts)), expected);
});

test('file roots prefer remembered wiki, workspace, then parent with falsy fallbacks', () => {
  const fileName = path.resolve('wiki', '攻略', '基本.atwiki');
  const document = { fileName, uri: { toString: () => 'file:page' } };
  const remembered = path.resolve('wiki');
  const workspace = path.resolve('.');
  for (const [override, folder, expected, name] of [
    [remembered, workspace, remembered, '攻略/基本'],
    [undefined, workspace, workspace, 'wiki/攻略/基本'],
    ['', workspace, workspace, 'wiki/攻略/基本'],
    [undefined, undefined, path.dirname(fileName), '基本'],
    ['', '', path.dirname(fileName), '基本'],
  ]) {
    const api = { workspace: { getWorkspaceFolder: () => ({ uri: { fsPath: folder } }) } };
    const roots = new Map([['file:page', { fsPath: override }]]);
    const actual = filePageRoot(api, document, roots);
    assert.equal(actual, expected);
    assert.equal(pageNameFromFile(actual, fileName), name);
  }
  assert.equal(filePageRoot({ workspace: {} }, document, new Map()), path.dirname(fileName));
});
