'use strict';
const { escapeHtml, readPlugin, splitTop, parameters } = require('./syntax');
const { plugin } = require('./plugins');
const { renderTable } = require('./table');
const { decode } = require('./safe-html');
const structure = require('./plugin-structure');

function render(source, options = {}) {
  const warnings = new Set(),
    headings = [],
    notes = [],
    usedIds = new Set([
      'atwiki-top',
      'content',
      'filename',
      'status',
      'warnings',
      'warning-count',
      'warning-list',
    ]);
  const toc = [],
    includes = new Set(),
    usedPlugins = new Set(),
    noteIds = new Map();
  let currentLine = 0,
    noteDepth = 0;
  const diagnostics = [];
  const warn = (text) => {
    warnings.add(text);
    if (
      !diagnostics.some(
        (d) => d.line === currentLine && d.message === text && d.page === ctx.sourcePage,
      )
    )
      diagnostics.push({
        message: text,
        line: currentLine,
        ...(ctx.sourcePage ? { page: ctx.sourcePage } : {}),
      });
  };
  const atLine = (line, fn) => {
    const previous = currentLine;
    currentLine = line;
    try {
      return fn();
    } finally {
      currentLine = previous;
    }
  };
  function id(value = 'section') {
    let result = value || 'section',
      suffix = 2;
    while (usedIds.has(result)) result = `${value}-${suffix++}`;
    usedIds.add(result);
    return result;
  }
  function renderBody(p, depth, line) {
    const text = p.body ?? p.args;
    return p.block
      ? blocks(text.replace(/^\n|\n$/g, ''), line + (p.body?.startsWith('\n') ? 1 : 0), depth + 1)
      : inline(text, depth + 1);
  }
  const ctx = {
    warn,
    atLine,
    id,
    inline,
    blocks,
    renderBody,
    link,
    includePage,
    source,
    options,
    now: options.now ? new Date(options.now) : new Date(),
    footnote,
    icon,
    mode: options.mode || 'desktop',
    title: null,
  };
  let includeCount = 0;
  function includePage(name, depth, line) {
    if (includes.has(name)) {
      warn(`循環した include: ${name}`);
      return `<code>${escapeHtml(name)}</code>`;
    }
    if (++includeCount > 70 || depth > 24) {
      warn('ページ取り込みの上限を超えました');
      return '';
    }
    const page = options.pages?.[name];
    if (page === undefined) {
      warn(`ローカルページが見つかりません: ${name}`);
      return `<code class="unsupported">${escapeHtml(name)}</code>`;
    }
    includes.add(name);
    const previousPage = ctx.sourcePage;
    ctx.sourcePage = name;
    const html = blocks(typeof page === 'string' ? page : page.text, 0, depth + 1);
    ctx.sourcePage = previousPage;
    includes.delete(name);
    return `<section data-include="${escapeHtml(name)}">${html}</section>`;
  }
  function footnote(text, reference) {
    if (noteDepth >= 24) {
      warn('脚注の入れ子が深すぎます');
      return '';
    }
    let number;
    if (reference !== null && /^\d+$/.test(reference)) number = +reference;
    else {
      number = notes.length + 1;
      if (!noteIds.has(number)) noteIds.set(number, id(`note-${number}`));
      notes.push({ number, text, html: null });
      noteDepth++;
      try {
        notes[number - 1].html = inline(text, 1);
      } finally {
        noteDepth--;
      }
    }
    if (!noteIds.has(number)) noteIds.set(number, id(`note-${number}`));
    const ref = id(`note-ref-${number}`);
    if (notes[number - 1] && !notes[number - 1].ref) notes[number - 1].ref = ref;
    return `<sup class="footnote"><a href="#${noteIds.get(number)}" id="${ref}" title="${escapeHtml(text)}">*${number}</a></sup>`;
  }
  function icon(args) {
    try {
      const icons = require('../vendor/icons.json'),
        classes = args.trim().split(/\s+/);
      const prefix = classes.some((c) => ['far', 'fa-regular'].includes(c))
        ? 'far'
        : classes.some((c) => ['fab', 'fa-brands'].includes(c))
          ? 'fab'
          : 'fas';
      const name = classes.find((c) => icons[prefix]?.[c.replace(/^fa-/, '')]),
        data = icons[prefix]?.[name?.replace(/^fa-/, '')];
      if (!data) {
        warn(`icon_fa のアイコンが見つかりません: ${args}`);
        return `<span class="unsupported">${escapeHtml(args)}</span>`;
      }
      const size = classes.find((c) => /^fa-(?:[1-9]|10)x$/.test(c));
      const styles = size ? `font-size:${parseInt(size.slice(3), 10)}em;` : '';
      const paths = Array.isArray(data[4]) ? data[4] : [data[4]];
      return `<svg class="fa-icon ${escapeHtml(classes.filter((c) => /^fa-[\w-]+$/.test(c)).join(' '))}" style="${styles}" viewBox="0 0 ${data[0]} ${data[1]}" role="img" aria-label="${escapeHtml(name)}">${paths.map((d) => `<path fill="currentColor" d="${escapeHtml(d)}"/>`).join('')}</svg>`;
    } catch {
      warn('icon_fa のアイコンデータがありません');
      return `<span class="unsupported">${escapeHtml(args)}</span>`;
    }
  }
  function link(
    label,
    target,
    depth = 0,
    htmlLabel = false,
    newWindow = false,
    generatedAnchor = false,
  ) {
    label = String(label ?? '');
    target = String(target ?? '');
    if (options.validateLinks && !/^[\w+.-]+:/.test(target)) {
      const [rawPage, rawAnchor] = target.split('#');
      const page = rawPage.replace(/\.(atwiki|atw|txt)$/i, '');
      const entry = !page || page === options.pageName ? source : options.pages?.[page];
      const content = typeof entry === 'string' ? entry : entry?.text;
      let anchor = rawAnchor;
      try {
        anchor = decodeURIComponent(anchor || '');
      } catch {}
      if (content === undefined)
        warn(
          'ローカルページが見つかりません: ' +
            target +
            (options.pagesTruncated ? '（読み込み上限）' : ''),
        );
      else if (anchor && !generatedAnchor) {
        const anchors = [...content.matchAll(/&(?:aname|anchor)\(\s*([^,)]+)/g)].map((m) =>
          m[1].trim(),
        );
        if (!anchors.includes(anchor)) warn('アンカーが見つかりません: ' + target);
      }
    }
    if (newWindow && target.startsWith('#') && options.pageName) target = options.pageName + target;
    const blank = newWindow ? ' data-new-window="true"' : '';
    const text = htmlLabel ? label : inline(label, depth + 1, true);
    if (target.startsWith('#'))
      return `<a href="${escapeHtml(target)}" data-named-anchor="true">${text}</a>`;
    if (/^(?:https?:\/\/|mailto:|tel:)/i.test(target) && !/[\x00-\x20]/.test(target))
      return `<a href="${escapeHtml(target)}"${blank} rel="noreferrer noopener">${text}</a>`;
    if (/^[\w+.-]+:/.test(target) || /[\x00-\x1f]/.test(target)) {
      warn(`リンク先の形式に対応していません: ${target}`);
      return text;
    }
    return `<a href="#" class="wiki-link" data-page="${escapeHtml(target)}"${generatedAnchor ? ' data-generated-anchor="true"' : ''}${blank}>${text}</a>`;
  }
  function dispatch(p, depth, line) {
    return atLine(line, () => dispatchPlugin(p, depth, line));
  }
  function dispatchPlugin(p, depth, line) {
    usedPlugins.add(p.name);
    require('./option-validation').validate(p, warn);
    if (depth > 24) {
      warn('装飾の入れ子が深すぎます');
      return escapeHtml(p.raw);
    }
    if (structure.contents.includes(p.name)) {
      const marker = `\u0001TOC${toc.length}\u0002`;
      toc.push({ marker, p, line, after: headings.length });
      return marker;
    }
    if (p.name === 'table_edit') {
      const { flags, values } = parameters(p.args);
      if (!flags[0]) {
        warn('table_edit: 参照ページを指定してください');
        return '';
      }
      if (Object.keys(values).length) warn('table_edit: 編集フォームのオプションは使用できません');
      return includePage(flags[0], depth, line).replace(
        '<section ',
        '<section data-editable-include="true" ',
      );
    }
    if (structure.includes.includes(p.name)) {
      const names = splitTop(p.args)
        .map((s) => s.trim())
        .filter(Boolean);
      const chosen =
        p.name === 'include_random' && names.length
          ? [names[Math.floor((options.random?.() ?? Math.random()) * names.length)]]
          : p.name === 'splitinclude'
            ? names
            : names.slice(0, 1);
      return `<div class="${p.name === 'splitinclude' ? 'split-include' : 'included-page'}">${chosen.map((name) => includePage(name, depth, line)).join('')}</div>`;
    }
    const html = plugin(p, ctx, depth, line);
    if (html !== null) return html;
    warn(`${p.name}（${require('./unsupported')[p.name] || '未対応または記法名が不正'}）`);
    return `<code class="unsupported">${escapeHtml(p.raw)}</code>`;
  }
  function inline(text, depth = 0, noLinks = false) {
    if (depth > 24) {
      warn('装飾の入れ子が深すぎます');
      return escapeHtml(text);
    }
    let result = '',
      i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      if (rest.startsWith('[[') && !noLinks) {
        const end = text.indexOf(']]', i + 2);
        if (end >= 0) {
          const value = text.slice(i + 2, end),
            match = value.match(/>>?/);
          result += match
            ? link(
                value.slice(0, match.index),
                value.slice(match.index + match[0].length),
                depth,
                false,
                match[0] === '>>',
              )
            : link(value, value, depth);
          i = end + 2;
          continue;
        }
      }
      if (rest.startsWith('((')) {
        let j = i + 2,
          balance = 1;
        for (; j < text.length; j++) {
          if (text.startsWith('((', j)) {
            balance++;
            j++;
          } else if (text.startsWith('))', j)) {
            if (--balance === 0) break;
            j++;
          }
        }
        if (balance === 0) {
          result += footnote(text.slice(i + 2, j), null);
          i = j + 2;
          continue;
        }
      }
      if (rest.startsWith('$$')) {
        const end = text.indexOf('$$', i + 2);
        if (end >= 0) {
          result += dispatch(
            {
              name: 'tex',
              args: '',
              body: text.slice(i + 2, end),
              block: false,
              raw: text.slice(i, end + 2),
            },
            depth,
            currentLine,
          );
          i = end + 2;
          continue;
        }
      }
      const entity = rest.match(/^&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i);
      if (entity) {
        result += escapeHtml(decode(entity[0]));
        i += entity[0].length;
        continue;
      }
      if (text[i] === '&') {
        const p = readPlugin(text, i);
        if (p) {
          result += dispatch(p, depth + 1, currentLine);
          i = p.end;
          continue;
        }
      }
      let formatted = false;
      for (const [mark, tag] of [
        ["'''", 'em'],
        ["''", 'strong'],
        ['%%', 'del'],
      ]) {
        if (!rest.startsWith(mark)) continue;
        const end = text.indexOf(mark, i + mark.length);
        if (end < 0) continue;
        result += `<${tag}>${inline(text.slice(i + mark.length, end), depth + 1, noLinks)}</${tag}>`;
        i = end + mark.length;
        formatted = true;
        break;
      }
      if (formatted) continue;
      const url = !noLinks && rest.match(/^https?:\/\/[^\s<>\[\]"']+/i);
      if (url) {
        result += `<a href="${escapeHtml(url[0])}" rel="noreferrer noopener">${escapeHtml(url[0])}</a>`;
        i += url[0].length;
        continue;
      }
      if (text[i] === '\\' && text[i + 1] === '|') {
        result += '|';
        i += 2;
        continue;
      }
      result += escapeHtml(text[i++]);
    }
    return result;
  }
  function blocks(input, offset = 0, depth = 0) {
    if (depth > 24) {
      warn('ブロックの入れ子が深すぎます');
      return `<pre>${escapeHtml(input)}</pre>`;
    }
    const normalized = input.replace(/\r\n?/g, '\n');
    const lines = (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n'),
      chunks = [],
      textLines = [];
    let i = 0,
      regions = 0,
      pending = [];
    if (!normalized) return '';
    function flushText() {
      if (textLines.length) {
        chunks.push(`<div class="text-block">${textLines.join('<br>')}</div>`);
        textLines.length = 0;
      }
    }
    function push(html) {
      flushText();
      chunks.push(html);
    }
    function blockPlugin(at) {
      if (!/^#[a-zA-Z]/.test(lines[at] || '')) return null;
      const p = readPlugin(lines.slice(at).join('\n'));
      if (!p) return null;
      const consumed = p.raw.split('\n').length;
      const trailing = lines[at + consumed - 1]?.slice(p.raw.split('\n').at(-1).length) || '';
      if (trailing.trim()) return null;
      return { ...p, consumed };
    }
    while (i < lines.length) {
      const line = lines[i],
        lineNo = offset + i;
      currentLine = lineNo;
      if (line.startsWith('//')) {
        i++;
        continue;
      }
      if (!line.trim()) {
        push(`<br class="wiki-blank" data-line="${lineNo}">`);
        i++;
        continue;
      }
      if (line.startsWith('$$')) {
        const joined = lines.slice(i).join('\n'),
          end = joined.indexOf('$$', 2);
        if (end >= 0) {
          push(
            dispatch(
              {
                name: 'tex',
                args: '',
                body: joined.slice(2, end),
                block: true,
                raw: joined.slice(0, end + 2),
              },
              depth,
              lineNo,
            ),
          );
          i += joined.slice(0, end + 2).split('\n').length;
          continue;
        }
      }
      const p = blockPlugin(i);
      if (p && structure.tableBefore.includes(p.name)) {
        pending.push(p);
        usedPlugins.add(p.name);
        i += p.consumed;
        continue;
      }
      if (/^\|.*\|[hfc]?$/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|.*\|[hfc]?$/.test(lines[i])) {
          rows.push({ text: lines[i], line: offset + i });
          i++;
        }
        let after;
        while ((after = blockPlugin(i)) && structure.tableAfter.includes(after.name)) {
          pending.push(after);
          usedPlugins.add(after.name);
          i += after.consumed;
        }
        push(renderTable(rows, pending, ctx));
        pending = [];
        continue;
      }
      if (pending.length) {
        warn('表の直前プラグインに対応する表がありません');
        pending = [];
      }
      if (p?.name === 'region') {
        usedPlugins.add(p.name);
        const pars = parameters(p.args);
        push(
          `<details data-line="${lineNo}"${pars.flags.includes('remember') ? ` data-remember="${id('region:' + lineNo)}"` : ''}${pars.flags.some((s) => ['open', 'opened'].includes(s)) ? ' open' : ''}><summary>${inline(pars.flags.find((s) => !['open', 'opened', 'close', 'closed', 'closeed', 'remember'].includes(s)) || '...', depth + 1)}</summary>`,
        );
        regions++;
        i += p.consumed;
        continue;
      }
      if (p?.name === 'endregion' && regions) {
        push('</details>');
        regions--;
        i += p.consumed;
        continue;
      }
      if (p) {
        push(`<div data-line="${lineNo}">${dispatch(p, depth + 1, lineNo)}</div>`);
        i += p.consumed;
        continue;
      }
      const heading = line.match(/^(\*{1,5})(.*)$/);
      if (heading) {
        let text = heading[2].trim(),
          explicit = text.match(/\s*\[#([^\]]+)\]$/),
          anchor = id(explicit ? explicit[1] : `heading-${lineNo + 1}`);
        if (explicit && anchor !== explicit[1]) warn('アンカー名の重複');
        if (explicit) text = text.slice(0, explicit.index);
        const content = inline(text, depth + 1);
        headings.push({ anchor, level: heading[1].length, text, content, line: lineNo });
        push(
          `<h${heading[1].length + 1} id="${escapeHtml(anchor)}" data-line="${lineNo}">${content}</h${heading[1].length + 1}>`,
        );
        i++;
        continue;
      }
      if (/^----+$/.test(line)) {
        push(`<hr data-line="${lineNo}">`);
        i++;
        continue;
      }
      if (/^[-+]{1,3}[^-+]/.test(line)) {
        const stack = [];
        while (i < lines.length && /^[-+]{1,3}[^-+]/.test(lines[i])) {
          const match = lines[i].match(/^([-+]{1,3})(.*)$/),
            type = match[1][0] === '-' ? 'ul' : 'ol',
            level = Math.min(match[1].length, stack.length + 1);
          while (stack.length > level) push(`</li></${stack.pop()}>`);
          if (stack.length === level && stack.at(-1) !== type) push(`</li></${stack.pop()}>`);
          else if (stack.length === level) push('</li>');
          if (stack.length < level) {
            push(`<${type}>`);
            stack.push(type);
          }
          push(
            `<li data-line="${offset + i}">${atLine(offset + i, () => inline(match[2], depth + 1))}`,
          );
          i++;
        }
        while (stack.length) push(`</li></${stack.pop()}>`);
        continue;
      }
      if (line.startsWith(' ')) {
        const pre = [];
        while (i < lines.length && lines[i].startsWith(' ')) pre.push(lines[i++].slice(1));
        push(`<pre data-line="${lineNo}"><code>${escapeHtml(pre.join('\n'))}</code></pre>`);
        continue;
      }
      const quote = line.match(/^(>+)(.*)$/);
      if (quote) {
        const quoted = [];
        while (i < lines.length && lines[i].startsWith('>')) quoted.push(lines[i++].slice(1));
        // Parse the quoted block together so consecutive lines share one frame.
        // A final newline preserves an explicitly empty last quoted line.
        push(`<blockquote>${blocks(quoted.join('\n') + '\n', lineNo, depth + 1)}</blockquote>`);
        continue;
      }
      const definition = line.match(/^:([^|]*)\|(.*)$/);
      if (definition) {
        const body = [definition[2]];
        i++;
        while (i < lines.length && lines[i].trim() && !/^:([^|]*)\|/.test(lines[i]))
          body.push(lines[i++]);
        push(
          `<dl data-line="${lineNo}"><dt>${inline(definition[1], depth + 1)}</dt><dd>${body.map((s, n) => atLine(lineNo + n, () => inline(s, depth + 1))).join('<br>')}</dd></dl>`,
        );
        continue;
      }
      if (/^#[a-zA-Z]/.test(line)) {
        warn(`閉じていないか不正なプラグイン（${lineNo + 1}行目）`);
        push(`<code class="unsupported" data-line="${lineNo}">${escapeHtml(line)}</code>`);
      } else
        textLines.push(
          `<span class="text-line" data-line="${lineNo}">${inline(line, depth + 1)}</span>`,
        );
      i++;
    }
    if (pending.length) warn('表の直前プラグインに対応する表がありません');
    if (regions) warn('閉じていない #region');
    while (regions-- > 0) push('</details>');
    flushText();
    return chunks.join('\n');
  }
  let html = blocks(source);
  for (const entry of toc) {
    const pars = parameters(entry.p.args);
    let selected = headings;
    if (entry.p.name === 'contents_line') {
      const before = headings.filter((h) => h.line < entry.line).at(-1),
        start = before ? headings.indexOf(before) + 1 : 0;
      selected = headings.slice(start);
      if (before) {
        const stop = selected.findIndex((h) => h.level <= before.level);
        if (stop >= 0) selected = selected.slice(0, stop);
      }
    }
    const max = +pars.values.level || +pars.values.depth || 5;
    selected = selected.filter((h) => h.level <= max);
    const label = (h) => h.content.replace(/<\/?a\b[^>]*>/g, '').replace(/\sid="[^"]*"/g, '');
    const contents =
      entry.p.name === 'contents_line'
        ? `<nav class="toc-line">${selected.map((h) => `<a href="#${escapeHtml(h.anchor)}">${label(h)}</a>`).join(' / ')}</nav>`
        : `<nav class="toc" aria-label="目次" data-line="${entry.line}"><ul>${selected.map((h) => `<li style="margin-left:${(h.level - 1) * 16}px">・<a href="#${escapeHtml(h.anchor)}">${label(h)}</a></li>`).join('')}</ul></nav>`;
    html = html.split(entry.marker).join(contents);
  }
  for (const number of noteIds.keys())
    if (!notes[number - 1]) warn(`脚注 ${number} の本文がありません`);
  if (notes.length)
    html += `<section class="footnotes" aria-label="脚注"><hr><ol>${notes.map((note) => `<li id="${noteIds.get(note.number)}">${note.html}<a href="#${note.ref}" aria-label="本文へ戻る"> ↩</a></li>`).join('')}</ol></section>`;
  return {
    html,
    warnings: [...warnings],
    diagnostics,
    headings,
    usedPlugins: [...usedPlugins],
    title: ctx.title,
  };
}
module.exports = { render, escapeHtml };
