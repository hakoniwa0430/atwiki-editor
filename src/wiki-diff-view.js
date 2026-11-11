'use strict';
const { syncState } = require('./wiki-api');

const labels = {
  local: 'ローカルに変更',
  remote: '本家に変更',
  conflict: '双方に変更',
  equal: '変更なし',
  missing: 'ローカル未取得',
  unavailable: '本家の一覧にありません',
  error: '確認失敗',
};
const icons = {
  local: 'edit',
  remote: 'cloud-download',
  conflict: 'warning',
  equal: 'check',
  missing: 'cloud',
  unavailable: 'question',
  error: 'error',
};

function registerWikiDiffView(vscode, context, services) {
  const { api, store, allPages, connectionKey, readSaved, diff } = services;
  const changed = new vscode.EventEmitter();
  let roots = [],
    disposed = false,
    generation = 0,
    localTimer;
  async function classify(row) {
    if (!row.remote) return;
    if (!row.uri) {
      row.state = 'missing';
      return;
    }
    try {
      const doc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.toString() === row.uri.toString(),
      );
      const local = doc ? doc.getText() : await readSaved(row.uri.fsPath);
      // VS Code normalizes both CRLF and lone CR when opening a file.
      const normalize = (text) => text.replace(/\r\n?/g, '\n');
      row.state = syncState(
        normalize(row.base.source),
        normalize(local),
        normalize(row.remote.source),
      );
      row.error = undefined;
    } catch (error) {
      row.state = error.code === 'ENOENT' ? 'missing' : 'error';
      row.error = error.code === 'ENOENT' ? undefined : error.message;
    }
  }
  const visibleChildren = (node) => (node.children || []).filter((row) => row.state !== 'equal');
  const provider = {
    onDidChangeTreeData: changed.event,
    getChildren: (node) => (node ? visibleChildren(node) : roots),
    getTreeItem(node) {
      const item = new vscode.TreeItem(
        node.label,
        node.children
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
      );
      item.description = node.children
        ? (node.description ??
          (visibleChildren(node).length ? `${visibleChildren(node).length}件` : '差分なし'))
        : labels[node.state];
      item.tooltip =
        node.error ||
        [
          node.label,
          labels[node.state],
          node.uri?.fsPath,
          node.remote?.updated_at && `本家の更新: ${node.remote.updated_at}`,
        ]
          .filter(Boolean)
          .join('\n');
      item.iconPath = new vscode.ThemeIcon(node.children ? 'globe' : icons[node.state] || 'info');
      if (node.remote)
        item.command = {
          command: 'atwiki.openWikiDifference',
          title: '差分を開く',
          arguments: [node],
        };
      return item;
    },
  };
  const view = vscode.window.createTreeView('atwiki.differences', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  view.message = undefined;
  async function refresh() {
    if (disposed || vscode.workspace.isTrusted === false) return;
    const run = ++generation;
    const next = [];
    try {
      const entries = await store.entries();
      for (const folder of vscode.workspace.workspaceFolders || []) {
        if (folder.uri.scheme !== 'file') continue;
        const root = { label: folder.name, children: [] };
        next.push(root);
        try {
          const key = connectionKey(folder.uri.fsPath);
          if (!(await context.secrets.get(key))) {
            root.description = '未接続';
            continue;
          }
          let config = await api.session(key);
          const wiki = config.wiki;
          root.label = `${folder.name} / ${wiki}`;
          const linked = entries.filter(
            (entry) =>
              entry.wiki === wiki &&
              vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(entry.uri))?.uri.toString() ===
                folder.uri.toString(),
          );
          const pages = await allPages(config);
          const ids = new Set(pages.map((page) => page.pageid));
          for (const page of pages) {
            if (disposed || run !== generation) return;
            const matches = linked.filter((entry) => entry.page.pageid === page.pageid);
            let remote, error;
            try {
              config = await api.session(key);
              if (config.wiki !== wiki) throw Error('接続先が変更されました。再更新してください。');
              remote = await api.page(config, page.pageid);
            } catch (failure) {
              error = failure.message;
            }
            for (const entry of matches.length ? matches : [undefined]) {
              const row = {
                key,
                wiki,
                pageid: page.pageid,
                label: page.pagename,
                remote,
                base: entry?.page,
                uri: entry && vscode.Uri.parse(entry.uri),
                state: 'error',
                error,
              };
              if (remote) await classify(row);
              root.children.push(row);
            }
          }
          for (const entry of linked.filter((entry) => !ids.has(entry.page.pageid))) {
            root.children.push({
              label: entry.page.pagename,
              uri: vscode.Uri.parse(entry.uri),
              state: 'unavailable',
            });
          }
          const order = ['error', 'conflict', 'remote', 'local', 'missing', 'unavailable', 'equal'];
          root.children.sort(
            (a, b) =>
              order.indexOf(a.state) - order.indexOf(b.state) ||
              a.label.localeCompare(b.label, 'ja'),
          );
        } catch (error) {
          root.description = '確認失敗';
          root.children.push({ label: error.message, state: 'error', error: error.message });
        }
      }
      if (disposed || run !== generation) return;
      roots = next;
      view.message = `確認終了: ${new Date().toLocaleString('ja-JP')}`;
    } catch (error) {
      if (disposed || run !== generation) return;
      roots = [{ label: error.message, state: 'error', error: error.message }];
      view.message = `確認終了: ${new Date().toLocaleString('ja-JP')}`;
    }
    if (!disposed) changed.fire();
  }
  context.subscriptions.push(
    changed,
    view,
    view.onDidChangeVisibility(({ visible }) => {
      if (visible) return refresh();
    }),
    vscode.commands.registerCommand('atwiki.openWikiDifference', async (row) => {
      if (
        vscode.workspace.isTrusted === false ||
        !roots.some((root) => root.children?.includes(row))
      )
        return;
      try {
        const run = generation;
        const config = await api.session(row.key);
        if (config.wiki !== row.wiki) throw Error('接続先が変更されました。再更新してください。');
        const remote = await api.page(config, row.pageid);
        if (disposed || run !== generation) return;
        row.remote = remote;
        await classify(row);
        changed.fire();
        if (row.uri && row.state !== 'missing') {
          const doc = await vscode.workspace.openTextDocument(row.uri);
          await diff(doc, row.remote.source, `${row.label}: 本家（最新取得） ↔ ローカル`);
        } else {
          await diff({}, row.remote.source, `${row.label}: 本家（最新取得） ↔ ローカル未取得`, '');
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`差分を開けませんでした: ${error.message}`);
      }
    }),
  );
  if (vscode.window.onDidChangeWindowState) {
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState(({ focused }) => {
        if (focused && view.visible) return refresh();
      }),
    );
  }
  const localChanged = () => {
    clearTimeout(localTimer);
    localTimer = setTimeout(async () => {
      const rows = roots.flatMap((root) => root.children || []);
      await Promise.all(rows.map(classify));
      if (!disposed) changed.fire();
    }, 250);
  };
  for (const event of [
    'onDidChangeTextDocument',
    'onDidSaveTextDocument',
    'onDidCloseTextDocument',
  ]) {
    if (vscode.workspace[event]) context.subscriptions.push(vscode.workspace[event](localChanged));
  }
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{atwiki,atw,txt}');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(localChanged),
    watcher.onDidChange(localChanged),
    watcher.onDidDelete(localChanged),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      generation++;
      roots = [];
      changed.fire();
      view.message = undefined;
    }),
  );
  context.subscriptions.push({
    dispose() {
      disposed = true;
      generation++;
      clearTimeout(localTimer);
    },
  });
  if (view.visible) void refresh();
  return {
    refresh,
    provider,
    clear() {
      generation++;
      roots = [];
      changed.fire();
      view.message = undefined;
    },
  };
}
module.exports = { registerWikiDiffView };
