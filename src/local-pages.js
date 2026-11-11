'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
function within(root, file) {
  const relative = path.relative(root, file);
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
async function findPage(root, name) {
  if (!name || /[\x00-\x1f]/.test(name) || path.isAbsolute(name) || /^[a-z][\w+.-]*:/i.test(name))
    return null;
  let base;
  try {
    base = await fs.realpath(root);
  } catch {
    return null;
  }
  for (const ext of ['', '.atwiki', '.atw', '.txt']) {
    const candidate = path.resolve(root, name + ext);
    if (!within(root, candidate)) continue;
    try {
      const actual = await fs.realpath(candidate);
      if (!within(base, actual)) continue;
      const stat = await fs.stat(actual);
      if (stat.isFile() && /\.(atwiki|atw|txt)$/i.test(actual)) return actual;
    } catch {
      /* try next extension */
    }
  }
  return null;
}
async function resolvePage(root, name, sourceFile, pages = {}) {
  const direct = await findPage(root, name);
  if (direct) return { file: direct, root };
  const indexed = Object.hasOwn(pages, name) && pages[name]?.file;
  if (indexed && within(root, indexed)) {
    const file = await findPage(root, path.relative(root, indexed));
    if (file) return { file, root };
  }
  // Only infer a root from a named ancestor matching the first page component.
  // Never turn ../ links into a search outside the selected wiki.
  const parts = name.split('/');
  if (parts.length < 2 || parts.some((s) => !s || s === '.' || s === '..' || s.includes('\\')))
    return null;
  let directory = path.dirname(sourceFile);
  while (path.dirname(directory) !== directory) {
    if (path.basename(directory) === parts[0]) {
      const candidate = path.dirname(directory),
        file = await findPage(candidate, name);
      if (file) return { file, root: candidate };
    }
    directory = path.dirname(directory);
  }
  return null;
}
async function loadPages(root, openDocuments = []) {
  const pages = Object.create(null),
    images = [];
  let count = 0,
    bytes = 0,
    truncated = false;
  let realRoot;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return { pages, images, truncated };
  }
  async function walk(dir, prefix = '', depth = 0) {
    if (depth > 8) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      const rank = (n) => ({ atwiki: 0, atw: 1, txt: 2 })[n.split('.').at(-1)] ?? 3;
      return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
        continue;
      const file = path.join(dir, entry.name),
        name = prefix + entry.name;
      if (entry.isDirectory()) {
        await walk(file, name + '/', depth + 1);
        continue;
      }
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(entry.name)) {
        if (images.length >= 500) {
          truncated = true;
          continue;
        }
        try {
          const stat = await fs.stat(file);
          images.push({ name, created: stat.birthtimeMs });
        } catch {}
        continue;
      }
      if (!/\.(atwiki|atw|txt)$/i.test(entry.name)) continue;
      if (++count > 500) {
        truncated = true;
        return;
      }
      try {
        const actual = await fs.realpath(file);
        if (!within(realRoot, actual)) continue;
        const stat = await fs.stat(file);
        if (stat.size > 2 * 1024 * 1024 || bytes + stat.size > 10 * 1024 * 1024) {
          truncated = true;
          continue;
        }
        bytes += stat.size;
        const open = openDocuments.find(
          (d) => d.uri?.scheme === 'file' && path.resolve(d.fileName) === path.resolve(file),
        );
        const text = open ? open.getText() : await fs.readFile(file, 'utf8');
        const record = {
          text,
          modified: stat.mtime.toISOString(),
          created: stat.birthtime.toISOString(),
          file,
        };
        pages[name.replace(/\.(atwiki|atw|txt)$/i, '')] ??= record;
      } catch {
        /* file was removed while indexing */
      }
    }
  }
  await walk(root);
  images.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
  return { pages, images: images.map((i) => i.name), truncated };
}
async function loadScripts(root, texts) {
  const scripts = Object.create(null);
  let bytes = 0;
  let base;
  try {
    base = await fs.realpath(root);
  } catch {
    return scripts;
  }
  const names = new Set(
    texts.flatMap((text) =>
      [...text.matchAll(/[&#]include_js\(([^)]+)\)/g)].map((m) => m[1].trim()),
    ),
  );
  for (const name of [...names].slice(0, 30)) {
    if (!/\.js$/i.test(name) || path.isAbsolute(name) || /^[\w+.-]+:/.test(name)) continue;
    try {
      const file = await fs.realpath(path.resolve(root, name));
      if (!within(base, file)) continue;
      const stat = await fs.stat(file);
      if (stat.size > 262144 || bytes + stat.size > 1048576) continue;
      bytes += stat.size;
      scripts[name] = await fs.readFile(file, 'utf8');
    } catch {}
  }
  return scripts;
}
module.exports = { resolvePage, findPage, loadPages, loadScripts, within };
