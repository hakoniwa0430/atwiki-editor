'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { render } = require('../src/renderer');

test('plugin bodies preserve argument fallback, empty bodies and inline rendering', () => {
  for (const name of ['div', 'pc', 'openclose']) {
    for (const sigil of ['#', '&']) {
      assert.match(render(`${sigil}${name}(代替)`).html, /代替/);
      assert.doesNotMatch(render(`${sigil}${name}(代替){}`).html, /代替/);
      assert.match(render(`${sigil}${name}(){&bold(){本文}}`).html, /<strong>本文<\/strong>/);
    }
  }
});

test('plugin body diagnostics retain line offsets and included page identity', () => {
  for (const name of ['div', 'pc', 'openclose']) {
    for (const [body, line] of [
      ['&image(../bad.png)', 0],
      ['\n&image(../bad.png)\n', 1],
    ]) {
      const source = `#${name}(){${body}}`;
      const expected = { message: '画像の参照先を解決できません: ../bad.png', line };
      assert.deepEqual(render(source).diagnostics, [expected]);
      assert.deepEqual(render('#include(別)', { pages: { 別: source } }).diagnostics, [
        { ...expected, page: '別' },
      ]);
    }
  }
  for (const [name, mode] of [
    ['pc', 'mobile'],
    ['mobile', 'desktop'],
  ]) {
    const result = render(`#${name}(){\n&image(../bad.png)\n}`, { mode });
    assert.deepEqual(result.diagnostics, []);
    assert.doesNotMatch(result.html, /bad.png/);
  }
});

test('shared body paths retain recursion limits', () => {
  for (const name of ['div', 'pc', 'openclose']) {
    for (const sigil of ['#', '&']) {
      const source =
        `${sigil}${name}(){${sigil === '#' ? '\n' : ''}`.repeat(30) +
        '本文' +
        `${sigil === '#' ? '\n' : ''}}`.repeat(30);
      assert.match(render(source).warnings.join(), /入れ子が深すぎます/);
    }
  }
});

test('plain lines share a block with breaks and retain source line mapping', () => {
  const { html } = render('一行目\r\n二行目\n\n\n*見出し\n本文');
  assert.match(
    html,
    /<div class="text-block"><span class="text-line" data-line="0">一行目<\/span><br><span class="text-line" data-line="1">二行目<\/span><\/div>/,
  );
  assert.match(
    html,
    /<br class="wiki-blank" data-line="2">\n<br class="wiki-blank" data-line="3">\n<h2/,
  );
  assert.match(html, /data-line="5">本文<\/span><\/div>$/);
});

test('explicit breaks, hidden comments and final newline do not add text blocks', () => {
  const { html } = render('前&br()後\n//非表示\n続き\n');
  assert.equal((html.match(/class="text-block"/g) || []).length, 1);
  assert.equal((html.match(/<br>/g) || []).length, 2);
  assert.doesNotMatch(html, /wiki-blank|非表示/);
  assert.equal(render('').html, '');
  assert.equal((render('本文\n\n').html.match(/wiki-blank/g) || []).length, 1);
});

test('text blocks close before structural elements and region boundaries', () => {
  const { html } = render('前\n-項目\n後\n#region(開く)\n中\n#endregion\n末');
  assert.match(html, /前<\/span><\/div>\n<ul>/);
  assert.match(html, /後<\/span><\/div>\n<details/);
  assert.match(html, /中<\/span><\/div>\n<\/details>\n<div class="text-block">/);
});

