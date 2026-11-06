'use strict';
const path = require('node:path');

function pageNameFromFile(rootPath, fileName) {
  return path
    .relative(rootPath, fileName)
    .replace(/\\/g, '/')
    .replace(/\.(atwiki|atw|txt)$/i, '');
}

function filePageRoot(vscode, document, pageRoots) {
  return (
    pageRoots.get(document.uri.toString())?.fsPath ||
    vscode.workspace.getWorkspaceFolder?.(document.uri)?.uri.fsPath ||
    path.dirname(document.fileName)
  );
}

module.exports = { pageNameFromFile, filePageRoot };
