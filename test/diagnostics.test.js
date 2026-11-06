'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerDiagnostics } = require('../src/diagnostics');
test('diagnostics run without a preview, refresh and cannot publish after closing', async () => {
  const listeners = {},
    published = new Map();
  let released = 0;
  const roots = new Map(),
    retained = [];
  const uri = {
    scheme: 'file',
    fsPath: '/wiki/page.atwiki',
    toString: () => 'file:///wiki/page.atwiki',
  };
  const document = {
    uri,
    fileName: uri.fsPath,
    languageId: 'atwiki',
    lineCount: 2,
    text: '本文\n#memo(rows=0)',
    getText() {
      return this.text;
    },
    lineAt(line) {
      return { text: this.text.split('\n')[line] };
    },
  };
  const disposable = { dispose() {} };
  const vscode = {
    Uri: { file: (fsPath) => ({ fsPath }), joinPath: (_, p) => ({ toString: () => p }) },
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri, values) => published.set(uri.toString(), values),
        delete: (uri) => published.delete(uri.toString()),
        dispose() {},
      }),
    },
    workspace: {
      textDocuments: [document],
      getConfiguration: () => ({ get: (_, fallback) => fallback }),
      onDidOpenTextDocument: (fn) => ((listeners.open = fn), disposable),
      onDidChangeTextDocument: (fn) => ((listeners.change = fn), disposable),
      onDidCloseTextDocument: (fn) => ((listeners.close = fn), disposable),
    },
    DiagnosticSeverity: { Warning: 1 },
    Range: class {
      constructor(line) {
        this.line = line;
      }
    },
    Diagnostic: class {
      constructor(range, message) {
        Object.assign(this, { range, message });
      }
    },
  };
  const context = { subscriptions: [] };
  registerDiagnostics(
    vscode,
    context,
    {
      retain: (root, callback) => {
        retained.push({ root, callback });
        return () => released++;
      },
      get: async () => ({ pages: {}, images: [] }),
    },
    roots,
  );
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(published.get(uri.toString())[0].range.line, 1);
  assert.match(published.get(uri.toString())[0].message, /rows/);
  document.text = '本文\n正常な文章';
  listeners.change({ document });
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.deepEqual(published.get(uri.toString()), []);
  roots.set(uri.toString(), { fsPath: '/different-root' });
  listeners.change({ document });
  assert.equal(released, 1);
  assert.equal(retained.at(-1).root, '/different-root');
  document.languageId = 'javascript';
  listeners.change({ document });
  assert.equal(published.size, 0);
  assert.equal(released, 2);
  document.languageId = 'atwiki';
  document.text = '本文\n#memo(rows=0)';
  listeners.change({ document });
  listeners.close(document);
  document.isClosed = true;
  retained.at(-1).callback();
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(published.size, 0);
  assert.equal(released, 3);
  for (const subscription of context.subscriptions) subscription.dispose();
  document.isClosed = false;
  retained.at(-1).callback();
  assert.equal(retained.length, 3);
});
