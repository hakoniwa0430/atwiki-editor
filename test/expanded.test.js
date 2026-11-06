'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');
const { readPlugin, splitTop, safeStyle } = require('../src/syntax');
const { sanitizeHtml } = require('../src/safe-html');
const { compare, calculate } = require('../media/interactions');
const { findPage, loadPages, resolvePage } = require('../src/local-pages');
const fs = require('node:fs/promises');
const path = require('node:path');

test('balanced arguments, nested delimiters, literal braces and table separators', () => {
  const p = readPlugin('&spanstyle(color:rgb(1,2,3)){&bold(){nested}}');
  assert.equal(p.args, 'color:rgb(1,2,3)');
  assert.equal(p.body, '&bold(){nested}');
  assert.equal(readPlugin('#nowiki(){{{unbalanced { text}}}').body, 'unbalanced { text');
  assert.deepEqual(splitTop('a|&nowiki(){x|y}|[[x|y>p]]|z\\|w', '|'), [
    'a',
    '&nowiki(){x|y}',
    '[[x|y>p]]',
    'z\\|w',
  ]);
});
test('table joins form rectangular horizontal and vertical spans', () => {
  const r = render('|>|連結|右|\n|>|~|下|\n|A|B|C|');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /colspan="2" rowspan="2">連結/);
  assert.equal((r.html.match(/<td /g) || []).length, 6);
});
test('vertical continuation with one marker per occupied column', () => {
  const r = render('|>|結合|\n|~|~|');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /colspan="2" rowspan="2"/);
});
test('column formats are inherited, headers and footers are real sections', () => {
  const r = render('|CENTER:100|COLOR(red):200|c\n|項目|内容|h\n|A|B|\n|合計|10|f');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /<thead>/);
  assert.match(r.html, /<tfoot>/);
  assert.match(r.html, /text-align:center;width:100px/);
  assert.match(r.html, /color:red;width:200px/);
});
test('table separators inside plugins, links and escaped literals do not add columns', () => {
  const r = render('|&nowiki(){a|b}|[[x|y>page]]|z\\|w|&#124;|');
  assert.equal((r.html.match(/<td /g) || []).length, 4);
  assert.match(r.html, />a\|b<\/td>/);
  assert.match(r.html, />z\|w<\/td>/);
});
test('table style, hover, filtering, numbering, zebra and sort options are applied', () => {
  const r = render(
    '#table_style(head=#eee,hover=#def){名前=#abc:bold}\n#table_filter(){数=hide}\n|名前|数|h\n|甲|2|\n|乙|10|\n#table_zebra(#eee,#fff,#ddd)\n#table_sorter(){repeathead=1}\n#table_autoincrement(){label=番号,start=10,inc=2}',
  );
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /tr:hover/);
  assert.match(r.html, /data-column="1" hidden/);
  assert.match(r.html, /data-sortable="true"/);
  assert.match(r.html, /data-sequence>10/);
  assert.match(r.html, /data-sequence>12/);
  assert.match(r.html, /data-repeat="true"/);
});
test('multiline and nested blocks retain source line mapping', () => {
  const r = render('#center(){{{\n*内部\n#divstyle(color:red){\n本文\n}\n}}}');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /text-align:center/);
  assert.match(r.html, /<h2[^>]*data-line="1"/);
  assert.match(r.html, /data-line="3">本文/);
});
test('nowiki, comments, typography, ruby and all basic aliases', () => {
  const r = render(
    '&nowiki(){[[raw]]} &co(){hidden} &ruby(よみ){字} &s(){a}&strike(){b}&underline(){c}&strong(){d}&big(){e}&small(){f}&tt(){g}&cite(title)&q(quote)&mark_copy()&mark_reg()',
  );
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /<ruby>字<rp>（<\/rp><rt>よみ/);
  assert.doesNotMatch(r.html, /hidden/);
  assert.match(r.html, /\[\[raw\]\]/);
});
test('font handles multiple decorations, sizes, colors and named relative sizes', () => {
  const r = render('&font(b,i,u,o,l,12pt,#f00,#eee){x} &sizex(+2){y} &underdot(red,2px){z}');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /font-size:12pt/);
  assert.match(r.html, /underline overline line-through/);
  assert.match(r.html, /font-size:x-large/);
});
test('footnotes link forward and backward and can reference the same note', () => {
  const r = render('本文((注記)) &footnote(別の注記) &footnote(){1}');
  assert.deepEqual(r.warnings, []);
  assert.equal((r.html.match(/<li id="note-/g) || []).length, 2);
  assert.equal((r.html.match(/href="#note-1"/g) || []).length, 2);
});
test('TOC preserves formatting and explicit anchors without cloning IDs', () => {
  const r = render('#contents\n* &color(red){見出し} [#custom]\n**小見出し');
  assert.match(r.html, /href="#custom"><span style="color:red;">/);
  assert.equal((r.html.match(/id="custom"/g) || []).length, 1);
});
test('KaTeX typesets fractions and matrices offline, rejecting unsafe HTML macros', () => {
  const r = render('#math(){{{\\frac{a}{b}+\\begin{matrix}1&2\\\\3&4\\end{matrix}}}}');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /class="katex/);
  assert.match(r.html, /<mfrac>/);
  const bad = render('&math(){\\href{javascript:alert(1)}{x}}');
  assert.doesNotMatch(bad.html, /href="javascript/);
});
test('code highlighting preserves code and supports line numbers', () => {
  const r = render('#highlight(javascript,linenumber){{{\nconst x = "hello";\n// note\n}}}');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /hljs-keyword/);
  assert.match(r.html, /class="line-number"/);
  assert.match(r.html, /hello/);
});
test('QR generation supports UTF-8 Japanese and yields actual vector modules', () => {
  const r = render('&qr(日本語のテスト)');
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /<svg class="qr-code"/);
  assert.match(r.html, /<path/);
});
test('HTML sanitization allows formatted content while removing privileged elements and URLs', () => {
  const warnings = [];
  const html = sanitizeHtml(
    '<b title="ok">safe</b><a href="jav&#x61;script:alert(1)">bad</a><img src="x.png" onerror="bad()"><iframe srcdoc="bad"></iframe><script>bad()</script>',
    { resolveImage: () => '/image.png' },
    (w) => warnings.push(w),
  );
  assert.match(html, /<b title="ok">safe<\/b>/);
  assert.match(html, /<img src="\/image.png">/);
  assert.doesNotMatch(html, /<script|<iframe|onerror=|href="javascript/);
  assert.ok(warnings.length >= 3);
});
test('CSS rejects network/executable values but keeps valid layout and color functions', () => {
  const warnings = [];
  const style = safeStyle(
    'color:rgb(1,2,3);width:20em;background-color:url(https://example.com);font-size:expression(x);padding:2px',
    (w) => warnings.push(w),
  );
  assert.match(style, /color:rgb\(1,2,3\);width:20em/);
  assert.doesNotMatch(style, /url|expression/);
  assert.equal(warnings.length, 2);
});
test('sandboxed JavaScript has no same-origin or parent permissions', () => {
  const r = render('#javascript(){{document.write("hello")}}', { scriptNonce: 'testnonce' });
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(r.html, /allow-same-origin|<script/);
});
test('local includes, nested includes and cycles are handled', () => {
  const pages = { A: '*A\n#include(B)', B: '本文' };
  const r = render('#include(A)', { pages });
  assert.deepEqual(r.warnings, []);
  assert.match(r.html, /本文/);
  assert.ok(
    render('#include(A)', { pages: { A: '#include(A)' } }).warnings.some((s) => s.includes('循環')),
  );
});
test('device conditions, inline toggles, trees and gauges', () => {
  const r = render(
    '&pc(){PC}&mobile(){Mobile}\n&openclose2(show=開く,inline){本文}\n#treemenu(title=木,[[A]],[[B]])\n#gaugeset(limit=4,char=■,col1=#f00,col2=#00f)\n&gauge(2,2)',
  );
  assert.deepEqual(r.warnings, []);
  assert.doesNotMatch(r.html, /Mobile/);
  assert.match(r.html, /aria-expanded="true"/);
  assert.match(r.html, /data-page="A"/);
  assert.equal((r.html.match(/■/g) || []).length, 5);
});
test('countdown uses minutes by default, handles units, rounding, elapsed dates and leap years', () => {
  const options = { now: '2024-02-28T00:00:00' };
  assert.match(render('&countdown(2024/03/01)', options).html, />2880<\/span>/);
  assert.match(render('&countdown(2024/03/01,d)', options).html, />2<\/span>/);
  assert.doesNotMatch(render('&countdown(2020/01/01)', options).html, /data-count/);
  assert.match(render('&countup(2023/02/28,yd)', options).html, />1年0日<\/span>/);
});
test('numeric/date sorting keeps empty cells last in either direction', () => {
  assert.ok(compare('2', '10') < 0);
  assert.ok(compare('2024/1/2', '2024/12/1') < 0);
  assert.ok(compare('', '2', 1) > 0);
  assert.ok(compare('', '2', -1) > 0);
});
test('calculator uses a parser, supports precedence and rejects executable input', () => {
  assert.equal(calculate('2 + 3 * (4 - 1)'), 11);
  assert.equal(calculate('-2 * -3'), 6);
  assert.throws(() => calculate('process.exit()'));
  assert.throws(() => calculate('1/0'));
});
test('local page loading refuses traversal and includes unsaved buffers', async () => {
  const root = path.resolve('.inspection/pages-test');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'A.atwiki'), '*Saved');
  assert.equal(await findPage(root, '../outside'), null);
  assert.equal(await findPage(root, 'A'), path.join(root, 'A.atwiki'));
  const result = await loadPages(root, [
    { uri: { scheme: 'file' }, fileName: path.join(root, 'A.atwiki'), getText: () => '*Unsaved' },
  ]);
  assert.equal(result.pages.A.text, '*Unsaved');
});

test('slash page names resolve files under their parent folder', async () => {
  const root = path.resolve('.inspection/nested-pages-test');
  await fs.mkdir(path.join(root, 'ほげ'), { recursive: true });
  for (const ext of ['atwiki', 'atw', 'txt']) {
    await fs.writeFile(path.join(root, 'ほげ', 'ふが.' + ext), '&aname(場所){}');
    assert.equal(await findPage(root, 'ほげ/ふが.' + ext), path.join(root, 'ほげ', 'ふが.' + ext));
  }
  assert.equal(await findPage(root, 'ほげ/ふが'), path.join(root, 'ほげ', 'ふが.atwiki'));
  assert.equal(await findPage(root, 'ほげ/../../outside'), null);
});

test('nested source opened directly resolves wiki-prefixed sibling pages without traversing arbitrary parents', async () => {
  const root = path.resolve('.inspection/root-inference'),
    sub = path.join(root, 'アルミオシオンの医術師');
  await fs.mkdir(sub, { recursive: true });
  const file = path.join(sub, 'フィールドボス.atwiki');
  await fs.writeFile(file, '**墜落魔ジャッキー');
  const result = await resolvePage(
    sub,
    'アルミオシオンの医術師/フィールドボス',
    path.join(sub, 'MAP.atwiki'),
  );
  assert.deepEqual(result, { file, root });
  assert.equal(
    await resolvePage(sub, '../../outside/フィールドボス', path.join(sub, 'MAP.atwiki')),
    null,
  );
  assert.equal(await resolvePage(sub, '無関係/フィールドボス', path.join(sub, 'MAP.atwiki')), null);
});
