'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { WikiApi, wikiId, validatePage, syncState } = require('./wiki-api');
const { WikiOAuth, REDIRECT } = require('./wiki-oauth');

class SyncStore {
  constructor(root) {
    this.root = root;
    this.metadata = new Map();
  }
  readMetadata(uri) {
    if (!this.metadata.has(uri)) {
      const pending = this.read(uri)
        .then((entry) =>
          entry
            ? { wiki: entry.wiki, pageid: entry.page.pageid, pagename: entry.page.pagename }
            : undefined,
        )
        .catch(() => undefined);
      this.metadata.set(uri, pending);
    }
    return this.metadata.get(uri);
  }
  invalidateMetadata() {
    this.metadata.clear();
  }
  file(uri) {
    return path.join(this.root, crypto.createHash('sha256').update(uri).digest('hex') + '.json');
  }
  async read(uri) {
    try {
      const entry = JSON.parse(await fs.readFile(this.file(uri), 'utf8'));
      if (
        entry.uri !== uri ||
        typeof entry.wiki !== 'string' ||
        wikiId(`https://w.atwiki.jp/${entry.wiki}/`) !== entry.wiki
      )
        throw Error('同期情報が不正です。');
      validatePage(entry.page);
      return entry;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async save(uri, wiki, page) {
    validatePage(page);
    await fs.mkdir(this.root, { recursive: true });
    const file = this.file(uri),
      temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(
      temp,
      JSON.stringify({ uri, wiki, page, syncedAt: new Date().toISOString() }),
      { encoding: 'utf8', flag: 'wx' },
    );
    await fs.rename(temp, file);
    this.metadata.delete(uri);
  }
}

function pageFileName(name) {
  name = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name + '.atwiki';
}

function connectionKey(root) {
  let normalized = path.resolve(root);
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return 'atwiki.oauth.folder.' + crypto.createHash('sha256').update(normalized).digest('hex');
}

function registerWikiSync(vscode, context, dependencies = {}) {
  const oauth = new WikiOAuth(vscode, context);
  const api = dependencies.api || new WikiApi(context.secrets);
  const store =
    dependencies.store || new SyncStore(path.join(context.globalStorageUri.fsPath, 'wiki-sync'));
  const readSaved = dependencies.readSaved || ((file) => fs.readFile(file, 'utf8'));
  const syncImages = dependencies.syncImages || require('./wiki-images').syncImages;
  const views = new Map();
  const pendingPulls = new Map();
  if (vscode.workspace.onDidSaveTextDocument)
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        const pending = pendingPulls.get(doc);
        if (!pending) return;
        pendingPulls.delete(doc);
        try {
          if ((await readSaved(doc.fileName)) === pending.remote.source)
            await store.save(doc.uri.toString(), pending.wiki, pending.remote);
        } catch (error) {
          notify('Error', `同期基準の保存に失敗しました: ${error.message}`);
        }
      }),
    );
  const status = vscode.window.createStatusBarItem?.(vscode.StatusBarAlignment?.Left, 10);
  if (status) {
    status.name = 'アットウィキ連携の結果';
    status.command = 'atwiki.showSyncResult';
    status.text = '$(cloud) アットウィキ: 同期・投稿待機中';
    status.tooltip = '同期・投稿の結果をここに表示します。';
    status.show();
    context.subscriptions.push(status);
  }
  let lastResult;
  function notify(kind, message) {
    lastResult = { kind, message };
    if (status) {
      const icon = { Information: 'check', Warning: 'warning', Error: 'error' }[kind];
      status.text = `$(${icon}) アットウィキ: ${message.split('\n')[0].slice(0, 55)}`;
      status.tooltip = message + '\nクリックして結果を再表示';
      status.show();
    }
    void vscode.window[`show${kind}Message`](message);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('atwiki.showSyncResult', () => {
      if (lastResult) notify(lastResult.kind, lastResult.message);
      else
        void vscode.window.showInformationMessage(
          busy ? 'アットウィキ連携の処理中です。' : '同期・投稿の結果はまだありません。',
        );
    }),
  );
  let busy = false;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('atwiki-remote', {
      provideTextDocumentContent(uri) {
        return views.get(uri.toString()) || '';
      },
    }),
  );
  if (vscode.workspace.onDidCloseTextDocument)
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        views.delete(doc.uri.toString());
        pendingPulls.delete(doc);
      }),
    );
  context.subscriptions.push({
    dispose() {
      views.clear();
      pendingPulls.clear();
    },
  });
  const actions = {};
  function command(name, action) {
    const run = async (...args) => {
      if (vscode.workspace.isTrusted === false) {
        vscode.window.showErrorMessage('Wiki連携にはワークスペースの信頼が必要です。');
        return;
      }
      if (busy) {
        vscode.window.showInformationMessage('Wiki連携の処理が進行中です。');
        return;
      }
      busy = true;
      const label =
        {
          downloadWikiPage: '全ページ同期',
          pullWikiPage: '全ページ同期',
          pullCurrentWikiPage: '現在のページの同期',
          publishWikiPage: '投稿',
          updateWikiPage: '投稿',
          createWikiPage: 'ページ追加',
        }[name] || 'Wiki連携';
      const previousResult = lastResult;
      if (status) {
        status.text = `$(sync~spin) アットウィキ: ${label}中…`;
        status.tooltip = `${label}を実行しています。`;
        status.show();
      }
      try {
        await action(...args);
      } catch (error) {
        notify('Error', `${label}に失敗しました: ${error.message}`);
      } finally {
        busy = false;
        if (status && lastResult === previousResult) {
          status.text = '$(info) アットウィキ: 処理終了';
          status.tooltip = '処理が終了しました。クリックして直近の結果を確認できます。';
        }
      }
    };
    actions[name] = run;
    context.subscriptions.push(vscode.commands.registerCommand('atwiki.' + name, run));
  }
  const input = (prompt, password = false) =>
    vscode.window.showInputBox({ prompt, password, ignoreFocusOut: true });
  function document(doc = vscode.window.activeTextEditor?.document) {
    if (
      !doc ||
      doc.isUntitled ||
      doc.uri.scheme !== 'file' ||
      !/\.(atwiki|atw|txt)$/i.test(doc.fileName) ||
      doc.fileName.split(/[\\/]/).includes('.atwiki-history')
    )
      throw Error('保存済みの .atwiki / .atw / .txt ファイルを開いてください。');
    return doc;
  }
  async function linked(doc, config) {
    const entry = await store.read(doc.uri.toString());
    if (!entry)
      throw Error('このファイルは未接続です。「Wikiの全ページを取得・同期」を実行してください。');
    if (entry.wiki !== config.wiki)
      throw Error(`このファイルの接続先は ${entry.wiki} です。そのWikiに接続し直してください。`);
    return entry;
  }
  async function diff(doc, text, title, savedText) {
    const uri = vscode.Uri.parse(`atwiki-remote:/${crypto.randomUUID()}.atwiki`);
    views.set(uri.toString(), text);
    let right = doc.uri;
    if (savedText !== undefined) {
      right = vscode.Uri.parse(`atwiki-remote:/${crypto.randomUUID()}/saved.atwiki`);
      views.set(right.toString(), savedText);
    }
    await vscode.commands.executeCommand('vscode.diff', uri, right, title);
  }
  function unchanged(doc, text, version) {
    if (doc.isClosed || doc.version !== version || doc.getText() !== text)
      throw Error('処理中にローカル本文が変更されました。もう一度実行してください。');
  }
  async function replace(doc, text, before, version) {
    unchanged(doc, before, version);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(before.length)), text);
    if (!(await vscode.workspace.applyEdit(edit))) throw Error('本文を置換できませんでした。');
    // Leave the change in the editor: the user can undo it or save it normally.
  }
  command('connectWiki', async (uri) => {
    const root = await workspaceRoot(uri);
    if (!root) return;
    const key = connectionKey(root);
    const legacy = await context.secrets.get('atwiki.oauth');
    if (legacy && !(await context.secrets.get(key))) {
      const old = JSON.parse(legacy);
      const choice = await vscode.window.showInformationMessage(
        `${root} に以前の接続先 ${old.wiki} を引き継ぎますか？`,
        { modal: true },
        '以前の接続を引き継ぐ',
        '別のWikiに接続',
      );
      if (!choice) return;
      if (choice === '以前の接続を引き継ぐ') {
        await context.secrets.store(key, legacy);
        await context.secrets.delete('atwiki.oauth');
        vscode.window.showInformationMessage(`${root}: ${old.wiki} に接続しました。`);
        return;
      }
    }
    const value = await input(
      `${root} の接続先Wikiの個別名またはURL（例: sample / https://w.atwiki.jp/sample/）`,
    );
    if (!value) return;
    const wiki = wikiId(value.trim());
    const clientId = await input('OAuth アプリ管理で発行された client_id');
    if (!clientId) return;
    const clientSecret = await input('OAuth アプリ管理で発行された client_secret', true);
    if (!clientSecret) return;
    const config = {
      wiki,
      clientId: clientId.trim(),
      clientSecret,
      redirect: REDIRECT,
    };
    const result = await oauth.login(config);
    if (!result) return;
    const { code, pending } = result;
    const session = await api.token(config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirect,
      code_verifier: pending.verifier,
    });
    const identity = await api.call(session, '/whoami');
    if (
      identity.wikiid !== wiki ||
      !Array.isArray(identity.scopes) ||
      !['user:read', 'wiki:read', 'wiki:write'].every((scope) => identity.scopes?.includes(scope))
    )
      throw Error(
        'Wikiまたは権限が一致しません。user:read / wiki:read / wiki:write を登録してください。',
      );
    await context.secrets.store(key, JSON.stringify(session));
    vscode.window.showInformationMessage(`${root}: ${wiki} に接続しました。`);
  });
  command('disconnectWiki', async (uri) => {
    const root = await workspaceRoot(uri);
    if (!root) return;
    await context.secrets.delete(connectionKey(root));
    vscode.window.showInformationMessage(
      `${root} の接続情報を削除しました。認可の失効はWikiのOAuth アプリ管理で行えます。ローカル本文・履歴は残ります。`,
    );
  });
  async function workspaceRoot(uri = vscode.window.activeTextEditor?.document.uri) {
    const folders = (vscode.workspace.workspaceFolders || []).filter(
      (f) => f.uri.scheme === 'file',
    );
    const selected = uri && vscode.workspace.getWorkspaceFolder?.(uri);
    if (selected?.uri.scheme === 'file') return selected.uri.fsPath;
    if (folders.length === 1) return folders[0].uri.fsPath;
    if (!folders.length) throw Error('保存先となるローカルフォルダをVS Codeで開いてください。');
    const picked = await vscode.window.showQuickPick(
      folders.map((f) => ({
        label: f.name || path.basename(f.uri.fsPath),
        description: f.uri.fsPath,
        folder: f,
      })),
      { placeHolder: '操作するWikiのフォルダを選択' },
    );
    return picked?.folder.uri.fsPath;
  }
  function documentSession(doc) {
    const root =
      vscode.workspace.getWorkspaceFolder?.(doc.uri)?.uri.fsPath || path.dirname(doc.fileName);
    return api.session(connectionKey(root));
  }
  async function allPages(config) {
    const pages = [],
      cursors = new Set(),
      ids = new Set();
    let cursor;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const result = await api.call(config, '/pages?' + query);
      if (
        !Array.isArray(result.items) ||
        !(
          result.next_cursor === null ||
          (typeof result.next_cursor === 'string' && result.next_cursor)
        )
      )
        throw Error('ページ一覧の形式が不正です。');
      for (const item of result.items) {
        if (
          !Number.isSafeInteger(item.pageid) ||
          item.pageid < 1 ||
          typeof item.pagename !== 'string'
        )
          throw Error('ページ一覧の形式が不正です。');
        if (!ids.has(item.pageid)) pages.push(item);
        ids.add(item.pageid);
      }
      cursor = result.next_cursor;
      if (cursor && cursors.has(cursor)) throw Error('ページ一覧のカーソルが繰り返されています。');
      cursors.add(cursor);
    } while (cursor);
    return pages;
  }
  async function pullWiki() {
    const root = await workspaceRoot();
    if (!root) return;
    let config = await api.session(connectionKey(root));
    const wiki = config.wiki;
    const pages = await allPages(config);
    let updated = 0,
      kept = 0;
    let imageUpdated = 0,
      imageKept = 0;
    const imageProblems = [];
    const problems = [];
    for (const item of pages) {
      try {
        config = await api.session(connectionKey(root));
        if (config.wiki !== wiki) throw Error('接続先Wikiが変更されました。再同期してください。');
        const remote = await api.page(config, item.pageid);
        let name = remote.pagename
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/[. ]+$/g, '')
          .slice(0, 100);
        if (!name || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = '_' + name;
        const uri = vscode.Uri.file(path.join(root, name + '.atwiki'));
        const existing = await store.read(uri.toString());
        if (existing && existing.wiki !== config.wiki)
          throw Error(
            `このファイルは ${existing.wiki} に接続済みです。別の保存先フォルダを使用してください。`,
          );
        let exists = false;
        try {
          const stat = await fs.lstat(uri.fsPath);
          if (!stat.isFile() || stat.isSymbolicLink())
            throw Error('保存先が通常のファイルではありません。');
          exists = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        const before = exists ? await fs.readFile(uri.fsPath, 'utf8') : undefined;
        if (before !== remote.source) {
          await fs.writeFile(uri.fsPath, remote.source, {
            encoding: 'utf8',
            flag: exists ? 'w' : 'wx',
          });
          updated++;
        } else kept++;
        await store.save(uri.toString(), config.wiki, remote);
        try {
          const images = await syncImages(root, config.wiki, remote, name, pages);
          imageUpdated += images.updated;
          imageKept += images.kept;
          imageProblems.push(...images.problems.map((message) => `${remote.pagename}: ${message}`));
        } catch (error) {
          imageProblems.push(`${remote.pagename}: ${error.message}`);
        }
      } catch (error) {
        problems.push(`${item.pagename}: ${error.message}`);
      }
    }
    const message = `${config.wiki}: ${problems.length || imageProblems.length ? '同期終了（一部失敗）' : '同期完了'}。全${pages.length}ページを確認、${updated}件取得・更新、${kept}件維持、${problems.length}件未更新。画像: ${imageUpdated}件取得・更新、${imageKept}件維持、${imageProblems.length}件取得エラー。`;
    if (problems.length || imageProblems.length)
      notify('Warning', message + '\n' + [...problems, ...imageProblems].join('\n'));
    else notify('Information', message);
  }
  command('downloadWikiPage', pullWiki);
  command('pullWikiPage', pullWiki);
  command('createWikiPage', async () => {
    const root = await workspaceRoot();
    if (!root) return;
    const config = await api.session(connectionKey(root));
    const name = await vscode.window.showInputBox({
      prompt: '追加するページ名（空のページをWikiのデフォルト権限で作成）',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'ページ名を入力してください。'),
    });
    if (!name?.trim()) return;
    const uri = vscode.Uri.file(path.join(root, pageFileName(name.trim())));
    try {
      await fs.lstat(uri.fsPath);
      throw Error('同名のローカルファイルが存在します。別のページ名を指定してください。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const remote = await api.create(config, name.trim());
    try {
      await fs.writeFile(uri.fsPath, remote.source, { encoding: 'utf8', flag: 'wx' });
      await store.save(uri.toString(), config.wiki, remote);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    } catch (error) {
      notify(
        'Warning',
        `「${remote.pagename}」は本家に作成済みですが、ローカルでの保存・編集開始に失敗しました。再作成せず同期してください: ${error.message}`,
      );
      return;
    }
    notify('Information', `${remote.pagename}: ページ追加完了。`);
  });
  command('compareWikiPage', async () => {
    const doc = document(),
      config = await documentSession(doc),
      entry = await linked(doc, config);
    const remote = await api.page(config, entry.page.pageid);
    const state = syncState(entry.page.source, doc.getText(), remote.source);
    const labels = {
      equal: '変更なし',
      local: 'ローカルに変更あり',
      remote: '本家に変更あり',
      conflict: '双方に変更あり・要確認',
    };
    await diff(
      doc,
      remote.source,
      `${remote.pagename}: Wikiの最新更新${remote.updated_at ? `（${remote.updated_at}）` : ''} ↔ ローカル（${labels[state]}）`,
    );
    vscode.window.showInformationMessage(labels[state]);
  });
  command('pullCurrentWikiPage', async () => {
    const doc = document(),
      before = doc.getText(),
      version = doc.version;
    const config = await documentSession(doc),
      entry = await linked(doc, config),
      remote = await api.page(config, entry.page.pageid);
    let imageSummary = '';
    let imageFailed = false;
    try {
      const root =
        vscode.workspace.getWorkspaceFolder?.(doc.uri)?.uri.fsPath || path.dirname(doc.fileName);
      const name = path
        .relative(root, doc.fileName)
        .replace(/\\/g, '/')
        .replace(/\.(atwiki|atw|txt)$/i, '');
      const images = await syncImages(root, config.wiki, remote, name);
      const message = `画像: ${images.updated}件取得・更新、${images.kept}件維持、${images.problems.length}件取得エラー。`;
      imageFailed = images.problems.length > 0;
      imageSummary = message + (imageFailed ? '\n' + images.problems.join('\n') : '');
    } catch (error) {
      imageFailed = true;
      imageSummary = '画像の同期に失敗しました: ' + error.message;
    }
    const finish = (message, warning = false) =>
      notify(
        warning || imageFailed ? 'Warning' : 'Information',
        `${remote.pagename}: ${warning ? '同期未完了' : imageFailed ? '同期終了（一部失敗）' : '同期完了'}。${message}\n${imageSummary}`,
      );
    const state = syncState(entry.page.source, before, remote.source);
    unchanged(doc, before, version);
    if (state === 'local') {
      finish('本家に変更はありません。ローカルの変更を維持します。');
      return;
    }
    if (state === 'conflict') {
      await diff(doc, remote.source, `${remote.pagename}: 競合・本家 ↔ ローカル`);
      finish(
        '双方に変更があります。本文は変更していません。差分を確認し、必要な変更を手動で統合した後「競合解決済みとして同期基準を更新」を実行してください。本家の本文は差分の左側からコピーできます。',
        true,
      );
      return;
    }
    if (state === 'remote') {
      await replace(doc, remote.source, before, version);
      // Keep the old baseline if an editor listener changed the replacement.
      if (doc.getText() !== remote.source)
        throw Error('本文が変更されたため同期基準を更新しませんでした。');
    }
    if ((await readSaved(doc.fileName)) === remote.source) {
      pendingPulls.delete(doc);
      await store.save(doc.uri.toString(), config.wiki, remote);
    } else {
      pendingPulls.set(doc, { wiki: config.wiki, remote });
    }
    finish(
      state === 'equal'
        ? '本家と一致しています。同期基準を更新しました。'
        : '本家の更新を取り込みました。内容を確認してファイルを保存してください。',
    );
  });
  command('resolveWikiConflict', async () => {
    const doc = document(),
      before = doc.getText(),
      version = doc.version;
    const config = await documentSession(doc),
      entry = await linked(doc, config),
      remote = await api.page(config, entry.page.pageid);
    await diff(doc, remote.source, `${remote.pagename}: 現在の本家 ↔ 統合後の本文`);
    const answer = await vscode.window.showWarningMessage(
      '現在の本家の変更をローカル本文に統合しましたか？同期基準を更新すると、次の投稿でファイルに保存済みの本文全体を本家へ反映します。',
      { modal: true },
      '統合済みとして基準を更新',
    );
    if (answer !== '統合済みとして基準を更新') return;
    unchanged(doc, before, version);
    await store.save(doc.uri.toString(), config.wiki, remote);
    vscode.window.showInformationMessage('同期基準を更新しました。投稿はまだ行っていません。');
  });
  async function publishDocument(doc) {
    const before = await readSaved(doc.fileName);
    async function savedUnchanged() {
      if ((await readSaved(doc.fileName)) !== before)
        throw Error(
          '処理中に保存済みの本文が変更されました。差分を確認してもう一度実行してください。',
        );
    }
    const config = await documentSession(doc),
      entry = await linked(doc, config),
      remote = await api.page(config, entry.page.pageid);
    await savedUnchanged();
    if (remote.source === before) {
      await store.save(doc.uri.toString(), config.wiki, remote);
      notify('Information', `${remote.pagename}: 本家と一致しています。投稿は不要です。`);
      return;
    }
    await diff(doc, remote.source, `${remote.pagename}: 投稿する変更（本家 ↔ 保存済み）`, before);
    if (remote.etag !== entry.page.etag || remote.source !== entry.page.source)
      throw Error(
        '前回同期後に本家が更新されています。差分を確認して手動で統合し、「競合解決済みとして同期基準を更新」を実行してください。投稿は行いませんでした。',
      );
    const answer = await vscode.window.showWarningMessage(
      `${doc.fileName}\nhttps://w.atwiki.jp/${config.wiki}/pages/${remote.pageid}.html\n「${remote.pagename}」の本文全体を右側の保存済みの内容で更新します。`,
      { modal: true },
      'この内容を投稿',
    );
    if (answer !== 'この内容を投稿') {
      notify('Information', '投稿をキャンセルしました。');
      return;
    }
    await savedUnchanged();
    await savedUnchanged();
    const posted = await api.publish(config, remote, before);
    try {
      await store.save(doc.uri.toString(), config.wiki, posted);
    } catch (error) {
      notify(
        'Warning',
        `${remote.pagename}: 投稿は完了しましたが、同期基準の保存に失敗しました。本家と比較して確認してください: ${error.message}`,
      );
      return;
    }
    notify('Information', `${remote.pagename}: 投稿完了。`);
  }
  command('publishWikiPage', () => publishDocument(document()));
  command('updateWikiPage', async (uri, selectedUris) => {
    if (Array.isArray(selectedUris) && selectedUris.length > 1)
      throw Error('更新するファイルを1つだけ指定してください。');
    if (!uri) {
      const selected = await vscode.window.showOpenDialog({
        title: 'Wikiへ反映するファイルを1つ選択',
        openLabel: 'このファイルでWikiを更新',
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { アットウィキ本文: ['atwiki', 'atw', 'txt'] },
      });
      if (!selected?.length) return;
      if (selected.length !== 1) throw Error('更新するファイルを1つだけ指定してください。');
      uri = selected[0];
    }
    if (
      uri.scheme !== 'file' ||
      !/\.(atwiki|atw|txt)$/i.test(uri.fsPath) ||
      uri.fsPath.split(/[\\/]/).includes('.atwiki-history')
    )
      throw Error('保存済みの .atwiki / .atw / .txt ファイルを指定してください。');
    const doc = document(await vscode.workspace.openTextDocument(uri));
    await publishDocument(doc);
  });
  return actions;
}
module.exports = { connectionKey, SyncStore, registerWikiSync };
