'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');

test('QR defaults to wiki URL and never silently encodes local file paths', () => {
  const options = { wikiUrl: 'https://w.atwiki.jp/example/', pageUrl: 'file:///private.atwiki' };
  assert.equal(render('&qr()', options).html, render('&qr(https://w.atwiki.jp/example/)').html);
  assert.match(render('&qr()', { pageUrl: options.pageUrl }).warnings.join(), /wikiUrl/);
  assert.equal(render('&qr(a=b)', options).html, render('&qr(){a=b}', options).html);
});
test('tree image marks honor resolver and remembered identities are stable and distinct', () => {
  const source = '#treemenu(flag=ex,mark=https://example.com/a.png,none,Item)';
  const result = render(source + '\n' + source, { resolveImage: (value) => value });
  assert.match(result.html, /<img [^>]*src="https:\/\/example.com\/a.png"/);
  const keys = [...result.html.matchAll(/data-remember="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, 2);
  assert.ok(render(source).html.includes(keys[0]));
  assert.equal(result.warnings.length, 0);
  assert.doesNotMatch(render(source).html, /<img /);
  for (const name of ['treemenu2', 'treemenu3'])
    assert.match(render('&' + name + '(flag=ex){Item}').html, /data-remember/);
});
test('presentation uses selected page without leaking headings and bounds nested presentations', () => {
  const options = {
    pageName: 'home',
    pages: {
      target: { text: '*Target\n#presen(page=home)' },
      home: { text: '*Home\n#presen(page=target)' },
    },
  };
  const result = render('*Home\n#presen(page=target)', options);
  assert.match(result.html, /<template data-presentation-source>[\s\S]*Target/);
  assert.equal((result.html.match(/data-present /g) || []).length, 1);
  assert.equal(result.headings.length, 1);
  assert.equal(result.warnings.length, 0);
  assert.match(render('#presen(page=missing)', options).warnings.join(), /見つかりません/);
  assert.match(
    render('#presen(page=empty)', { pages: { empty: 'text' } }).warnings.join(),
    /大見出し/,
  );
});
test('ls2 nests heading levels including skipped levels and returns to siblings', () => {
  const result = render('#ls2(title)', { pageName: 'P', pages: { 'P/C': '*A\n***B\n**C\n*D' } });
  assert.match(
    result.html,
    />A<\/a><ul><li>.*>B<\/a><\/li><li>.*>C<\/a><\/li><\/ul><\/li><li>.*>D<\/a>/,
  );
});
test('list search and presentation options diagnose ignored and invalid values', () => {
  for (const [source, expected] of [
    ['#ls3(sort=invalid)', 'sort'],
    ['#ls_line(sort2=desc)', 'sort2'],
    ['#list_by_search(andor=x)', 'andor'],
    ['#include_by_search(limit=0)', 'limit'],
    ['#search2(unknown=x)', 'unknown'],
    ['#presen(page=)', 'page'],
    ['#presen(wrong)', 'wrong'],
  ])
    assert.ok(
      render(source).warnings.some((w) => w.includes(expected)),
      source,
    );
  assert.equal(render('#ls3(sort=timestamp,sort2=desc)').warnings.length, 0);
});
