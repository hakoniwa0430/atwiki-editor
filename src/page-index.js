'use strict';
const path = require('node:path');
const { within } = require('./local-pages');

class PageIndex {
  constructor({ loadPages, documents = () => [], watch, enrichPages = async () => {} }) {
    this.loadPages = loadPages;
    this.documents = documents;
    this.watch = watch;
    this.enrichPages = enrichPages;
    this.roots = new Map();
  }
  entry(root) {
    root = path.resolve(root);
    if (!this.roots.has(root)) this.roots.set(root, { root, listeners: new Set(), pending: null });
    return this.roots.get(root);
  }
  retain(root, listener) {
    const entry = this.entry(root);
    entry.listeners.add(listener);
    if (!entry.watcher && this.watch) {
      entry.watcher = this.watch(entry.root, () => this.invalidate(entry.root));
    }
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        entry.watcher?.dispose();
        this.roots.delete(entry.root);
      }
    };
  }
  invalidate(root) {
    const entry = this.roots.get(path.resolve(root));
    if (!entry) return;
    entry.pending = null;
    for (const listener of entry.listeners) listener();
  }
  changed(file, disk = false) {
    for (const entry of this.roots.values()) {
      if (!within(entry.root, path.resolve(file))) continue;
      if (disk) entry.pending = null;
      for (const listener of entry.listeners) listener();
    }
  }
  async get(root) {
    const entry = this.entry(root);
    for (;;) {
      const pending = (entry.pending ||= Promise.resolve().then(() =>
        this.loadPages(entry.root, []),
      ));
      let indexed;
      try {
        indexed = await pending;
      } catch (error) {
        if (entry.pending === pending) entry.pending = null;
        throw error;
      }
      // A watcher invalidated the index while its scan was still running.
      if (entry.pending !== pending) continue;
      const documents = new Map(
        this.documents()
          .filter((d) => d.uri?.scheme === 'file' && !d.isClosed)
          .map((d) => [path.resolve(d.fileName), d]),
      );
      const pages = Object.create(null);
      for (const [name, page] of Object.entries(indexed.pages)) {
        const document = page.file && documents.get(path.resolve(page.file));
        pages[name] = document ? { ...page, text: document.getText() } : { ...page };
      }
      await this.enrichPages(pages);
      return { ...indexed, pages };
    }
  }
  dispose() {
    for (const entry of this.roots.values()) entry.watcher?.dispose();
    this.roots.clear();
  }
}
module.exports = { PageIndex };
