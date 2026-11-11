'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');
const { candidates } = require('../src/language-features');

test('atwiki links normalize current and legacy wiki IDs and retain page and target', () => {
  for (const wiki of ['guide@wiki', 'guide@www1', 'guide']) {
    const r = render(`&link_atwiki(${wiki},日本語/ページ & 名前,target=blank){一覧}`);
    assert.ok(
      r.html.includes(
        'href="https://w.atwiki.jp/guide/?page=' + encodeURIComponent('日本語/ページ & 名前') + '"',
      ),
    );
    assert.match(r.html, /data-new-window="true"/);
    assert.match(r.html, />一覧<\/a>/);
    assert.deepEqual(r.warnings, []);
  }
  assert.match(render('&link_atwiki(guide@wiki)').html, /href="https:\/\/w.atwiki.jp\/guide\/"/);
  assert.match(render('&link_atwiki(guide@wiki,ページ)').html, />ページ<\/a>/);
  assert.ok(render('&link_atwiki(guide@wiki,target=oops)').warnings.length);
  assert.doesNotMatch(render('&link_atwiki(https://evil.example)').html, /<a /);
});

test('image anchor links use the image resolver and retain local and cross-page destinations', () => {
  for (const name of ['link_anchor', 'link_aname']) {
    let resolved;
    const r = render(`&${name}(A,page=別,img=https://example.com/a.png?x=1&y=2){移動}`, {
      resolveImage: (src) => {
        resolved = src;
        return 'https://example.com/a.png?x=1&y=2';
      },
    });
    assert.equal(resolved, 'https://example.com/a.png?x=1&y=2');
    assert.match(r.html, /data-page="別#A"><img /);
    assert.match(r.html, /alt="移動"/);
    assert.match(r.html, /x=1&amp;y=2/);
    assert.deepEqual(r.warnings, []);
    const blocked = render(`&${name}(A,img=missing.png){移動}`, { resolveImage: () => null });
    assert.doesNotMatch(blocked.html, /<img/);
    assert.match(blocked.html, /href="#A" data-named-anchor="true">移動/);
    assert.ok(blocked.warnings.some((w) => w.includes('画像の参照先')));
    const local = render(`&${name}(A,page=別,anchor_only=true,img=local.png){移動}`, {
      resolveImage: () => 'local.png',
    });
    assert.match(local.html, /href="#A" data-named-anchor="true"><img /);
  }
});

test('sizex zero is valid while invalid sizes and layout values produce diagnostics', () => {
  for (const value of ['0', '+0', '4', 'medium']) {
    const r = render(`&sizex(${value}){標準}`);
    assert.match(r.html, /font-size:medium/);
    assert.deepEqual(r.warnings, []);
  }
  for (const source of [
    '&sizex(8){文字}',
    '#hr(width=oops)',
    '#div(height=-1){本文}',
    '#div(unknown=1){本文}',
    '#expand(oops){本文}',
    '&underdot(10px){文字}',
  ]) {
    const r = render('前\n' + source);
    assert.ok(r.warnings.length, source);
    assert.equal(r.diagnostics[0].line, 1, source);
  }
  for (const source of [
    '#hr(width=90%,height=2,color=#ff0000)',
    '#div(width=200px,height=10em){本文}',
    '#expand(300){本文}',
    '&underdot(red,2px){文字}',
  ])
    assert.deepEqual(render(source).warnings, [], source);
});

test('layout and table completions distinguish arguments from body settings', () => {
  for (const [source, insertion] of [
    ['#div(wi', 'width='],
    ['#hr(he', 'height='],
    ['&link_atwiki(guide@wiki,ta', 'target='],
    ['&link_anchor(A,im', 'img='],
    ['#table_style(he', 'head='],
    ['#table_filter(p', 'pc'],
    ['#table_sorter(){ze', 'zebra='],
    ['#table_autoincrement(){\nsta', 'start='],
    ['#table_filter(){列', '列名='],
  ])
    assert.ok(
      candidates(source).some((c) => c.insertText === insertion),
      source,
    );
  assert.deepEqual(candidates('#table_autoincrement(sta'), []);
  assert.deepEqual(candidates('#table_sorter(){zebra=1}\nze'), []);
});
