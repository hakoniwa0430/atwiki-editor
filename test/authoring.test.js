'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/renderer');
const { candidates, registerLanguageFeatures } = require('../src/language-features');

test('multiline and nested arguments complete images and outer options', () => {
  assert.deepEqual(
    candidates('&image(../', {}, '', ['other/a.png', 'folder/b.png'], 'folder/page').map(
      (c) => c.label,
    ),
    ['../other/a.png'],
  );
  assert.ok(candidates('#slide_img(\nwidth=300,\nhe').some((c) => c.insertText === 'height='));
  assert.ok(
    candidates('&infobox(title=&color(red){説明},\ntri').some((c) => c.insertText === 'trigger='),
  );
  assert.ok(
    candidates('&infobox(title=&image(b', {}, '', ['folder/b.png'], 'folder/page').some(
      (c) => c.label === 'b.png',
    ),
  );
});

test('option diagnostics identify source rows and areaedit end with options is hidden', () => {
  const result = render('本文\n#areaedit(end,mode=simple)\n#memo(rows=0,typo=1)\n[[x>missing]]', {
    validateLinks: true,
    pages: {},
  });
  assert.doesNotMatch(result.html, /部分編集/);
  assert.ok(result.diagnostics.some((d) => d.line === 2 && d.message.includes('typo')));
  assert.ok(result.diagnostics.some((d) => d.line === 2 && d.message.includes('rows')));
  assert.ok(result.diagnostics.some((d) => d.line === 3 && d.message.includes('missing')));
  const regions = render(
    '#region(同名,remember)\na\n#endregion\n#region(同名,remember)\nb\n#endregion',
  );
  const keys = [...regions.html.matchAll(/data-remember="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, 2);
});

test('slide alignment is not overridden by image wrappers and invalid settings warn', () => {
  const options = { resolveImage: (s) => 'local/' + s };
  for (const align of ['center', 'right']) {
    const result = render(
      `#slide_img(width=300,height=200,position=${align}){a.png,b.png}`,
      options,
    );
    assert.deepEqual(result.warnings, []);
    assert.match(result.html, new RegExp('text-align:' + align));
    assert.doesNotMatch(result.html, /text-align:left/);
    assert.equal((result.html.match(/<img /g) || []).length, 2);
  }
  const bad = render('#slide_img(auto=99,width=10,position=other,typo=1){a.png}', options);
  for (const part of ['auto', 'width', 'height', 'position', 'typo', '2〜10'])
    assert.ok(
      bad.warnings.some((w) => w.includes(part)),
      part,
    );
  assert.match(render('&image(a.png,typo=1)', options).warnings.join(), /typo/);
  assert.deepEqual(
    render('&image(https://example.com/image?id=1,width=300)', options).warnings,
    [],
  );
});

test('link validation handles forward anchors, headings, encoded names and cross-page cycles', () => {
  const source =
    '[[a>#後]] [[b>別#見出し]] [[c>別.atwiki#%E5%85%88]] [[d>#見出し]]\n&aname(後,option=nolink){}\n*見出し';
  const options = {
    validateLinks: true,
    pageName: '今',
    pages: {
      別: '*見出し\n&aname(先){}\n[[循環>今#後]]',
      今: source,
    },
  };
  assert.deepEqual(render(source, options).warnings, [
    'アンカーが見つかりません: 別#見出し',
    'アンカーが見つかりません: #見出し',
  ]);
  const bad = render(
    '[[a>#不在]] [[b>別#不在]] [[c>未作成]] [[d>https://example.com/#missing]]',
    options,
  );
  assert.equal(bad.warnings.length, 3);
  assert.ok(bad.warnings.some((w) => w.includes('別#不在')));
  assert.match(render('[[x>不在]]', { ...options, pagesTruncated: true }).warnings.join(), /上限/);
});

test('completion covers plugin names, options, pages and unsaved anchor text', () => {
  const pages = { '攻略/基本': '*概要\n&aname(場所){}' };
  assert.ok(candidates('&ima').some((c) => c.label === 'image' && c.replace === 3));
  assert.ok(candidates('#slide_img(wi').some((c) => c.insertText === 'width='));
  assert.ok(candidates('#region(op').some((c) => c.insertText === 'open'));
  assert.equal(candidates('[[表示>攻略/', pages)[0].label, '攻略/基本');
  assert.equal(candidates('#include(攻略/', pages)[0].label, '攻略/基本');
  assert.equal(candidates('&image(a.png,page=攻略/', pages)[0].label, '攻略/基本');
  assert.ok(candidates('[[表示>攻略/基本#', pages).some((c) => c.label === '場所'));
  assert.deepEqual(candidates('[[表示>#', pages, '*未保存見出し'), []);
  assert.ok(candidates('[[表示>#', pages, '&aname(未保存){}').some((c) => c.label === '未保存'));
  assert.deepEqual(candidates('普通の文章', pages), []);
});

test('language providers register, release their index and show safe hover documentation', async () => {
  let completion,
    hover,
    released = 0;
  const context = { subscriptions: [] };
  const api = {
    languages: {
      registerCompletionItemProvider: (_, provider) => {
        completion = provider;
        return { dispose() {} };
      },
      registerHoverProvider: (_, provider) => {
        hover = provider;
        return { dispose() {} };
      },
    },
    workspace: {},
    CompletionItem: class {
      constructor(label) {
        this.label = label;
      }
    },
    Range: class {
      constructor(...args) {
        this.args = args;
      }
    },
    MarkdownString: class {
      constructor() {
        this.value = '';
      }
      appendText(s) {
        this.value += s;
      }
      appendCodeblock(s) {
        this.value += s;
      }
    },
    Hover: class {
      constructor(contents) {
        this.contents = contents;
      }
    },
  };
  const doc = {
    uri: { scheme: 'file', toString: () => 'file:///wiki/current.atwiki' },
    fileName: '/wiki/current.atwiki',
    lineAt: () => ({ text: '[[別#' }),
    getText: () => '*未保存',
  };
  registerLanguageFeatures(
    api,
    context,
    {
      retain: () => () => released++,
      get: async () => ({ pages: { 別: '*説明' } }),
    },
    new Map(),
  );
  const items = await completion.provideCompletionItems(doc, { line: 0, character: 4 }, {});
  assert.deepEqual(items, []);
  assert.equal(released, 1);
  const result = hover.provideHover(
    { lineAt: () => ({ text: '#slide_img()' }) },
    { line: 0, character: 5 },
  );
  assert.match(result.contents.value, /290以上/);
  const optionHover = hover.provideHover(
    { lineAt: () => ({ text: '#slide_img(width=300)' }) },
    { line: 0, character: 12 },
  );
  assert.match(optionHover.contents.value, /width.*290以上/);
  const lines = ['&infobox(title=&color(red){説明},', 'trigger=hover){}'];
  const multilineHover = hover.provideHover(
    { lineAt: (i) => ({ text: lines[i] }) },
    { line: 1, character: 3 },
  );
  assert.match(multilineHover.contents.value, /trigger.*hover/);
  const tableLines = ['#table_autoincrement(){', 'start=2,inc=3}'];
  const tableHover = hover.provideHover(
    { lineAt: (i) => ({ text: tableLines[i] }) },
    { line: 1, character: 2 },
  );
  assert.match(tableHover.contents.value, /start.*開始番号/);
  const layoutHover = hover.provideHover(
    { lineAt: () => ({ text: '#div(width=300){本文}' }) },
    { line: 0, character: 7 },
  );
  assert.match(layoutHover.contents.value, /width.*幅/);
  assert.equal(context.subscriptions.length, 2);
});
