'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');
const { formatDate } = require('../src/plugins/dates');
const options = {
  pageName: '本文',
  now: '2026-11-03T12:34:56',
  pages: {
    本文: { text: '', modified: '2026-11-03T12:34:56' },
    '別(ページ)': { text: '', modified: '2025-02-01T01:02:03' },
  },
};

test('date formatting preserves zero padding and both public exports', () => {
  assert.equal(require('../src/plugins').formatDate, formatDate);
  const date = new Date(2026, 0, 4, 1, 2, 3);
  assert.equal(formatDate(date), '2026-01-04 01:02:03 (Sun)');
  assert.equal(formatDate(date, true), '2026年01月04日 (日) 01:02:03');
  assert.equal(formatDate(date, false, true), '2026-01-04 (Sun)');
  assert.equal(formatDate(date, true, true), '2026年01月04日 (日)');
});
test('update supports format tokens and body page selection with precedence', () => {
  const result = render('&update(本文,format=Y/m/d H:i:s D){page=別(ページ)}', options);
  assert.match(result.html, /2025\/02\/01 01:02:03 Sat/);
  assert.deepEqual(result.warnings, []);
  assert.match(render('&update(format=y-m-d)', options).html, /26-11-03/);
  assert.match(render('&lastmod()', options).html, /2026年11月03日/);
  assert.match(render('&time(j)', options).html, /12時34分56秒/);
});
test('unavailable page IDs and invalid date options warn without choosing a wrong page', () => {
  const result = render('&update(pageid=1){page=別(ページ)}', options);
  assert.doesNotMatch(result.html, /2025|2026/);
  assert.ok(result.warnings.some((s) => s.includes('pageid')));
  assert.ok(render('&update(format=<script>)', options).warnings.some((s) => s.includes('format')));
  assert.ok(render('#calendar(lang=fr)', options).warnings.some((s) => s.includes('lang')));
  assert.deepEqual(render('#calendar(option=link,lang=en)', options).warnings, []);
});
test('uppercase Japanese dates render consistently and omitted counters are empty', () => {
  for (const name of ['today', 'now', 'fclock']) {
    const result = render(`&${name}(J)`, options);
    assert.match(result.html, /data-japanese="true"/);
    assert.match(result.html, /2026年11月03日/);
  }
  for (const name of ['countdown', 'countup']) {
    const result = render(`&${name}()`, options);
    assert.deepEqual(result.warnings, []);
    assert.doesNotMatch(result.html, /<span>/);
    assert.ok(render(`&${name}(invalid)`, options).warnings.length);
  }
});
