'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { updateReferences } = require('../src/webp-references');
const { encodeWebp, inventory, registerWebp } = require('../src/webp-conversion');

test('updates only references resolving to converted images, preserving formatting and options', () => {
  const files = new Set(['a.png', 'Page/a.png', 'other/a.png', 'folder/b.JPG']);
  const converted = new Set(['Page/a.png', 'folder/b.JPG']);
  const input =
    '#image(a.png,width=300,alt=a.png)\r\n&ref(a.png,other);\n&ref(a.png,Page);\n#image( a.png ,page=Page)\n#image(https://example.com/a.png)\n#image(//host/a.png)\n#image(folder/b.JPG)\na.png';
  const result = updateReferences(input, 'Page', files, converted);
  assert.equal(result.count, 4);
  assert.equal(
    result.text,
    '#image(a.webp,width=300,alt=a.png)\r\n&ref(a.png,other);\n&ref(a.webp,Page);\n#image( a.webp ,page=Page)\n#image(https://example.com/a.png)\n#image(//host/a.png)\n#image(folder/b.webp)\na.png',
  );
});

test('nested, list, HTML and named image references; literal examples stay unchanged', () => {
  const files = new Set(['画像.png']);
  const input =
    '#div(){&image(画像.png,width=20);}\n#random_img(画像.png)\n#slide_img(){画像.png, 画像.png}\n&link_anchor(x,img="画像.png"){label}\n#newimage(image=画像.png)\n#html(){<img src="画像.png" alt="画像.png">}\n// &image(画像.png)\n#codehighlight(js){&image(画像.png)}\n&nowiki(){&image(画像.png)}';
  const result = updateReferences(input, 'Page', files, files);
  assert.equal(result.count, 7);
  assert.ok(result.text.includes('<img src="画像.webp" alt="画像.png">'));
  assert.ok(result.text.includes('img="画像.webp"'));
  assert.ok(result.text.includes('// &image(画像.png)'));
  assert.ok(result.text.includes('#codehighlight(js){&image(画像.png)}'));
  assert.ok(result.text.includes('&nowiki(){&image(画像.png)}'));
});

test('relative page paths and unconverted attachment precedence', () => {
  const files = new Set(['folder/Page/a.png', 'folder/a.png', 'a.png']);
  assert.equal(
    updateReferences(
      '#image(a.png)\n#image(../a.png)',
      'folder/Page',
      files,
      new Set(['folder/a.png', 'a.png']),
    ).text,
    '#image(a.png)\n#image(../a.webp)',
  );
});

test('lossless WebP preserves RGBA pixels and dimensions; lossy is valid WebP', async () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 20, 30, 40, 0, 0, 0, 255, 255]);
  const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
    .png()
    .toBuffer();
  const output = await encodeWebp(png);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  assert.deepEqual(await sharp(output).ensureAlpha().raw().toBuffer(), pixels);
  assert.equal(
    (await sharp(await encodeWebp(png, { lossless: false, quality: 60 })).metadata()).format,
    'webp',
  );
  await assert.rejects(encodeWebp(Buffer.from('broken image')));
});

test('animated GIF keeps its frames, delay and loop', async () => {
  const gif = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  })
    .gif({ delay: [100, 200], loop: 3 })
    .toBuffer();
  const before = await sharp(gif, { animated: true }).metadata();
  assert.equal(before.pages, 2);
  const after = await sharp(await encodeWebp(gif), { animated: true }).metadata();
  assert.equal(after.pages, 2);
  assert.equal(after.loop, before.loop);
  assert.deepEqual(after.delay, before.delay);
});

