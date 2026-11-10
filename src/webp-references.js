'use strict';
const path = require('node:path');
const { readPlugin, splitTop, parameters } = require('./syntax');
const { decode } = require('./safe-html');

// Match the local preview's page attachment precedence, against the original inventory.
function resolveReference(value, page, sourcePage, files) {
  if (!value || /[\x00-\x1f]/.test(value) || /^(?:[a-z][\w+.-]*:|[\\/])/i.test(value)) return null;
  const directory = path.posix.dirname(sourcePage);
  const candidates = [];
  if (!page && !/[\\/]/.test(value)) candidates.push(`${sourcePage}/${value}`);
  candidates.push(page ? `${page}/${value}` : `${directory}/${value}`);
  for (const candidate of candidates) {
    const normalized = path.posix.normalize(candidate.replace(/\\/g, '/'));
    if (normalized === '..' || normalized.startsWith('../')) continue;
    if (files.has(normalized)) return normalized;
    if (process.platform === 'win32') {
      const actual = [...files].find((file) => file.toLowerCase() === normalized.toLowerCase());
      if (actual) return actual;
    }
  }
  return null;
}

function updateReferences(text, sourcePage, files, converted) {
  const edits = [];
  function reference(raw, at, page, html = false) {
    const leading = raw.match(/^\s*/)[0].length;
    const value = raw.trim();
    const resolved = resolveReference(html ? decode(value) : value, page, sourcePage, files);
    if (!resolved || !converted.has(resolved)) return;
    const extension = value.match(/\.[a-z0-9]+$/i);
    if (extension)
      edits.push({
        start: at + leading + extension.index,
        end: at + leading + value.length,
        text: '.webp',
      });
  }
  function args(plugin, at) {
    const parts = splitTop(plugin.args);
    const parsed = parameters(plugin.args);
    let page = parsed.values.page;
    if (!page && plugin.name === 'ref')
      page = parsed.flags
        .slice(1)
        .find(
          (s) =>
            !['left', 'right', 'center', 'inline', 'float', 'blank'].includes(s) &&
            !/^https?:\/\//i.test(s),
        );
    let offset = at;
    parts.forEach((part, index) => {
      if (
        index === 0 &&
        ['image', 'image2', 'ref', 'blankimg', 'lightbox', 'gyazo'].includes(plugin.name)
      )
        reference(part, offset, page);
      if (plugin.name === 'random_img' && plugin.body === null && !part.includes('='))
        reference(part, offset);
      const key = ['link_anchor', 'link_aname'].includes(plugin.name)
        ? 'img'
        : ['new3', 'newimage'].includes(plugin.name)
          ? 'image'
          : plugin.name === 'infobox'
            ? 'url'
            : null;
      const match =
        key && part.match(new RegExp('^\\s*' + key + '\\s*=\\s*("?)([\\s\\S]*?)\\1\\s*$'));
      if (match)
        reference(
          match[2],
          offset +
            part.indexOf('=') +
            1 +
            part.slice(part.indexOf('=') + 1).search(/\S/) +
            match[1].length,
        );
      offset += part.length + 1;
    });
  }
  function scan(start, end) {
    for (let i = start; i < end; i++) {
      if ((i === 0 || text[i - 1] === '\n') && text.startsWith('//', i)) {
        const newline = text.indexOf('\n', i);
        i = newline < 0 ? end : newline;
        continue;
      }
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4);
        i = close < 0 ? end : close + 2;
        continue;
      }
      if (text[i] === '<') {
        const tag = text.slice(i, end).match(/^<img\b[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/i);
        if (tag) {
          for (const attr of tag[0].matchAll(
            /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
          )) {
            if (attr[1].toLowerCase() !== 'src') continue;
            const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
            const valueAt =
              attr.index +
              attr[0].indexOf('=') +
              1 +
              attr[0].slice(attr[0].indexOf('=') + 1).search(/\S/) +
              (attr[2] !== undefined || attr[3] !== undefined ? 1 : 0);
            reference(value, i + valueAt, undefined, true);
          }
          i += tag[0].length - 1;
          continue;
        }
      }
      if (!['&', '#'].includes(text[i])) continue;
      const plugin = readPlugin(text, i);
      if (!plugin || plugin.end > end) continue;
      if (
        [
          'code',
          'pre',
          'nowiki',
          'nolink',
          'verbatim',
          'highlight',
          'codehighlight',
          'asciiart',
          'aa',
          'math',
          'tex',
          'syntax',
          'include_js',
          'javascript',
        ].includes(plugin.name)
      ) {
        i = plugin.end - 1;
        continue;
      }
      const open = text.indexOf('(', i);
      if (plugin.args) args(plugin, open + 1);
      if (plugin.body !== null) {
        if (['random_img', 'slide_img'].includes(plugin.name)) {
          let offset = plugin.bodyStart;
          for (const part of splitTop(plugin.body)) {
            reference(part, offset);
            offset += part.length + 1;
          }
        } else scan(plugin.bodyStart, plugin.bodyStart + plugin.body.length);
      }
      // Nested inline plugins can also occur inside arguments.
      if (
        plugin.args &&
        !['image', 'image2', 'ref', 'blankimg', 'lightbox', 'gyazo', 'random_img'].includes(
          plugin.name,
        )
      )
        scan(open + 1, open + 1 + plugin.args.length);
      i = plugin.end - 1;
    }
  }
  scan(0, text.length);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return { text, count: edits.length };
}
module.exports = { resolveReference, updateReferences };
