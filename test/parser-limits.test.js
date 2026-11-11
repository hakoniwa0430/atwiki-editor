'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { render } = require('../src/renderer');

test('malformed plugin, link and footnote input terminates with a diagnostic', () => {
  // A process timeout also catches regressions that block the test runner's event loop.
  for (const fragment of ['&x(', '&x{', '&x{{', '[[x', '((x', '#x(\n']) {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `const {render}=require('./src/renderer');const r=render(${JSON.stringify(fragment)}.repeat(80000));console.log(JSON.stringify(r));`,
      ],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 3000 },
    );
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.match(result.warnings.join(), /処理上限/);
    assert.equal(result.diagnostics[0].line, 0);
    assert.ok(result.html.length < 300);
  }
});

test('large ordinary text and small incomplete syntax still render', () => {
  assert.deepEqual(render('a'.repeat(240000)).warnings, []);
  const result = render('&x( &bold(){正常}\n[[未閉鎖\n((未閉鎖\n*次の見出し');
  assert.match(result.html, /<strong>正常<\/strong>/);
  assert.match(result.html, /次の見出し<\/h2>/);
  assert.doesNotMatch(result.warnings.join(), /処理上限/);
});

test('source and shared include work limits do not leak partial output', () => {
  assert.match(render('a'.repeat(1000001)).warnings.join(), /処理上限/);
  const result = render('#include(重いページ)', {
    pages: { 重いページ: '&x('.repeat(80000) },
  });
  assert.match(result.warnings.join(), /処理上限/);
  assert.doesNotMatch(result.html, /data-include/);
  // The next render has a fresh budget and continues to work after rejection.
  assert.match(render('&bold(){復帰}').html, /<strong>復帰<\/strong>/);
});

test('block plugins after other lines retain multiline bodies and line numbers', () => {
  const result = render('前の行\n#div(){\n&bold(){本文}\n}\n*後の見出し');
  assert.deepEqual(result.warnings, []);
  assert.match(result.html, /<strong>本文<\/strong>/);
  assert.match(result.html, /data-line="4">後の見出し/);
});