async function fixture(
  t,
  { remove = false, save = true, apply = true, duringEncode, only = false } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atwiki-webp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff000080' } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(root, 'a.png'), png);
  await fs.writeFile(path.join(root, 'Page.atwiki'), '#image(a.png,width=300)');
  await fs.writeFile(path.join(root, 'Other.atw'), '&ref(a.png)');
  await fs.writeFile(path.join(root, 'Keep.txt'), '#image(a.png)');
  const documents = new Map(),
    messages = [],
    deleted = [];
  let command;
  const uri = (file) => ({ fsPath: file, scheme: 'file', toString: () => file });
  const vscode = {
    Uri: { file: uri },
    ProgressLocation: { Notification: 1 },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    WorkspaceEdit: class {
      constructor() {
        this.edits = [];
      }
      replace(file, range, text) {
        this.edits.push({ file, text });
      }
    },
    commands: {
      registerCommand(name, callback) {
        if (name === (only ? 'atwiki.convertImagesToWebpOnly' : 'atwiki.convertImagesToWebp'))
          command = callback;
        return { dispose() {} };
      },
    },
    window: {
      showOpenDialog: async () =>
        (await fs.readdir(root))
          .filter((name) => /\.(png|jpe?g|gif|avif|tiff?)$/i.test(name))
          .map((name) => uri(path.join(root, name))),
      showQuickPick: async (items, options) =>
        options.canPickMany ? items : items.find((item) => item.remove === remove),
      withProgress: async (options, callback) => callback({ report() {} }),
      showInformationMessage: async (message) => messages.push(message),
      showErrorMessage: async (message) => messages.push(message),
      showTextDocument: async () => {},
    },
    workspace: {
      workspaceFolders: [{ uri: uri(root) }],
      getConfiguration: () => ({
        get(key, fallback) {
          duringEncode?.(documents);
          return fallback;
        },
      }),
      async openTextDocument(file) {
        if (file.content !== undefined) return file;
        if (documents.has(file.fsPath)) return documents.get(file.fsPath);
        const doc = {
          uri: file,
          version: 1,
          text: await fs.readFile(file.fsPath, 'utf8'),
          positionAt: (offset) => offset,
          getText() {
            return this.text;
          },
          async save() {
            if (save) await fs.writeFile(file.fsPath, this.text);
            return save;
          },
        };
        documents.set(file.fsPath, doc);
        return doc;
      },
      async applyEdit(edit) {
        if (!apply) return false;
        for (const item of edit.edits) {
          const doc = documents.get(item.file.fsPath);
          doc.text = item.text;
          doc.version++;
        }
        return true;
      },
      fs: {
        async delete(file, options) {
          assert.equal(options.useTrash, true);
          deleted.push(file.fsPath);
          await fs.unlink(file.fsPath);
        },
      },
    },
  };
  registerWebp(vscode, { subscriptions: [] });
  return { root, command, messages, deleted, documents, vscode };
}

test('command converts selected files and updates all wiki extensions, excluding txt', async (t) => {
  const app = await fixture(t);
  await app.command();
  assert.equal(
    await fs.readFile(path.join(app.root, 'Page.atwiki'), 'utf8'),
    '#image(a.webp,width=300)',
  );
  assert.equal(await fs.readFile(path.join(app.root, 'Other.atw'), 'utf8'), '&ref(a.webp)');
  assert.equal(await fs.readFile(path.join(app.root, 'Keep.txt'), 'utf8'), '#image(a.png)');
  assert.ok((await inventory(app.root)).has('a.png'));
  assert.equal(app.deleted.length, 0);
});

test('delete mode removes original only after saved reference updates', async (t) => {
  const app = await fixture(t, { remove: true });
  await app.command();
  assert.equal(app.deleted.length, 1);
  assert.equal(await fs.readFile(path.join(app.root, 'Other.atw'), 'utf8'), '&ref(a.webp)');
  assert.ok((await inventory(app.root)).has('a.webp'));
});

for (const options of [
  { save: false },
  { apply: false },
  {
    duringEncode: (docs) => {
      for (const doc of docs.values()) doc.version++;
    },
  },
]) {
  test(
    'update/save/concurrent edit failure preserves original: ' + Object.keys(options)[0],
    async (t) => {
      const app = await fixture(t, { ...options, remove: true });
      await app.command();
      assert.equal(app.deleted.length, 0);
      assert.ok((await inventory(app.root)).has('a.png'));
      assert.ok(app.messages.some((message) => message.includes('元画像は保持')));
    },
  );
}

test('existing WebP is untouched and its original references are skipped', async (t) => {
  const app = await fixture(t, { remove: true });
  await fs.writeFile(path.join(app.root, 'a.webp'), 'existing');
  await app.command();
  assert.equal(await fs.readFile(path.join(app.root, 'a.webp'), 'utf8'), 'existing');
  assert.equal(await fs.readFile(path.join(app.root, 'Other.atw'), 'utf8'), '&ref(a.png)');
  assert.equal(app.deleted.length, 0);
});