test('headings, generated TOC and duplicate titles have unique IDs', () => {
  const result = render('#contents\n*見出し\n**見出し\n*****詳細');
  assert.equal(result.headings.length, 3);
  assert.match(result.html, /href="#heading-2"/);
  assert.match(result.html, /<h6 id="heading-4"/);
  assert.equal(new Set(result.headings.map((h) => h.anchor)).size, 3);
});
test('inline styles support nested plugins and AtWiki quote convention', () => {
  const { html, warnings } = render(
    "''太字'' '''斜体''' %%削除%% &bold(){&color(red){色}} &u(){線} &br()",
  );
  assert.match(html, /<strong>太字<\/strong> <em>斜体<\/em> <del>削除<\/del>/);
  assert.match(html, /<strong><span style="color:red;">色<\/span><\/strong>/);
  assert.match(html, /<u>線<\/u> <br>/);
  assert.deepEqual(warnings, []);
});
test('tables have headers, formatting and line mapping', () => {
  const { html } = render('|項目|内容|h\n|CENTER:名前|BGCOLOR(#fff):値&br()次|');
  assert.match(html, /<th[^>]*>項目<\/th>/);
  assert.match(html, /<tr data-line="1"><td[^>]*style="text-align:center;">名前/);
  assert.match(html, /background-color:#fff;">値<br>次/);
});
test('nested lists keep children inside parent list items', () => {
  const { html } = render('-親\n--子\n---孫\n-次\n+番号');
  assert.match(html, /<li data-line="0">親\n<ul>/);
  assert.match(html, /孫\n<\/li><\/ul>\n<\/li><\/ul>\n<\/li>\n<li data-line="3">次/);
  assert.match(html, /<ol>\n<li data-line="4">番号/);
});
test('comments and multiline comments are hidden', () => {
  const { html } = render('//SECRET\n#co{\nHIDDEN\n&bold(){nested}\n}\n見える');
  assert.doesNotMatch(html, /SECRET|HIDDEN|nested/);
  assert.match(html, /見える/);
});
test('preformatted content is escaped and not parsed', () => {
  assert.match(render(" ''raw''\n <script>").html, /&#39;&#39;raw&#39;&#39;\n&lt;script&gt;/);
});
test('anchors including Japanese, external and plain URLs are safe', () => {
  const result = render(
    '&aname(概要,option=nolink){}\n[[先頭>#概要]]\n[[公式>>https://example.com/]]\nhttps://example.com',
  );
  assert.match(result.html, /id="概要"/);
  assert.match(result.html, /href="#概要"/);
  assert.match(result.html, /href="https:\/\/example.com\/"/);
  assert.deepEqual(result.warnings, []);
});
test('raw HTML, attribute injection and executable URLs never become markup', () => {
  const result = render(
    '<img src=x onerror=alert(1)>\n[[bad>javascript:alert(1)]]\n&aname(x" onclick="bad){}\n&color(red;background:url(https://evil)){text}\n&html(){<script>alert(1)</script>}',
  );
  assert.doesNotMatch(
    result.html,
    /<script|<img|href="javascript:|id="x" onclick|style="color:red;background/,
  );
  assert.ok(result.warnings.some((w) => w.includes('script')));
  assert.ok(result.warnings.length >= 2);
});
test('unknown syntax stays visible with warnings', () => {
  const result = render('#include(other)\n&unknown(){text}\n|>|~|');
  assert.match(result.html, /class="unsupported">other/);
  assert.ok(result.warnings.some((w) => w.startsWith('unknown')));
  assert.ok(result.warnings.some((w) => w.includes('縦結合先が不正')));
});
test('region markup, invalid region and malformed plugin are bounded', () => {
  assert.match(
    render('#region(開く)\n本文\n#endregion').html,
    /<details.*<summary>開く<\/summary>/,
  );
  assert.ok(render('#region(未閉鎖)').warnings.includes('閉じていない #region'));
  assert.match(render('&bold(){未閉鎖').html, /&amp;bold/);
});
test('images need an explicit resolver; remote images remain offline', () => {
  assert.doesNotMatch(render('#image(https://example.com/a.png)').html, /<img/);
  const { html } = render('&image(test.png,width=120)', {
    resolveImage: () => 'https://webview.local/test.png',
  });
  assert.match(
    html,
    /<img src="https:\/\/webview.local\/test.png" alt="test.png" style="width:120px;"/,
  );
});
test('definition, quote and horizontal line rendering', () => {
  const { html } = render(':用語|説明\n続き\n\n>引用\n----');
  assert.match(html, /<dt>用語<\/dt><dd>説明<br>続き<\/dd>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<hr data-line="4">/);
});

test('consecutive quote lines share a frame and preserve breaks and source mapping', () => {
  const { html } = render('>一行目\n>二行目&br()続き\n>\n>最終行\n本文');
  assert.equal((html.match(/<blockquote>/g) || []).length, 1);
  assert.match(
    html,
    /data-line="0">一行目<\/span><br><span class="text-line" data-line="1">二行目<br>続き/,
  );
  assert.match(html, /<br class="wiki-blank" data-line="2">/);
  assert.match(html, /data-line="3">最終行<\/span><\/div><\/blockquote>\n<div class="text-block">/);
  assert.match(html, /data-line="4">本文/);
});

test('nested quotes share their outer frame and blank lines end a quote', () => {
  const { html } = render('>外\n>>内1\n>>内2\n>外続き\n\n>別枠');
  assert.equal((html.match(/<blockquote>/g) || []).length, 3);
  assert.equal((html.match(/<\/blockquote>/g) || []).length, 3);
  assert.match(html, /data-line="1">内1<\/span><br><span class="text-line" data-line="2">内2/);
  assert.match(html, /<\/blockquote>\n<br class="wiki-blank" data-line="4">\n<blockquote>/);
});
test('duplicate explicit anchors are detected', () => {
  const result = render('&aname(a){}\n&aname(a){}');
  assert.match(result.html, /id="a-2"/);
  assert.ok(result.warnings.includes('アンカー名の重複'));
});
test('sample renders with no warnings and all anchor links resolve', () => {
  const sample = fs.readFileSync('output/サンプル_アットウィキ.txt', 'utf8');
  const { html, warnings } = render(sample);
  assert.deepEqual(warnings, []);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const match of html.matchAll(/href="#([^"]+)"/g))
    assert.ok(ids.includes(match[1]), match[1]);
  assert.equal(ids.length, new Set(ids).size);
});
test('deep and incomplete user input cannot overflow the stack', () => {
  assert.doesNotThrow(() => render('&bold(){'.repeat(500) + 'text' + '}'.repeat(500)));
  assert.doesNotThrow(() => render('[[incomplete\n&color(red){\n#co{'));
});

test('cross-page anchor plugins preserve folder paths, aliases and anchor_only', () => {
  const { html, warnings } = render(
    '&link_anchor(場所,page=ほげ/ふが){移動}\n&link_aname(page=ほげ/ふが,場所){別名}\n[[通常>ほげ/ふが#場所]]\n&link_anchor(場所,page=ほげ/ふが,anchor_only=true){ここ}',
  );
  assert.equal((html.match(/data-page="ほげ\/ふが#場所"/g) || []).length, 3);
  assert.match(html, /href="#場所" data-named-anchor="true">ここ/);
  assert.deepEqual(warnings, []);
});
