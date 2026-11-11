'use strict';
const { parameters, escapeHtml: esc } = require('./syntax');
const NAMES =
  'ls lsd ls2 ls3 ls_line recent recent_child list_newcreated list_by_search include_by_search related yetlist navi pulldown_jump redirect setmenu setmenu2 date time update lastmod last_modified new3 newimage count_pages count_childpages random random2 random3 random_page link_toppage link_nourl link_edit link_editmenu link_editmenu2 link_pagelist search search2 search3'.split(
    ' ',
  );
const pageText = (p) => (typeof p === 'string' ? p : p?.text || '');
function linkedPages(text) {
  return [
    ...new Set(
      [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
        .map((m) => m[1].split(/>>?/).at(-1).split('#')[0])
        .filter((s) => s && !/^[\w+.-]+:/.test(s)),
    ),
  ];
}
function selectPages(p, ctx) {
  const { flags, parts, values: v } = parameters(p.args),
    pages = ctx.options.pages || {},
    own = ctx.options.pageName || '';
  let names = Object.keys(pages),
    prefix = flags.find((s) => !['title', 'reverse'].includes(s) && !/^\d+$/.test(s)) || own;
  if (/^ls/.test(p.name) || p.name === 'recent_child')
    names = names.filter(
      (s) =>
        s.startsWith(prefix + '/') &&
        (p.name !== 'lsd' || !s.slice(prefix.length + 1).includes('/')),
    );
  if (p.name === 'list_by_search' || p.name === 'include_by_search') {
    const words =
      p.name === 'include_by_search'
        ? parts.filter((s) => s.startsWith('word=')).map((s) => s.slice(5))
        : flags.filter((s) => !/^\d+$/.test(s));
    names = names.filter((s) => {
      const text = (
        s + (v.target === 'withbody' ? ' ' + pageText(pages[s]) : '')
      ).toLocaleLowerCase();
      return (
        words.length === 0 ||
        (v.andor === 'or'
          ? words.some((w) => text.includes(w.toLocaleLowerCase()))
          : words.every((w) => text.includes(w.toLocaleLowerCase())))
      );
    });
    if (v.tag || v.tagword) {
      ctx.warn(`${p.name}: タグ情報はローカル本文から取得できません`);
      return [];
    }
  }
  if (v.ignore === 'own') names = names.filter((s) => s !== own);
  else if (v.ignore) names = names.filter((s) => !s.includes(v.ignore));
  if (v.ignore_word) names = names.filter((s) => !s.includes(v.ignore_word));
  const sort =
    v.sort ||
    (/^recent/.test(p.name) ? 'timestamp' : p.name === 'list_newcreated' ? 'create' : 'pagename');
  names.sort((a, b) => {
    if (['timestamp', 'timeasc', 'timedesc', 'create'].includes(sort))
      return (
        (Date.parse(pages[a]?.[sort === 'create' ? 'created' : 'modified']) || 0) -
        (Date.parse(pages[b]?.[sort === 'create' ? 'created' : 'modified']) || 0)
      );
    return a.localeCompare(b, 'ja', { sensitivity: 'base', numeric: true });
  });
  if (
    v.sort2 === 'desc' ||
    sort === 'timedesc' ||
    flags.includes('reverse') ||
    (!v.sort2 && /^recent|^list_newcreated/.test(p.name))
  )
    names.reverse();
  const count = +v.limit || +flags.find((s) => /^\d+$/.test(s));
  const limit =
    p.name === 'include_by_search'
      ? Math.min(20, count || 1)
      : /^recent|^list_/.test(p.name)
        ? Math.min(100, count || 10)
        : 500;
  return names.slice(0, Math.max(1, limit));
}
function pagePlugin(p, ctx, depth, line) {
  if (!NAMES.includes(p.name)) return null;
  const { name, args } = p,
    { flags, values: v } = parameters(args),
    { options, link, warn } = ctx,
    pages = options.pages || {},
    own = options.pageName || '';
  const localLink = (label, target) => link(label, target, depth + 1);
  if (name === 'count_pages') return String(Object.keys(pages).length);
  if (name === 'count_childpages')
    return String(Object.keys(pages).filter((s) => s.startsWith(own + '/')).length);
  if (['link_toppage', 'link_nourl', 'link_edit', 'link_editmenu', 'link_editmenu2'].includes(name))
    return localLink(
      v.text || flags[0] || '開く',
      v.page ||
        { link_toppage: 'トップページ', link_editmenu: 'メニュー', link_editmenu2: 'メニュー2' }[
          name
        ] ||
        own,
    );
  if (name === 'link_pagelist')
    return `<details><summary>${esc(v.text || 'ページ一覧')}</summary><ul>${Object.keys(pages)
      .sort()
      .map((s) => `<li>${localLink(s, s)}</li>`)
      .join('')}</ul></details>`;
  if (['search', 'search2', 'search3'].includes(name))
    return `<div class="local-search"><label>ページ検索 <input type="search" data-local-search></label><ul>${Object.keys(
      pages,
    )
      .sort()
      .map(
        (s) =>
          `<li data-search-text="${esc(s + ' ' + pageText(pages[s]))}">${localLink(s, s)}</li>`,
      )
      .join('')}</ul></div>`;
  if (name.startsWith('random')) {
    let names = Object.keys(pages).filter((s) => !['メニュー', 'メニュー2'].includes(s));
    if (name === 'random') names = names.filter((s) => s.startsWith(own + '/'));
    if (name === 'random2') names = flags.filter((s) => Object.hasOwn(pages, s));
    if (!names.length) names = [own];
    if (name === 'random_page')
      return `<button type="button" data-random-pages="${esc(JSON.stringify(names))}">${esc(flags[0] || 'おまかせページ移動')}</button>`;
    const chosen = [];
    while (names.length && chosen.length < (name === 'random3' ? Math.min(30, +v.count || 1) : 1)) {
      const index = Math.min(
        names.length - 1,
        Math.floor((options.random?.() ?? Math.random()) * names.length),
      );
      chosen.push(names.splice(index, 1)[0]);
    }
    return chosen
      .map((s) => localLink(v.text || (name === 'random' ? flags[0] : null) || s, s))
      .join('<br>');
  }
  if (['date', 'time', 'update', 'lastmod', 'last_modified'].includes(name)) {
    if (v.pageid !== undefined) {
      warn(name + ': pageid はローカルでは使用できません');
      return '';
    }
    const bodyPage = parameters(p.body || '').values.page;
    const record =
        name === 'last_modified'
          ? Object.values(pages)
              .filter((p) => p?.modified)
              .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))[0]
          : pages[bodyPage || v.page || flags.find((s) => s.toLowerCase() !== 'j') || own],
      date = new Date(record?.modified);
    if (Number.isNaN(date.getTime())) {
      warn(`${name}: ファイルの更新日時がありません`);
      return '';
    }
    const pad = (n) => String(n).padStart(2, '0');
    if (v.format !== undefined) {
      if (!/^[YymndjHisD\/ :.-]+$/.test(v.format)) {
        warn(name + ': format が不正です');
        return '';
      }
      const tokens = {
        Y: date.getFullYear(),
        y: String(date.getFullYear()).slice(-2),
        m: pad(date.getMonth() + 1),
        n: date.getMonth() + 1,
        d: pad(date.getDate()),
        j: date.getDate(),
        H: pad(date.getHours()),
        i: pad(date.getMinutes()),
        s: pad(date.getSeconds()),
        D: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()],
      };
      return esc(v.format.replace(/[YymndjHisD]/g, (token) => tokens[token]));
    }
    if (name === 'time' && flags.some((s) => s.toLowerCase() === 'j'))
      return (
        pad(date.getHours()) + '時' + pad(date.getMinutes()) + '分' + pad(date.getSeconds()) + '秒'
      );
    return esc(
      name === 'time'
        ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        : require('./plugins').formatDate(
            date,
            name === 'lastmod' || flags.some((s) => s.toLowerCase() === 'j'),
            name === 'date',
          ),
    );
  }
  if (name === 'new3' || name === 'newimage') {
    const modified = pages[v.page || own]?.modified,
      age = (ctx.now - new Date(modified)) / 3600000;
    if (!modified) {
      warn(`${name}: ファイルの更新日時がありません`);
      return '';
    }
    if (Math.abs(age) > Math.min(1000, +v.time || 24)) return '';
    return require('./plugins').plugin(
      v.image
        ? { ...p, name: 'ref', args: v.image, body: null }
        : { ...p, name: 'new2', args: `${modified},${args}`, body: null },
      ctx,
      depth,
      line,
    );
  }
  if (name === 'redirect') {
    warn('redirect: 編集中の自動遷移をリンクに置き換えています');
    return localLink(v.text || flags[0] || '移動', (flags[0] || '') + (p.body ? '#' + p.body : ''));
  }
  if (name === 'pulldown_jump') {
    const choices = flags.map((s) => {
      const raw = s.replace(/^\[\[|\]\]$/g, ''),
        a = raw.split(/>>?/);
      return `<option value="${esc(a.at(-1))}">${esc(a[0])}</option>`;
    });
    return `<span class="page-jump"><label>${esc(v.title || 'ページを選択')}<select>${choices.join('')}</select></label><button type="button" data-page-jump>${esc(v.submit || '移動')}</button></span>`;
  }
  if (name === 'setmenu' || name === 'setmenu2')
    return `<aside class="local-menu">${ctx.includePage(flags[0] || (name === 'setmenu2' ? 'メニュー2' : 'メニュー'), depth, line)}</aside>`;
  if (name === 'include_by_search')
    return selectPages(p, ctx)
      .map((s) => {
        const heading = v.linktitle || v.showtitle,
          tag = /^h[1-6]$/.test(heading) ? heading : null;
        return (
          (tag ? `<${tag}>${v.linktitle ? localLink(s, s) : esc(s)}</${tag}>` : '') +
          ctx.includePage(s, depth, line)
        );
      })
      .join('');
  if (name === 'navi') {
    const base = flags[0] || own.split('/').slice(0, -1).join('/'),
      names = Object.keys(pages)
        .filter((s) => s.startsWith(base + '/'))
        .sort(),
      index = names.indexOf(own);
    return `<nav>${index > 0 ? localLink('前へ', names[index - 1]) : ''} | ${localLink('目次', base || own)} | ${index >= 0 && index < names.length - 1 ? localLink('次へ', names[index + 1]) : ''}</nav>`;
  }
  let names;
  if (name === 'related')
    names = linkedPages(pageText(pages[own]) || ctx.source).filter((s) => Object.hasOwn(pages, s));
  else if (name === 'yetlist') {
    const refs = new Map();
    for (const [from, page] of Object.entries(pages))
      for (const target of linkedPages(pageText(page)))
        if (!Object.hasOwn(pages, target)) {
          if (!refs.has(target)) refs.set(target, []);
          refs.get(target).push(from);
        }
    const entries = [...refs].slice(0, Math.min(100, +flags.find((s) => /^\d+$/.test(s)) || 50));
    return `<ul>${entries.map(([s, from]) => `<li>${localLink(s, s)}${flags.includes('ref') ? ' (' + from.map((f) => localLink(f, f)).join(', ') + ')' : ''}</li>`).join('')}</ul>`;
  } else names = selectPages(p, ctx);
  if (!names.length) return esc(v.errmsg || '');
  if (name === 'ls_line') return names.map((s) => localLink(s, s)).join(esc(v.sep || ' '));
  const item = (s) => {
    let result = localLink(s, s);
    if (name === 'ls2' && flags.includes('title')) {
      const roots = [],
        stack = [];
      pageText(pages[s])
        .split(/\r?\n/)
        .forEach((text, i) => {
          const m = text.match(/^(\*{1,5})(.*)$/);
          if (!m) return;
          const level = m[1].length;
          while (stack.length && stack.at(-1).level >= level) stack.pop();
          const anchor = m[2].match(/\[#([^\]]+)\]$/)?.[1] || 'heading-' + (i + 1);
          const node = { level, label: m[2].replace(/\s*\[#[^\]]+\]$/, ''), anchor, children: [] };
          (stack.at(-1)?.children || roots).push(node);
          stack.push(node);
        });
      const tree = (nodes) =>
        '<ul>' +
        nodes
          .map(
            (n) =>
              '<li>' +
              link(n.label, s + '#' + n.anchor, depth + 1, false, false, true) +
              (n.children.length ? tree(n.children) : '') +
              '</li>',
          )
          .join('') +
        '</ul>';
      result += tree(roots);
    }
    return result;
  };
  let html;
  if (name === 'ls3') {
    const tree = { children: new Map() };
    for (const s of names) {
      let node = tree;
      for (const part of s.split('/')) {
        if (!node.children.has(part)) node.children.set(part, { children: new Map() });
        node = node.children.get(part);
      }
      node.page = s;
    }
    const branch = (node) =>
      '<ul>' +
      [...node.children]
        .map(
          ([label, child]) =>
            `<li>${child.page ? localLink(label, child.page) : esc(label)}${child.children.size ? branch(child) : ''}</li>`,
        )
        .join('') +
      '</ul>';
    html = branch(tree);
  } else html = '<ul>' + names.map((s) => `<li>${item(s)}</li>`).join('') + '</ul>';
  return v.blockquote === '1' ? `<blockquote>${html}</blockquote>` : html;
}
module.exports = { pagePlugin, selectPages, NAMES, linkedPages };