for (const remove of [false, true]) {
  test(`conversion-only leaves wiki files and unsaved buffers untouched (delete=${remove})`, async (t) => {
    const app = await fixture(t, { only: true, remove });
    const uri = app.vscode.Uri.file(path.join(app.root, 'Page.atwiki'));
    const open = await app.vscode.workspace.openTextDocument(uri);
    open.text += '\n未保存の編集';
    open.isDirty = true;
    app.vscode.workspace.openTextDocument = async () => {
      throw Error('Wiki must not be opened');
    };
    app.vscode.workspace.applyEdit = async () => {
      throw Error('Wiki must not be edited');
    };
    open.save = async () => {
      throw Error('Wiki must not be saved');
    };
    await app.command();
    assert.equal(
      (await sharp(await fs.readFile(path.join(app.root, 'a.webp'))).metadata()).format,
      'webp',
    );
    assert.equal(await fs.readFile(uri.fsPath, 'utf8'), '#image(a.png,width=300)');
    assert.equal(await fs.readFile(path.join(app.root, 'Other.atw'), 'utf8'), '&ref(a.png)');
    assert.equal(await fs.readFile(path.join(app.root, 'Keep.txt'), 'utf8'), '#image(a.png)');
    assert.equal(open.text, '#image(a.png,width=300)\n未保存の編集');
    assert.equal(open.isDirty, true);
    assert.equal(app.deleted.length, remove ? 1 : 0);
    assert.ok(app.messages.some((message) => message.includes('1画像。参照更新なし。')));
  });
}

test('conversion-only skips existing WebP and failed images without deleting originals', async (t) => {
  const app = await fixture(t, { only: true, remove: true });
  await fs.writeFile(path.join(app.root, 'a.webp'), 'existing');
  await fs.writeFile(path.join(app.root, 'broken.png'), 'invalid');
  await app.command();
  assert.equal(await fs.readFile(path.join(app.root, 'a.webp'), 'utf8'), 'existing');
  assert.equal(app.deleted.length, 0);
  assert.ok((await inventory(app.root)).has('a.png'));
  assert.ok(!(await inventory(app.root)).has('broken.webp'));
  assert.equal(app.documents.size, 0);
});

test('conversion-only scans nested workspace images with progress before selection', async (t) => {
  const app = await fixture(t, { only: true });
  await fs.mkdir(path.join(app.root, 'nested'));
  await fs.copyFile(path.join(app.root, 'a.png'), path.join(app.root, 'nested', 'b.png'));
  let searching = false;
  app.vscode.window.withProgress = async (options, callback) => {
    if (options.title === 'WebP変換: 画像を検索中') searching = true;
    return callback({ report() {} });
  };
  const pick = app.vscode.window.showQuickPick;
  app.vscode.window.showQuickPick = async (items, options) => {
    if (options.canPickMany) {
      assert.equal(searching, true);
      assert.deepEqual(items.map((item) => item.name).sort(), ['a.png', 'nested/b.png']);
    }
    return pick(items, options);
  };
  await app.command();
  assert.ok((await inventory(app.root)).has('a.webp'));
  assert.ok((await inventory(app.root)).has('nested/b.webp'));
  assert.ok(app.messages.some((message) => message.includes('2画像。参照更新なし。')));
});

test('conversion-only explains the workspace requirement', async (t) => {
  const app = await fixture(t, { only: true });
  app.vscode.workspace.workspaceFolders = undefined;
  await app.command();
  assert.ok(!(await inventory(app.root)).has('a.webp'));
  assert.ok(app.messages.some((message) => message.includes('ワークスペースで開いてください')));
});

test('cancelled file selection leaves files unchanged and allows another attempt', async (t) => {
  const app = await fixture(t, { only: true });
  const dialog = app.vscode.window.showQuickPick;
  app.vscode.window.showQuickPick = async () => undefined;
  await app.command();
  assert.ok(!(await inventory(app.root)).has('a.webp'));
  assert.equal(app.messages.length, 0);
  app.vscode.window.showQuickPick = dialog;
  await app.command();
  assert.ok((await inventory(app.root)).has('a.webp'));
});

test('completion notification does not keep conversion progress or the running lock active', async (t) => {
  const app = await fixture(t, { only: true });
  let progressActive = false;
  const dismiss = [];
  app.vscode.window.withProgress = async (options, callback) => {
    progressActive = true;
    try {
      return await callback({ report() {} });
    } finally {
      progressActive = false;
    }
  };
  app.vscode.window.showInformationMessage = (message) => {
    app.messages.push(message);
    return new Promise((resolve) => dismiss.push(resolve));
  };
  let timer;
  try {
    const finished = await Promise.race([
      app.command().then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 1000);
      }),
    ]);
    assert.equal(finished, true, 'command must finish without dismissing its notification');
    assert.equal(progressActive, false);
    // A second invocation must reach image selection while the first notification stays open.
    let selectedAgain = false;
    app.vscode.window.showQuickPick = async () => {
      selectedAgain = true;
      return undefined;
    };
    await app.command();
    assert.equal(selectedAgain, true);
  } finally {
    clearTimeout(timer);
    for (const resolve of dismiss) resolve();
  }
});
