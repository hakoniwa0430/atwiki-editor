'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(localPages) {
  const listeners = {},
    panels = [],
    external = [],
    opened = [],
    commands = {};
  const uri = (path) => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` });
  const doc = {
    uri: uri('/wiki/test.atwiki'),
    fileName: '/wiki/test.atwiki',
    isUntitled: false,
    lineCount: 5,
    text: '*Initial',
    getText() {
      return this.text;
    },
  };
  const editor = { document: doc, viewColumn: 1 };
  const disposable = { dispose() {} };
  const on = (name) => (cb) => {
    listeners[name] = cb;
    return disposable;
  };
  const api = {
    languages: {
      registerCompletionItemProvider: () => disposable,
      registerHoverProvider: () => disposable,
    },
    Uri: {
      joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)),
      parse: (value) => value,
      file: (value) => uri(value),
    },
    ViewColumn: { One: 1, Beside: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class {},
    Selection: class {},
    commands: {
      registerCommand(name, cb) {
        commands[name] = cb;
        return disposable;
      },
      executeCommand: (name, ...args) => commands[name](...args),
    },
    env: { openExternal: async (value) => external.push(value) },
    workspace: {
      registerTextDocumentContentProvider: () => disposable,
      openTextDocument: async (uri) => ({
        uri,
        fileName: uri.fsPath,
        isUntitled: false,
        lineCount: 1,
        getText: () => '*Target [#場所]',
      }),
      getConfiguration: () => ({ get: (key, fallback) => (key === 'updateDelay' ? 0 : fallback) }),
      onDidChangeTextDocument: on('change'),
      onDidChangeConfiguration: on('config'),
    },
    window: {
      activeTextEditor: editor,
      showInformationMessage() {},
      onDidChangeTextEditorVisibleRanges: on('scroll'),
      async showTextDocument(document) {
        opened.push(document);
        api.window.activeTextEditor = { document, viewColumn: 1 };
        return { revealRange() {} };
      },
      createWebviewPanel(type, title, column, options) {
        const panel = {
          options,
          title,
          messages: [],
          reveals: 0,
          reveal() {
            this.reveals++;
          },
          onDidDispose(cb) {
            this.close = cb;
            return disposable;
          },
          dispose() {
            this.close();
          },
          webview: {
            cspSource: 'https://webview.local',
            asWebviewUri: (value) => ({ toString: () => `https://webview.local${value.path}` }),
            postMessage(message) {
              panel.messages.push(message);
            },
            onDidReceiveMessage(cb) {
              panel.receive = cb;
              return disposable;
            },
          },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync('src/extension.js', 'utf8'),
    {
      require: (name) =>
        name === 'vscode'
          ? api
          : name === './local-pages' && localPages
            ? localPages
            : name.startsWith('./')
              ? require('../src/' + name.slice(2))
              : require(name),
      module,
      setTimeout,
      clearTimeout,
    },
    { filename: 'extension.js' },
  );
  const context = {
    extensionUri: uri('/extension'),
    globalStorageUri: { fsPath: '/extension-storage' },
    subscriptions: [],
    workspaceState: {
      values: new Map(),
      get(key, fallback) {
        return this.values.get(key) ?? fallback;
      },
      async update(key, value) {
        this.values.set(key, value);
      },
    },
  };
  module.exports.activate(context);
  return {
    api,
    context,
    doc,
    panels,
    listeners,
    external,
    opened,
    open: commands['atwiki.openPreview'],
  };
}

test('region preferences survive closing and reopening the document preview', async () => {
  const app = setup();
  app.open();
  await app.panels[0].receive({ type: 'remember', id: 'region:1', open: true });
  await app.panels[0].receive({ type: 'remember', id: 'region:2', open: false });
  app.panels[0].dispose();
  app.open();
  await app.panels[1].receive({ type: 'ready' });
  assert.deepEqual(app.panels[1].messages[0].remembered, { 'region:1': true, 'region:2': false });
});

test('virtual documents cannot start a local preview', () => {
  const app = setup();
  app.doc.uri.scheme = 'github';
  app.open();
  assert.equal(app.panels.length, 0);
});

test('page navigation failures are reported without rejecting the webview event', async () => {
  const app = setup({
    loadPages: async () => ({ pages: {}, images: [] }),
    loadScripts: async () => ({}),
    resolvePage: async () => {
      throw Error('navigation read failed');
    },
  });
  const errors = [];
  app.api.window.showErrorMessage = (message) => errors.push(message);
  app.open();
  await assert.doesNotReject(app.panels[0].receive({ type: 'page', page: 'Target' }));
  assert.match(errors[0], /navigation read failed/);
  app.panels[0].dispose();
  await app.panels[0].receive({ type: 'page', page: 'Target' });
  assert.equal(errors.length, 1);
});

