'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ failInitialize = false } = {}) {
  const listeners = {},
    sent = [],
    token = 'host-only-token';
  const elements = new Map(
    ['content', 'status', 'filename', 'warning-list', 'warnings', 'warning-count'].map((id) => [
      id,
      {
        textContent: id === 'status' ? '読み込み中' : '',
        innerHTML: '',
        querySelectorAll: () => [],
        addEventListener(name, fn) {
          this[name] = fn;
        },
        children: [],
        replaceChildren(...children) {
          this.children = children;
        },
        appendChild(child) {
          this.children.push(child);
        },
        firstElementChild: {},
      },
    ]),
  );
  const document = {
    getElementById: (id) => elements.get(id),
    querySelector: (selector) =>
      selector === 'meta[name="atwiki-message-token"]' ? { content: token } : null,
    body: {},
    addEventListener(name, fn) {
      listeners['document:' + name] = fn;
    },
    createElement: () => ({
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener(name, fn) {
        this[name] = fn;
      },
    }),
  };
  const window = {
    scrollY: 0,
    addEventListener: (name, fn) => (listeners[name] = fn),
    scrollTo() {},
  };
  // VS Code masks window.parent as window, but event.source remains the host frame.
  window.parent = window;
  vm.runInNewContext(fs.readFileSync('media/preview.js', 'utf8'), {
    window,
    document,
    acquireVsCodeApi: () => ({
      getState: () => null,
      setState() {},
      postMessage: (msg) => sent.push(msg),
    }),
    AtWikiInteractions: {
      initialize() {
        if (failInitialize) throw Error('fixture failure');
        return () => {};
      },
    },
    setTimeout,
    clearTimeout,
  });
  const deliver = (data, source = { host: true }) => listeners.message({ data, source });
  return {
    elements,
    token,
    deliver,
    sent,
    click: (link) =>
      listeners['document:click']({ target: { closest: () => link }, preventDefault() {} }),
  };
}
const payload = {
  type: 'render',
  html: '<h2>表示テスト</h2>',
  name: 'test.atwiki',
  lines: 1,
  warnings: [],
  theme: 'paper',
};

test('remembered regions restore and toggle events persist the new value', () => {
  const app = setup();
  const detail = { dataset: { line: '1', remember: 'region-key' }, open: false };
  app.elements.get('content').querySelectorAll = () => [detail];
  app.deliver({ ...payload, token: app.token, remembered: { 'region-key': true } });
  assert.equal(detail.open, true);
  detail.open = false;
  app.elements.get('content').toggle({ target: detail });
  assert.equal(app.sent.at(-1).type, 'remember');
  assert.equal(app.sent.at(-1).open, false);
});

test('image load errors are visible and warning buttons reveal their source', () => {
  const app = setup();
  app.deliver({
    ...payload,
    token: app.token,
    warnings: ['参照切れ'],
    diagnostics: [{ message: '参照切れ', line: 2 }],
  });
  app.elements.get('warning-list').children[0].children[0].click();
  assert.equal(app.sent.at(-1).line, 2);
  app.elements
    .get('content')
    .error({ target: { tagName: 'IMG', getAttribute: () => 'https://example.com/missing.png' } });
  assert.equal(app.elements.get('warnings').hidden, false);
  assert.match(
    app.elements.get('warning-list').children.at(-1).textContent,
    /画像を読み込めません/,
  );
  assert.equal(app.elements.get('warning-count').textContent, '(2)');
});
test('real preview script accepts host-frame delivery after ready and leaves loading state', () => {
  const app = setup();
  assert.equal(app.sent[0].type, 'ready');
  app.deliver({ ...payload, token: app.token });
  assert.match(app.elements.get('content').innerHTML, /表示テスト/);
  assert.equal(app.elements.get('status').textContent, '1 行 · 更新済み');
});
test('nested frame messages cannot replace content without the host token', () => {
  const app = setup();
  app.deliver({ ...payload, token: app.token });
  app.deliver({ ...payload, html: 'forged', token: 'wrong' }, { sandbox: true });
  app.deliver({ ...payload, html: 'missing token' }, { sandbox: true });
  assert.match(app.elements.get('content').innerHTML, /表示テスト/);
});
test('rendering failures are visible instead of remaining on loading', () => {
  const app = setup({ failInitialize: true });
  app.deliver({ ...payload, token: app.token });
  assert.equal(app.elements.get('status').textContent, '表示エラー: fixture failure');
});
test('extension-side errors are displayed in the preview', () => {
  const app = setup();
  app.deliver({ type: 'error', message: 'read failed', token: app.token });
  assert.equal(app.elements.get('status').textContent, '表示エラー: read failed');
});

