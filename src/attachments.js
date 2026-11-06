'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { within } = require('./local-pages');
async function resolveAttachment(root, name) {
  if (!name || /[\x00-\x1f]/.test(name) || /^[\w+.-]+:/.test(name) || path.isAbsolute(name))
    return null;
  try {
    const base = await fs.realpath(root);
    const candidate = path.resolve(root, name);
    if (!within(path.resolve(root), candidate)) return null;
    const file = await fs.realpath(candidate);
    return within(base, file) && (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}
async function openAttachment(vscode, root, name) {
  const file = await resolveAttachment(typeof root === 'string' ? root : root.fsPath, name);
  if (file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  else vscode.window.showInformationMessage('添付ファイルが見つかりません: ' + name);
}
module.exports = { resolveAttachment, openAttachment };
