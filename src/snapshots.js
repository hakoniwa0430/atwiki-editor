'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class SnapshotStore {
  constructor(root) {
    this.root = root;
  }
  key(uri) {
    return crypto.createHash('sha256').update(uri).digest('hex');
  }
  file(key, id) {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9-]{36}$/.test(id))
      throw new Error('保存状態のIDが不正です');
    return path.join(this.root, key, `${id}.json`);
  }
  async save(uri, text, label) {
    const key = this.key(uri),
      id = crypto.randomUUID();
    const entry = { id, uri, text, label, created: new Date().toISOString() };
    const file = this.file(key, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(entry), { encoding: 'utf8', flag: 'wx' });
    return entry;
  }
  async read(key, id) {
    const entry = JSON.parse(await fs.readFile(this.file(key, id), 'utf8'));
    if (
      entry.id !== id ||
      typeof entry.uri !== 'string' ||
      this.key(entry.uri) !== key ||
      typeof entry.text !== 'string' ||
      typeof entry.label !== 'string' ||
      !Number.isFinite(Date.parse(entry.created))
    )
      throw new Error('保存状態のデータが不正です');
    return entry;
  }
  async list(uri) {
    const key = this.key(uri);
    let names;
    try {
      names = await fs.readdir(path.join(this.root, key));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const entries = await Promise.all(
      names
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map((name) => this.read(key, name.slice(0, -5))),
    );
    return entries.sort((a, b) => b.created.localeCompare(a.created));
  }
}