test('user links require aname while generated contents links still navigate headings', () => {
  const app = setup();
  let scrolled = 0;
  const parent = { tagName: 'DETAILS', open: false, parentElement: null };
  const heading = {
    textContent: '墜落魔ジャッキー',
    parentElement: parent,
    scrollIntoView() {
      scrolled++;
    },
  };
  app.elements.get('content').querySelectorAll = (selector) =>
    selector === 'h2,h3,h4,h5,h6' ? [heading] : [];
  app.deliver({ type: 'anchor', anchor: '墜落魔ジャッキー', token: app.token });
  assert.equal(scrolled, 0);
  assert.equal(parent.open, false);
  app.elements.set('heading-1', heading);
  app.deliver({ type: 'anchor', anchor: 'heading-1', token: app.token });
  app.click({ dataset: { namedAnchor: 'true' }, getAttribute: () => '#heading-1' });
  assert.equal(scrolled, 0);
  app.click({ dataset: {}, getAttribute: () => '#heading-1' });
  assert.equal(scrolled, 1);
  assert.equal(parent.open, true);
  app.elements.set('墜落魔ジャッキー', {
    dataset: { atwikiAnchor: 'true' },
    parentElement: parent,
    scrollIntoView() {
      scrolled += 10;
    },
  });
  app.deliver({ type: 'anchor', anchor: '墜落魔ジャッキー', token: app.token });
  assert.equal(scrolled, 11);
  app.click({
    dataset: { namedAnchor: 'true' },
    getAttribute: () => '#' + encodeURIComponent('墜落魔ジャッキー'),
  });
  assert.equal(scrolled, 21);
  app.deliver({ type: 'anchor', anchor: 'heading-1', generatedAnchor: true, token: app.token });
  assert.equal(scrolled, 22);
});

test('attachment and blank page links send the correct host requests', () => {
  const app = setup();
  app.click({ dataset: { attachment: 'manual.pdf' } });
  assert.equal(app.sent.at(-1).type, 'attachment');
  assert.equal(app.sent.at(-1).path, 'manual.pdf');
  app.click({ dataset: { page: '攻略', newWindow: 'true' } });
  assert.equal(app.sent.at(-1).type, 'page');
  assert.equal(app.sent.at(-1).newWindow, true);
  app.click({ dataset: { page: '攻略/基本#場所', newWindow: 'true' } });
  assert.equal(app.sent.at(-1).page, '攻略/基本#場所');
  assert.equal(app.sent.at(-1).newWindow, true);
  app.click({ dataset: {}, getAttribute: () => 'HTTPS://example.com/?x=1' });
  assert.equal(app.sent.at(-1).type, 'external');
  assert.equal(app.sent.at(-1).url, 'HTTPS://example.com/?x=1');
});

test('editable include double click sends source row; ordinary includes only navigate', () => {
  const app = setup();
  const content = app.elements.get('content');
  const include = { dataset: { include: '表ページ', editableInclude: 'true' } };
  const target = {
    closest: (selector) =>
      selector === '[data-include]'
        ? include
        : selector === '[data-line]'
          ? { dataset: { line: '3' } }
          : null,
  };
  content.dblclick({ target });
  assert.equal(app.sent.at(-1).page, '表ページ');
  assert.equal(app.sent.at(-1).line, 3);
  delete include.dataset.editableInclude;
  content.dblclick({ target });
  assert.equal(app.sent.at(-1).line, undefined);
});
