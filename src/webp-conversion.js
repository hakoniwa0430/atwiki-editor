'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { updateReferences } = require('./webp-references');
const IMAGE = /\.(png|jpe?g|gif|avif|tiff?)$/i;

async function inventory(root) {
  const files = new Set();
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
        continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) files.add(name);
    }
  }
  await walk(root);
  return files;
}

async function encodeWebp(input, { lossless = false, quality = 80 } = {}) {
  const sharp = require('sharp');
  const image = sharp(input, { animated: true, failOn: 'warning' });
  const metadata = await image.metadata();
  // APNG is not decoded as animation by libvips. Never silently flatten it.
  if (metadata.format === 'png') {
    for (let offset = 8; offset + 12 <= input.length; ) {
      const length = input.readUInt32BE(offset);
      if (input.toString('ascii', offset + 4, offset + 8) === 'acTL')
        throw Error('APNGは対象外です');
      offset += length + 12;
    }
  }
  if ((metadata.pages || 1) > 1 && metadata.format !== 'gif')
    throw Error('GIF以外の複数フレーム画像は対象外です');
  return image.autoOrient().webp({ lossless, quality, effort: 4, exact: lossless }).toBuffer();
}

function registerWebp(vscode, context) {
  let running = false;
  async function run(updatePages) {
    if (running) {
      void vscode.window.showInformationMessage('WebP変換を実行中です。');
      return;
    }
    running = true;
    try {
      const folders = (vscode.workspace.workspaceFolders || []).filter(
        (folder) => folder.uri.scheme === 'file',
      );
      if (!folders.length)
        throw Error('画像があるローカルフォルダーをワークスペースで開いてください。');
      const roots = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'WebP変換: 画像を検索中',
          cancellable: false,
        },
        async (progress) => {
          for (const folder of folders) {
            progress.report({ message: folder.uri.fsPath });
            roots.push({ root: folder.uri.fsPath, files: await inventory(folder.uri.fsPath) });
          }
        },
      );
      roots.sort((a, b) => b.root.length - a.root.length);
      const choices = roots.flatMap(({ root, files }) =>
        [...files]
          .filter((name) => IMAGE.test(name))
          .map((name) => ({ label: name, description: root, root, name, picked: false })),
      );
      if (!choices.length) {
        void vscode.window.showInformationMessage('変換できるローカル画像がありません。');
        return;
      }
      const selected = await vscode.window.showQuickPick(choices, {
        canPickMany: true,
        title: 'WebPに変換する画像を選択',
        placeHolder: 'PNG・JPEG・GIF・AVIF・TIFF（複数選択可）',
      });
      if (!selected?.length) return;
      const mode = await vscode.window.showQuickPick(
        [
          { label: '元画像を残す', remove: false },
          {
            label: '元画像を削除する',
            description: updatePages
              ? '参照の更新とページの保存が成功した後に削除'
              : '変換成功後に削除',
            remove: true,
          },
        ],
        { title: '変換後の元画像の扱い' },
      );
      if (!mode) return;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '画像をWebPへ変換',
          cancellable: false,
        },
        async (progress) => {
          // Open every wiki document before writing anything; do not use the preview's capped index.
          const documents = [];
          const seen = new Set();
          for (const { root, files } of updatePages ? roots : [])
            for (const name of files) {
              if (!/\.(atwiki|atw)$/i.test(name)) continue;
              const uri = vscode.Uri.file(path.join(root, name));
              if (seen.has(uri.toString())) continue;
              seen.add(uri.toString());
              const document = await vscode.workspace.openTextDocument(uri);
              documents.push({
                root,
                files,
                name,
                document,
                text: document.getText(),
                version: document.version,
              });
            }
          const converted = new Map(roots.map(({ root }) => [root, new Set()]));
          const originals = [];
          const skipped = [];
          for (const item of selected) {
            const file = path.join(item.root, item.name),
              target = file.replace(/\.[^.]+$/, '.webp');
            progress.report({ message: item.name });
            try {
              try {
                await fs.lstat(target);
                skipped.push(item.name + ': 同名WebPあり');
                continue;
              } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
              const input = await fs.readFile(file);
              const config = vscode.workspace.getConfiguration(
                'atwiki.webp',
                vscode.Uri.file(file),
              );
              const output = await encodeWebp(input, {
                lossless: config.get('compression', 'lossy') === 'lossless',
                quality: config.get('quality', 80),
              });
              // Exclusive creation prevents overwriting even if a file appears during encoding.
              const handle = await fs.open(target, 'wx');
              try {
                await handle.writeFile(output);
              } catch (error) {
                await handle.close();
                await fs.unlink(target);
                throw error;
              }
              await handle.close();
              for (const { root } of roots) {
                const relative = path.relative(root, file).replace(/\\/g, '/');
                if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('../'))
                  converted.get(root).add(relative);
              }
              originals.push({ file, input });
            } catch (error) {
              skipped.push(item.name + ': ' + error.message);
            }
          }
          const edit = new vscode.WorkspaceEdit();
          const changed = [];
          let references = 0;
          if (documents.some((item) => item.document.version !== item.version))
            throw Error(
              '変換中にページが編集されました。元画像は保持しました。生成済みWebPを確認してください。',
            );
          for (const item of documents) {
            const result = updateReferences(
              item.text,
              item.name.replace(/\.(atwiki|atw)$/i, ''),
              item.files,
              converted.get(item.root),
            );
            if (!result.count) continue;
            if (item.document.version !== item.version)
              throw Error(
                '変換中にページが編集されました。元画像は保持しました。生成済みWebPを確認してください。',
              );
            edit.replace(
              item.document.uri,
              new vscode.Range(
                item.document.positionAt(0),
                item.document.positionAt(item.text.length),
              ),
              result.text,
            );
            changed.push({ ...item, expected: result.text });
            references += result.count;
          }
          if (changed.length && !(await vscode.workspace.applyEdit(edit)))
            throw Error('参照の更新に失敗しました。元画像は保持しました。');
          for (const item of changed) {
            if (
              item.document.getText() !== item.expected ||
              !(await item.document.save()) ||
              item.document.isDirty ||
              item.document.getText() !== item.expected
            )
              throw Error('ページを保存できませんでした。元画像は保持しました。');
          }
          if (mode.remove)
            for (const original of originals) {
              try {
                if (
                  documents.some(
                    (item) =>
                      item.document.getText() !==
                      (changed.find((change) => change.document === item.document)?.expected ??
                        item.text),
                  )
                )
                  throw Error('変換中にページが編集されたため保持しました');
                if (!(await fs.readFile(original.file)).equals(original.input))
                  throw Error('変換中に元画像が変更されたため保持しました');
                await vscode.workspace.fs.delete(vscode.Uri.file(original.file), {
                  recursive: false,
                  useTrash: true,
                });
              } catch (error) {
                skipped.push(path.basename(original.file) + ': 元画像を保持: ' + error.message);
              }
            }
          // Informational notifications resolve when dismissed; do not keep progress open for them.
          void vscode.window.showInformationMessage(
            `WebP変換: ${originals.length}画像。${updatePages ? `${changed.length}ページ・${references}参照を更新。` : '参照更新なし。'}${skipped.length ? 'スキップ・保持: ' + skipped.length + '件。' : ''}`,
          );
          if (skipped.length) {
            const report = await vscode.workspace.openTextDocument({
              language: 'plaintext',
              content: 'WebP変換のスキップ・保持\n\n' + skipped.join('\n'),
            });
            await vscode.window.showTextDocument(report);
          }
        },
      );
    } catch (error) {
      void vscode.window.showErrorMessage('WebP変換: ' + error.message);
    } finally {
      running = false;
    }
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('atwiki.convertImagesToWebp', () => run(true)),
    vscode.commands.registerCommand('atwiki.convertImagesToWebpOnly', () => run(false)),
  );
}
module.exports = { inventory, encodeWebp, registerWebp };