class DirectorySnapshotStore {
  directory(file) {
    return path.join(path.dirname(file), '.atwiki-history', path.basename(file));
  }
  async save(file, text) {
    const created = new Date().toISOString();
    const folder = created.replace(/:/g, '-') + '_' + crypto.randomUUID();
    const target = path.join(this.directory(file), folder, path.basename(file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
    return { file: target, created, label: created };
  }
  async list(file) {
    let names;
    try {
      names = await fs.readdir(this.directory(file), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return names
      .filter((n) => n.isDirectory() && /^\d{4}-\d{2}-\d{2}T[\d.-]+Z_[a-f0-9-]{36}$/.test(n.name))
      .map((n) => ({
        file: path.join(this.directory(file), n.name, path.basename(file)),
        created: n.name.slice(0, 24).replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3'),
        label: n.name.slice(0, 24),
      }))
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  async read(file) {
    const version = path.dirname(file),
      group = path.dirname(version);
    if (
      !path.isAbsolute(file) ||
      path.basename(path.dirname(group)) !== '.atwiki-history' ||
      path.basename(group) !== path.basename(file) ||
      !/^\d{4}-\d{2}-\d{2}T[\d.-]+Z_[a-f0-9-]{36}$/.test(path.basename(version))
    )
      throw new Error('履歴ファイルの場所が不正です');
    return fs.readFile(file, 'utf8');
  }
}

function registerSnapshots(vscode, context) {
  const legacy = new SnapshotStore(path.join(context.globalStorageUri.fsPath, 'snapshots'));
  const store = new DirectorySnapshotStore(),
    scheme = 'atwiki-snapshot';
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      async provideTextDocumentContent(uri) {
        const local = uri.path.match(/^\/local\/([A-Za-z0-9_-]+)\.atwiki$/);
        if (local) return store.read(Buffer.from(local[1], 'base64url').toString('utf8'));
        const match = uri.path.match(/^\/([a-f0-9]{64})\/([a-f0-9-]{36})\.atwiki$/);
        if (!match) throw new Error('保存状態のURIが不正です');
        return (await legacy.read(match[1], match[2])).text;
      },
    }),
  );
  const actions = {};
  function command(name, action) {
    const run = async (target) => {
      const document =
        typeof target?.getText === 'function' ? target : vscode.window.activeTextEditor?.document;
      if (
        !document ||
        document.isUntitled ||
        document.uri.scheme !== 'file' ||
        document.fileName.split(/[\\/]/).includes('.atwiki-history')
      ) {
        vscode.window.showInformationMessage(
          '名前を付けて保存した比較対象のファイルを開いてください。',
        );
        return;
      }
      try {
        await action(document);
      } catch (error) {
        vscode.window.showErrorMessage(`アットウィキの保存状態を処理できません: ${error.message}`);
      }
    };
    actions[name] = run;
    context.subscriptions.push(vscode.commands.registerCommand('atwiki.' + name, run));
  }
  command('saveSnapshot', async (document) => {
    await store.save(document.fileName, document.getText());
    vscode.window.showInformationMessage('現在の状態を .atwiki-history に保存しました。');
  });
  async function history(document) {
    return [
      ...(await store.list(document.fileName)),
      ...(await legacy.list(document.uri.toString())),
    ].sort((a, b) => b.created.localeCompare(a.created));
  }
  async function chooseHistory(entries, options) {
    const items = entries.map((entry) => ({
      label: entry.label || new Date(entry.created).toLocaleString(),
      description: entry.file ? '保存元フォルダ' : '旧バージョンの履歴',
      entry,
    }));
    return (await vscode.window.showQuickPick(items, options))?.entry;
  }
  async function compare(document, select) {
    const entries = await history(document);
    if (!entries.length) {
      vscode.window.showInformationMessage(
        '保存状態がありません。「状態を保存」を実行してください。',
      );
      return;
    }
    let entry = entries[0];
    if (select) {
      const choice = await chooseHistory(entries, { title: '比較する保存状態を選択' });
      if (!choice) return;
      entry = choice;
    }
    const savedPath = entry.file
      ? `/local/${Buffer.from(entry.file).toString('base64url')}.atwiki`
      : `/${legacy.key(document.uri.toString())}/${entry.id}.atwiki`;
    const before = vscode.Uri.from({ scheme, path: savedPath });
    await vscode.commands.executeCommand(
      'vscode.diff',
      before,
      document.uri,
      `${path.basename(document.fileName)} — ${entry.label || entry.created} ↔ 現在`,
      { preview: false },
    );
  }
  command('compareSnapshot', (document) => compare(document, false));
  command('selectSnapshot', (document) => compare(document, true));
  const restoring = new Set();
  command('restoreSnapshot', async (document) => {
    const key = document.uri.toString();
    if (restoring.has(key)) return;
    restoring.add(key);
    try {
      const entries = await history(document);
      if (!entries.length) {
        vscode.window.showInformationMessage('復元できる保存状態がありません。');
        return;
      }
      const choice = await chooseHistory(entries, {
        title: '復元する保存状態を選択',
        placeHolder:
          '選択した内容でファイルを復元・保存します。現在の編集内容は自動で履歴に残します。',
      });
      if (!choice) return;
      const entry = choice;
      const text = entry.file
        ? await store.read(entry.file)
        : (await legacy.read(legacy.key(key), entry.id)).text;
      const editor = await vscode.window.showTextDocument(document);
      const before = document.getText(),
        version = document.version;
      await store.save(document.fileName, before);
      if (document.isClosed || document.version !== version)
        throw new Error('復元準備中に内容が変更されたため中止しました。もう一度実行してください。');
      const range = new vscode.Range(document.positionAt(0), document.positionAt(before.length));
      const applied = await editor.edit((edit) => edit.replace(range, text), {
        undoStopBefore: true,
        undoStopAfter: true,
      });
      if (!applied)
        throw new Error('編集内容を復元できませんでした。復元前の内容は履歴に残っています。');
      if (!(await document.save()))
        throw new Error(
          'エディターには復元しましたが、ファイルの保存に失敗しました。権限などを確認して保存してください。',
        );
      vscode.window.showInformationMessage(
        '選択した履歴からファイルを復元しました。復元前の内容も .atwiki-history に保存しました。',
      );
    } finally {
      restoring.delete(key);
    }
  });
  return actions;
}

module.exports = { SnapshotStore, DirectorySnapshotStore, registerSnapshots };
