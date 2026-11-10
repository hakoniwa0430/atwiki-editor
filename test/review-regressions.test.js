'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadPages, findPage } = require('../src/local-pages');
const { sanitizeHtml } = require('../src/safe-html');
const { createPayload } = require('../src/preview-data');
const { render } = require('../src/renderer');
const { readPlugin } = require('../src/syntax');

test('bundled KaTeX ignores inherited trusted-rendering options', () => {
  const katex = require('../vendor/katex/katex-bundle');
  assert.equal(katex.version, '0.18.2');
  const html = katex.renderToString(
    '\\href{javascript:alert(1)}{x}',
    Object.create({ trust: true }),
  );
  assert.doesNotMatch(html, /<a\b|href="javascript:/);
  assert.match(render('#math(){\\frac{1}{2}}').html, /class="katex/);
});

test('old-republic brand icon uses the preserved upstream SVG geometry', async () => {
  const svg = await fs.readFile('vendor/old-republic.svg', 'utf8');
  const geometry = svg.match(/<path d="([^"]+)"/)[1];
  const result = render('&icon_fa(fab fa-old-republic)');
  assert.ok(result.html.includes(geometry));
  assert.match(result.html, /viewBox="0 0 496 512"/);
  assert.deepEqual(result.warnings, []);
});

test('diagnostics keep the exact row inside lists, tables and definitions', () => {
  for (const source of [
    '-first\n-&image(missing.png)',
    '|first|\n|&image(missing.png)|',
    ':term|first\n&image(missing.png)',
  ]) {
    const result = render(source);
    assert.equal(result.diagnostics.find((d) => d.message.includes('missing.png')).line, 1);
  }
  assert.match(render('first\nsecond\n&areaedit()').html, /data-reveal="3"/);
});

test('duplicate explicit heading anchors warn instead of silently changing the link target', () => {
  const result = render('*First [#same]\n*Second [#same]');
  assert.match(result.warnings.join(), /アンカー名の重複/);
  assert.match(result.html, /id="same-2"/);
  assert.equal(result.diagnostics[0].line, 1);
});

test('nested footnotes respect the renderer depth limit', () => {
  for (const source of [
    '(('.repeat(1500) + 'deep' + '))'.repeat(1500),
    '&footnote('.repeat(1500) + 'deep' + ')'.repeat(1500),
  ]) {
    const result = render(source);
    assert.match(result.warnings.join(), /深すぎます/);
    assert.ok((result.html.match(/class="footnote"/g) || []).length < 30);
  }
});

test('quoted option parentheses do not terminate or extend plugin arguments', () => {
  for (const title of ['closing )', 'opening (']) {
    const source = `&image(photo.png,title="${title}",width=120);after`;
    const parsed = readPlugin(source);
    assert.equal(parsed.args, `photo.png,title="${title}",width=120`);
    assert.equal(source.slice(parsed.end), 'after');
    const result = render(source, { resolveImage: () => 'image.png' });
    assert.match(result.html, /width:120px/);
    assert.deepEqual(result.warnings, []);
  }
});

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('same-name pages use the navigation extension precedence in the index', async (t) => {
  const root = await temporary(t);
  for (const ext of ['atwiki', 'atw', 'txt'])
    await fs.writeFile(path.join(root, `Page.${ext}`), ext);
  for (const ext of ['atwiki', 'atw', 'txt']) {
    const indexed = await loadPages(root);
    assert.equal(await fs.realpath(indexed.pages.Page.file), await findPage(root, 'Page'));
    assert.equal(indexed.pages.Page.text, ext);
    await fs.unlink(path.join(root, `Page.${ext}`));
  }
});

test('image index overflow is visible without hiding wiki pages', async (t) => {
  const root = await temporary(t);
  await Promise.all(
    Array.from({ length: 501 }, (_, i) => fs.writeFile(path.join(root, `${i}.png`), '')),
  );
  await fs.writeFile(path.join(root, 'Page.atwiki'), 'page');
  const indexed = await loadPages(root);
  assert.equal(indexed.images.length, 500);
  assert.equal(indexed.truncated, true);
  assert.equal(indexed.pages.Page.text, 'page');
});

test('HTML attribute parsing is identical for upper and lower case tags', () => {
  const warnings = [];
  const upper = sanitizeHtml(
    '<DIV title="Example"><A href="https://example.com">Link</A></DIV>',
    {},
    (w) => warnings.push(w),
  );
  const lower = sanitizeHtml('<div title="Example"><a href="https://example.com">Link</a></div>');
  assert.equal(upper, lower);
  assert.deepEqual(warnings, []);
});

test('image resolution rejects directory links escaping the wiki root', async (t) => {
  const parent = await temporary(t);
  const root = path.join(parent, 'wiki');
  const outside = path.join(parent, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.png'), 'fixture');
  await fs.symlink(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const payload = createPayload({
    vscode: { Uri: { joinPath: (_, value) => 'local:///' + value } },
    document: {
      getText: () => '&image(linked/private.png)',
      fileName: path.join(root, 'Page.atwiki'),
      uri: { toString: () => 'file:///Page.atwiki' },
      lineCount: 1,
    },
    root: { fsPath: root },
    pageName: 'Page',
    panel: { webview: { asWebviewUri: (uri) => uri } },
    config: () => ({ get: (_, fallback) => fallback }),
    mode: () => '',
    index: { get: async () => ({ pages: {}, images: [] }) },
    loadScripts: async () => ({}),
  });
  const result = await payload();
  assert.doesNotMatch(result.html, /<img /);
  assert.match(result.warnings.join(), /private.png/);
});

test('VSIX includes only the distributed samples, not personal output documents', async (t) => {
  const root = await temporary(t);
  for (const dir of ['scripts', 'src', 'media', 'vendor', 'syntaxes', 'snippets', 'output', 'docs'])
    await fs.mkdir(path.join(root, dir));
  await fs.copyFile('scripts/package.js', path.join(root, 'scripts/package.js'));
  await fs.copyFile('package.json', path.join(root, 'package.json'));
  await fs.cp('node_modules', path.join(root, 'node_modules'), { recursive: true });
  for (const file of [
    'README.md',
    'docs/features.md',
    'COMPATIBILITY.md',
    'LICENSE',
    'language-configuration.json',
    'output/サンプル_アットウィキ.txt',
    'output/拡張記法サンプル.txt',
    'output/private.txt',
  ])
    await fs.writeFile(path.join(root, file), 'fixture');
  execFileSync(process.execPath, [path.join(root, 'scripts/package.js')]);
  const pkg = require('../package.json');
  const archive = await fs.readFile(path.join(root, `atwiki-editor-${pkg.version}.vsix`));
  const names = [];
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const length = archive.readUInt16LE(offset + 26);
    const extra = archive.readUInt16LE(offset + 28);
    names.push(archive.subarray(offset + 30, offset + 30 + length).toString());
    offset += 30 + length + extra + size;
  }
  assert.ok(names.includes('extension/docs/features.md'));
  assert.ok(names.includes('extension/output/サンプル_アットウィキ.txt'));
  assert.ok(names.includes('extension/output/拡張記法サンプル.txt'));
  assert.ok(!names.includes('extension/output/private.txt'));
  assert.ok(names.includes('extension/node_modules/sharp/package.json'));
  assert.ok(names.some((name) => name.endsWith('.node')));
  assert.ok(!names.some((name) => name.startsWith('extension/node_modules/prettier/')));
});

test('included warnings retain their page and later inline warnings retain their host row', () => {
  const result = render('&include(Child) &image(host-missing.png)', {
    pages: { Child: 'line 1\nline 2\n&image(child-missing.png)' },
  });
  assert.equal(result.diagnostics.find((d) => d.message.includes('host-missing')).line, 0);
  const child = result.diagnostics.find((d) => d.message.includes('child-missing'));
  assert.equal(child.page, 'Child');
  assert.equal(child.line, 2);
});

test('plugin validation does not interpret literal QR contents as sizing options', () => {
  assert.deepEqual(render('&qr(width=not-a-size)').warnings, []);
});

test('generated heading destinations in local lists are valid preview links', () => {
  assert.deepEqual(
    render('#ls2(title)', { pageName: 'P', pages: { 'P/C': '*Title' }, validateLinks: true })
      .warnings,
    [],
  );
});