test('preview handshake sends content and reuses the same document panel', async () => {
  const app = setup();
  app.open();
  app.open();
  assert.equal(app.panels.length, 1);
  const panel = app.panels[0];
  assert.equal(panel.reveals, 1);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.match(panel.webview.html, /script-src 'nonce-[a-f0-9]+'/);
  await panel.receive({ type: 'ready' });
  assert.match(panel.messages[0].html, /Initial/);
  const token = panel.webview.html.match(/name="atwiki-message-token" content="([a-f0-9]+)"/)[1];
  const nonce = panel.webview.html.match(/script-src 'nonce-([a-f0-9]+)'/)[1];
  assert.equal(panel.messages[0].token, token);
  assert.notEqual(token, nonce);
  assert.equal(panel.options.localResourceRoots[1].path, '/wiki');
});
test('unsaved edits update preview; disposed panels receive no pending edits', async () => {
  const app = setup();
  app.open();
  app.doc.text = '*Updated';
  app.listeners.change({ document: app.doc });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(app.panels[0].messages.at(-1).html, /Updated/);
  app.listeners.change({ document: app.doc });
  app.panels[0].dispose();
  const count = app.panels[0].messages.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.panels[0].messages.length, count);
  app.open();
  assert.equal(app.panels.length, 2);
});
test('permitted but missing image paths warn and unsafe paths do not render', async () => {
  const app = setup();
  app.doc.text =
    '#image(images/photo.png)\n#image(../private.png)\n#image(https://example.com/x.png)\n#image(C:\\secret.png)\n#image(test.svg)';
  app.open();
  await app.panels[0].receive({ type: 'ready' });
  const html = app.panels[0].messages[0].html;
  assert.equal((html.match(/<img /g) || []).length, 0);
  assert.match(app.panels[0].messages[0].warnings.join(), /photo.png/);
});
test('navigation messages validate line ranges and external schemes', async () => {
  const app = setup();
  app.open();
  const panel = app.panels[0];
  for (const line of [-1, 5, '1', 1.5]) await panel.receive({ type: 'reveal', line });
  assert.equal(app.opened.length, 0);
  await panel.receive({ type: 'reveal', line: 1 });
  assert.equal(app.opened.length, 1);
  for (const url of ['command:delete', 'javascript:alert(1)', 'file:///private'])
    await panel.receive({ type: 'external', url });
  assert.equal(app.external.length, 0);
  await panel.receive({ type: 'external', url: 'https://example.com' });
  assert.equal(app.external.length, 1);
});
test('visible source ranges are forwarded to the correct preview', () => {
  const app = setup();
  app.open();
  app.listeners.scroll({
    textEditor: { document: app.doc },
    visibleRanges: [{ start: { line: 3 } }],
  });
  assert.equal(app.panels[0].messages.at(-1).type, 'scroll');
  assert.equal(app.panels[0].messages.at(-1).line, 3);
});

test('nested page navigation retains the wiki root and delivers decoded anchor after rendering', async () => {
  const roots = [];
  const app = setup({
    loadPages: async () => ({ pages: {}, images: [] }),
    loadScripts: async () => ({}),
    resolvePage: async (root, name) => {
      roots.push(root);
      return { file: root + '/' + name + '.atwiki', root };
    },
  });
  app.open();
  await app.panels[0].receive({ type: 'page', page: 'ほげ/ふが#%E5%A0%B4%E6%89%80' });
  assert.equal(app.opened[0].fileName, '/wiki/ほげ/ふが.atwiki');
  await app.panels[1].receive({ type: 'ready' });
  assert.equal(app.panels[1].messages.at(-1).type, 'anchor');
  assert.equal(app.panels[1].messages.at(-1).anchor, '場所');
  assert.equal(app.panels[1].messages.at(-2).type, 'render');
  await app.panels[1].receive({ type: 'page', page: 'ほげ/次#場所' });
  assert.deepEqual(roots, ['/wiki', '/wiki']);
});

test('tree preferences survive closing and reopening with rendered keys', async () => {
  const app = setup();
  app.doc.text = '#treemenu(flag=ex,Item)';
  app.open();
  await app.panels[0].receive({ type: 'ready' });
  const key = app.panels[0].messages[0].html.match(/data-remember="([^"]+)"/)[1];
  await app.panels[0].receive({ type: 'remember', id: key, open: false });
  app.panels[0].dispose();
  app.open();
  await app.panels[1].receive({ type: 'ready' });
  assert.equal(app.panels[1].messages[0].remembered[key], false);
});

test('page row navigation selects only valid target rows', async () => {
  const app = setup({
    loadPages: async () => ({ pages: {}, images: [] }),
    loadScripts: async () => ({}),
    resolvePage: async (root, name) => ({ file: root + '/' + name + '.atwiki', root }),
  });
  const rows = [];
  app.api.Selection = class {
    constructor(position) {
      rows.push(position.line);
    }
  };
  app.open();
  for (const line of [-1, 1, '0', 0.5])
    await app.panels[0].receive({ type: 'page', page: '表ページ', line });
  assert.deepEqual(rows, []);
  await app.panels[0].receive({ type: 'page', page: '表ページ', line: 0 });
  assert.deepEqual(rows, [0]);
});
