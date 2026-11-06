'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { render } = require('../src/renderer');
const { LOCAL_NAMES } = require('../src/plugins');
const { sortTable } = require('../media/interactions');
const { loadScripts } = require('../src/local-pages');
const pages = {
  A: {
    text: '*見出し [#intro]\n[[未作成]]',
    modified: '2026-01-01T00:00:00',
    created: '2025-01-01',
  },
  'A/B': { text: '*B\n本文', modified: '2026-01-03T00:00:00', created: '2025-01-02' },
  'A/B/C': { text: '*C', modified: '2026-01-02T00:00:00', created: '2025-01-03' },
  Z: { text: '本文', modified: '2026-01-04T00:00:00', created: '2025-01-04' },
};
const options = {
  pages,
  pageName: 'A',
  now: '2026-01-03T12:00:00',
  random: () => 0,
  resolveImage: (s) => 'https://local/' + s,
  images: ['a.png', 'b.png'],
};
test('hierarchical page lists, direct descendants, titles, count and inline separator', () => {
  assert.match(render('#ls2(title)', options).html, /A\/B#heading-1/);
  assert.doesNotMatch(render('#lsd()', options).html, /data-page="A\/B\/C"/);
  assert.match(render('#ls3()', options).html, /<ul><li>A<ul>/);
  assert.equal(render('&count_childpages()', options).html.replace(/<[^>]*>/g, ''), '2');
  assert.match(render('#ls_line(sep=・)', options).html, /<\/a>・<a/);
});
test('local search handles AND, OR, body, exclusion and search includes', () => {
  assert.match(render('#list_by_search(本文,target=withbody)', options).html, /data-page="Z"/);
  assert.doesNotMatch(render('#list_by_search(B,Z)', options).html, /data-page=/);
  assert.match(render('#list_by_search(B,Z,andor=or)', options).html, /data-page="Z"/);
  const r = render('#include_by_search(word=B,limit=1,linktitle=h3)', options);
  assert.match(r.html, /<h3>/);
  assert.match(r.html, /本文/);
  assert.deepEqual(r.warnings, []);
});
test('local metadata distinguishes page and wiki update dates', () => {
  assert.match(render('&lastmod()', options).html, /2026年01月01日/);
  assert.match(render('&last_modified()', options).html, /2026-01-04/);
  assert.match(render('&new3(page=A/B,show=更新)', options).html, /更新/);
  assert.match(render('&newimage(page=A/B,image=a.png)', options).html, /<img/);
});
test('recent pages sort by timestamps and related/missing pages are derived from links', () => {
  const r = render('#recent(2)', options).html;
  assert.ok(r.indexOf('data-page="Z"') < r.indexOf('data-page="A/B"'));
  assert.doesNotMatch(r, /data-page="A\/B\/C"/);
  assert.match(render('#yetlist(ref)', options).html, /data-page="未作成"/);
  assert.match(
    render('#related()', { ...options, pages: { ...pages, A: '[[B>A/B]] [[Missing]]' } }).html,
    /data-page="A\/B"/,
  );
});
test('random link selection is bounded and excludes duplicate results', () => {
  assert.match(render('#random2(Z,A,text=選択)', options).html, /data-page="Z">選択/);
  const html = render('#random3(count=30)', options).html;
  const names = [...html.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, 4);
  assert.match(render('&random_page()', options).html, /data-random-pages/);
});
test('image slide enumerates supplied local images and ref accepts a page argument', () => {
  assert.equal((render('#img_slide()', options).html.match(/<img /g) || []).length, 2);
  let page;
  render('&ref(a.png,A,inline)', {
    resolveImage: (file, p) => {
      page = p;
      return file;
    },
  });
  assert.equal(page, 'A');
});
test('infobox options and exkp k/p defaults have observable effects', () => {
  const r = render(
    '&infobox(title=開く,gravity=west,size=large,animation=flipin,url=a.png,link=A){本文}',
    options,
  );
  assert.match(r.html, /gravity-west size-large animation-flipin/);
  assert.match(r.html, /data-infobox/);
  assert.match(r.html, /<img/);
  assert.doesNotMatch(render('#exkp(p){隠す}').html, /隠す/);
  assert.doesNotMatch(render('#exkp(){隠す}', { mode: 'mobile' }).html, /隠す/);
  assert.match(render('#exkp(p){表示}', { mode: 'mobile' }).html, /表示/);
});
test('header formatting and filter device scope are respected', () => {
  const r = render('#table_filter(sp){名前=hide}\n|~CENTER:名前|~値|\n|a|b|');
  assert.match(r.html, /text-align:center/);
  assert.doesNotMatch(r.html, / hidden/);
});
test('footnotes do not duplicate explicit IDs and missing references warn', () => {
  const r = render('&aname(note-1){} ((本文))');
  const ids = [...r.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(render('&footnote(){99}').warnings.some((s) => s.includes('本文がありません')));
});
test('include expansion has a total cap independent of nesting depth', () => {
  const r = render(Array(75).fill('#include(A)').join('\n'), { pages: { A: 'text' } });
  assert.ok(r.warnings.some((s) => s.includes('上限')));
  assert.equal((r.html.match(/data-include/g) || []).length, 70);
});
test('solid, regular and brand icon aliases have actual SVG geometry', () => {
  for (const args of ['fas fa-house', 'fas fa-home', 'far fa-envelope', 'fab fa-github']) {
    const r = render(`&icon_fa(${args})`);
    assert.deepEqual(r.warnings, [], args);
    assert.match(r.html, /<path fill="currentColor" d="M/);
  }
});
test('local script loading enforces root and size constraints', async () => {
  const root = path.resolve('.inspection/script-test');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'ok.js'), 'document.write("ok")');
  await fs.writeFile(path.join(root, 'large.js'), 'x'.repeat(262145));
  const scripts = await loadScripts(root, [
    '#include_js(ok.js)\n#include_js(../outside.js)\n#include_js(large.js)\n#include_js(https://example.com/x.js)',
  ]);
  assert.deepEqual(Object.keys(scripts), ['ok.js']);
  assert.match(render('#include_js(ok.js)', { scripts }).html, /sandbox="allow-scripts"/);
});
test('sortable table moves rowspan groups together and keeps header barriers', () => {
  function row(text, span = 1, header = false) {
    return {
      dataset: header ? { header: 'true' } : {},
      cells: [{ dataset: { column: '0' }, rowSpan: span, colSpan: 1, textContent: text }],
    };
  }
  const header = row('heading', 1, true),
    a = row('10', 2),
    a2 = row('detail'),
    b = row('2'),
    body = {
      rows: [header, a, a2, b],
      querySelectorAll: () => [],
      append(row) {
        this.rows.splice(this.rows.indexOf(row), 1);
        this.rows.push(row);
      },
    };
  const table = { dataset: {}, tBodies: [body], querySelectorAll: () => [] };
  sortTable(table, 0);
  assert.deepEqual(body.rows, [header, b, a, a2]);
  sortTable(table, 0);
  assert.deepEqual(body.rows, [header, a, a2, b]);
});
test('every declared local plugin reaches an implementation, including aliases', () => {
  for (const name of LOCAL_NAMES) {
    let source = `#${name}()`;
    if (name === 'endregion') source = '#region()\n#endregion';
    if (name.startsWith('table_'))
      source = ['table_style', 'table_color', 'table_filter'].includes(name)
        ? `#${name}()\n|A|h\n|B|`
        : `|A|h\n|B|\n#${name}()`;
    const r = render(source, options);
    assert.ok(
      !r.warnings.some((s) => s.includes('未対応または記法名が不正')),
      `${name}: ${r.warnings}`,
    );
  }
});
test('official catalog has no silently unclassified entries', () => {
  const unsupported = require('../src/unsupported');
  for (const { name } of require('./official-catalog.json'))
    if (name !== 'swf') assert.ok(LOCAL_NAMES.includes(name) || unsupported[name], name);
  for (const name of LOCAL_NAMES)
    assert.ok(!unsupported[name], `ambiguous classification: ${name}`);
});
test('expanded UTF-8 sample renders without warnings and all local anchors resolve', async () => {
  const r = render(await fs.readFile('output/拡張記法サンプル.txt', 'utf8'));
  assert.deepEqual(r.warnings, []);
  const ids = new Set([...r.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of r.html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), m[1]);
});
