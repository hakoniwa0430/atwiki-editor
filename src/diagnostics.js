'use strict';
const { pageNameFromFile, filePageRoot } = require('./page-context');
const { createPayload } = require('./preview-data');
function registerDiagnostics(vscode, context, index, roots) {
  if (!vscode.languages.createDiagnosticCollection) return;
  const collection = vscode.languages.createDiagnosticCollection('atwiki');
  const states = new Map();
  let disposed = false;
  function close(document) {
    const key = document.uri.toString(),
      state = states.get(key);
    if (state) {
      state.closed = true;
      clearTimeout(state.timer);
      state.release();
      states.delete(key);
    }
    collection.delete(document.uri);
  }
  function update(document) {
    if (disposed || document.isClosed) return;
    if (
      document.uri.scheme !== 'file' ||
      !['atwiki', 'plaintext'].includes(document.languageId) ||
      (document.languageId === 'plaintext' && !/\.txt$/i.test(document.fileName))
    ) {
      close(document);
      return;
    }
    const key = document.uri.toString();
    const root = filePageRoot(vscode, document, roots);
    let state = states.get(key);
    if (state && state.root !== root) {
      close(document);
      state = null;
    }
    if (!state) {
      state = { root, generation: 0, closed: false };
      state.release = index.retain(root, () => {
        if (!disposed && !state.closed) update(document);
      });
      states.set(key, state);
    }
    clearTimeout(state.timer);
    const generation = ++state.generation;
    state.timer = setTimeout(async () => {
      try {
        const result = await createPayload({
          vscode,
          document,
          root: vscode.Uri.file(root),
          pageName: pageNameFromFile(root, document.fileName),
          panel: { webview: { asWebviewUri: (uri) => uri } },
          config: () => {
            const config = vscode.workspace.getConfiguration('atwiki.preview', document.uri);
            return {
              get: (name, fallback) =>
                name === 'allowExternalFeeds' ? false : config.get(name, fallback),
            };
          },
          mode: () => '',
          index,
          loadScripts: require('./local-pages').loadScripts,
        })();
        if (disposed || state.closed || generation !== state.generation) return;
        collection.set(
          document.uri,
          result.diagnostics
            .filter((d) => !d.page && d.line >= 0 && d.line < document.lineCount)
            .map(
              (d) =>
                new vscode.Diagnostic(
                  new vscode.Range(d.line, 0, d.line, document.lineAt(d.line).text.length),
                  d.message,
                  vscode.DiagnosticSeverity.Warning,
                ),
            ),
        );
      } catch {
        if (!disposed && !state.closed && generation === state.generation)
          collection.delete(document.uri);
      }
    }, 200);
  }
  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidChangeTextDocument((e) => update(e.document)),
    vscode.workspace.onDidCloseTextDocument(close),
    {
      dispose() {
        disposed = true;
        for (const state of states.values()) {
          clearTimeout(state.timer);
          state.release();
        }
        states.clear();
      },
    },
  );
  for (const document of vscode.workspace.textDocuments || []) update(document);
}
module.exports = { registerDiagnostics };
