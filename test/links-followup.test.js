'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');
const { candidates } = require('../src/language-features');

test('new-window link forms preserve the target and opt into side-by-side navigation', () => {
  for (const source of [
    '[[表示>>別#場所]]',
    '&blanklink(表示){別#場所}',
    '&link2(別#場所,target=blank)',
  ]) {
    const result = render(source);
    assert.match(result.html, /data-page="別#場所" data-new-window="true"/);
    assert.deepEqual(result.warnings, []);
  }
  for (const source of ['[[表示>別]]', '&link(表示){別}', '&link2(別,target=self)'])
    assert.doesNotMatch(render(source).html, /data-new-window/);
  const external = render('&link2(表示,HTTPS://example.com/?x=1,target=blank)');
  assert.match(external.html, /href="HTTPS:\/\/example.com\/\?x=1"/);
  assert.match(external.html, /data-new-window/);
});

test('link2 applies styling to the anchor and diagnoses invalid or unavailable options', () => {
  const result = render('&link2(別,title=説明,color=red,bgcolor=white,bordercolor=blue,button)');
  assert.match(
    result.html,
    /<a title="説明" style="color:red;background-color:white;border:1px solid blue;"/,
  );
  assert.deepEqual(result.warnings, []);
  for (const args of ['target=parent', 'target=top', 'target=unknown', 'typo=x'])
    assert.ok(render(`&link2(別,${args})`).warnings.length);
  assert.doesNotMatch(render('&blanklink(表示){javascript:alert(1)}').html, /<a /);
  assert.doesNotMatch(render('&link2(別,color=red;position:fixed)').html, /position:fixed/);
});

test('option completion distinguishes flags from named options of the same name', () => {
  for (const [prefix, expected] of [
    ['#ls2(ti', 'title'],
    ['#ls2(re', 'reverse'],
    ['#presen(inc', 'incremental'],
    ['&image(a.png,ti', 'title='],
    ['#treemenu(ti', 'title='],
    ['&link2(別,bu', 'button'],
    ['&link2(別,ta', 'target='],
    ['#region(re', 'remember'],
  ])
    assert.ok(
      candidates(prefix).some((c) => c.insertText === expected),
      prefix,
    );
});

test('wiki links inside plugin arguments complete pages and anchors instead of outer options', () => {
  const pages = { 別: '*説明\n&aname(場所){}' };
  assert.ok(candidates('&infobox(title=[[表示>別', pages).some((c) => c.label === '別'));
  assert.ok(candidates('&infobox(title=[[表示>別#', pages).some((c) => c.label === '場所'));
  assert.ok(
    candidates('&infobox(title=[[表示>別]],tri', pages).some((c) => c.insertText === 'trigger='),
  );
});

test('URL queries remain positional arguments while named URL options are preserved', () => {
  const { parameters } = require('../src/syntax');
  const args = parameters(
    'https://example.com/?x=1&y=2,HTTPS://example.com/?a=b,url=https://example.com/?x=1',
  );
  assert.deepEqual(args.flags, ['https://example.com/?x=1&y=2', 'HTTPS://example.com/?a=b']);
  assert.equal(args.values.url, 'https://example.com/?x=1');
  assert.match(
    render('&link2(表示,https://example.com/?x=1)').html,
    /href="https:\/\/example.com\/\?x=1"/,
  );
});

test('new-window local anchors retain their source page', () => {
  const result = render('[[表示>>#場所]]\n&aname(場所){}', {
    pageName: '攻略/基本',
    validateLinks: true,
  });
  assert.match(result.html, /data-page="攻略\/基本#場所" data-new-window="true"/);
  assert.deepEqual(result.warnings, []);
  assert.match(render('[[表示>>#場所]]').html, /href="#場所"/);
});

test('image links share URL-query and new-window navigation behavior', () => {
  const options = { pageName: '本文', resolveImage: (value) => value };
  const result = render('&image(a.png,HTTPS://example.com/?x=1,blank)', options);
  assert.match(result.html, /href="HTTPS:\/\/example.com\/\?x=1" data-new-window="true"/);
  assert.deepEqual(result.warnings, []);
  assert.match(render('&image(a.png,linkpage=#場所,blank)', options).html, /data-page="本文#場所"/);
});
