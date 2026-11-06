'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { render } = require('../src/renderer');
const { candidates } = require('../src/language-features');

test('marquee right alternate preserves alternate animation direction', () => {
  const html = render('#marquee(test,right,alternate,loop=3)').html;
  assert.match(html, /marquee-alternate marquee-right/);
  assert.match(
    fs.readFileSync('media/preview.css', 'utf8'),
    /\.marquee-alternate\.marquee-right\s*\{\s*animation-direction:\s*alternate-reverse;/,
  );
});

test('toggle and marquee invalid options warn while official options remain valid', () => {
  for (const input of [
    '#marquee(test,loop=abc)',
    '#marquee(test,size=-1)',
    '#marquee(test,color=invalid!)',
    '#openclose(typo=1){text}',
    '&openclose2(block){text}',
  ])
    assert.ok(render(input).warnings.length, input);
  for (const input of [
    '#marquee(test,right,alternate,loop=3,size=20,color=red)',
    '#openclose(show=詳細,block,margin:10px;){text}',
    '&openclose2(show=詳細,inline){text}',
  ])
    assert.deepEqual(render(input).warnings, [], input);
  for (const [input, flag] of [
    ['#openclose(', 'block'],
    ['&openclose2(', 'inline'],
    ['#marquee(', 'alternate'],
  ]) {
    const items = candidates(input);
    assert.equal(items.find((x) => x.label === flag).insertText, flag);
  }
  assert.equal(candidates('#openclose(sh')[0].insertText, 'show=');
  assert.equal(candidates('#table_edit(表', { 表ページ: '|A|' })[0].label, '表ページ');
});

test('table_edit retains source rows, merged tables, image context and bounds recursion', () => {
  const calls = [];
  const resolver = (file, page, source) => {
    calls.push(source);
    return 'https://example.com/' + file;
  };
  const options = Object.freeze({
    pages: {
      'sub/table': '*見出し\n|A|B|h\n|>|&image(a.png)|\n#table_edit(nested)',
      nested: '|&image(b.png)|',
    },
    resolveImage: resolver,
  });
  const result = render('intro\n\n#table_edit(sub/table)\n&image(c.png)', options);
  assert.deepEqual(result.warnings, []);
  assert.match(result.html, /data-editable-include="true"/);
  assert.match(result.html, /<tr data-line="2"/);
  assert.match(result.html, /colspan="2"/);
  assert.deepEqual(calls, ['sub/table', 'nested', undefined]);
  assert.equal(options.resolveImage, resolver);
  assert.match(
    render('#table_edit(A)', { pages: { A: '#table_edit(A)' } }).warnings.join(),
    /循環/,
  );
  assert.match(render('#table_edit(missing)').warnings.join(), /見つかりません/);
  assert.match(render('#table_edit()').warnings.join(), /参照ページ/);
  assert.match(
    render('#table_edit(A,size1=30)', { pages: { A: '|A|' } }).warnings.join(),
    /編集フォーム/,
  );
});
