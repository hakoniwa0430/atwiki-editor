'use strict';
const path = require('node:path');
const { pageNameFromFile, filePageRoot } = require('./page-context');
const { LOCAL_NAMES } = require('./plugins');
const { splitTop } = require('./syntax');
const names = [...new Set(LOCAL_NAMES)].sort();
// Only options consumed by the renderer belong here.
const options = {
  youtube: 'width= height=',
  u2b: 'width= height=',
  video: 'width= height=',
  nicovideo: 'width= height=',
  nicovideo2: 'width= height=',
  discord_widget: 'id= theme= width= height=',
  showrss: 'showdate linelimit= charnum= countrss lasttime',
  rss: 'showdate linelimit= charnum= countrss lasttime',
  image:
    'page= width= height= x= y= alt= title= linkpage= border= percent= inline left center right float',
  ref: 'page= width= height= alt= title= linkpage= border= inline left center right',
  lightbox: 'page= width= height= percent= title= link=',
  blankimg: 'page= width= height= title=',
  slide_img: 'width= height= auto= position=',
  img_slide: 'width= height= auto= position=',
  link2: 'title= color= bgcolor= bordercolor= target= button',
  link_anchor: 'page= anchor_only= img=',
  aname: 'option=',
  region: 'open closed remember',
  ls2: 'title reverse',
  link_atwiki: 'target=',
  contents: 'level= depth=',
  contents_line: 'level= depth=',
  openclose: 'show= block',
  openclose2: 'show= inline',
  treemenu: 'title= mark= treeline= none',
  infobox: 'title= url= link= gravity= size= animation= trigger= opacity=',
  marquee: 'scroll slide alternate left right size= loop= color= bgcolor=',
  div: 'id= class= width= height= color= bgcolor=',
  hr: 'width= height= color=',
  memo: 'rows= cols=',
  calendar: 'lang= option=',
  highlight: 'linenumber',
  presen: 'incremental',
  exkp: 'k p',
  gaugeset: 'limit= char= back= bgcol= col1= col2= col3= col4= col5= col6= col7= col8= col9=',
  table_style: 'head= hover=',
  table_color: 'head= hover=',
  table_filter: 'pc sp',
};
for (const [alias, original] of Object.entries({
  image2: 'image',
  random_img: 'image',
  link_aname: 'link_anchor',
  anchor: 'aname',
  treemenu2: 'treemenu',
  treemenu3: 'treemenu',
  memox: 'memo',
  codehighlight: 'highlight',
}))
  options[alias] = options[original];
const bodyOptions = {
  table_sorter_body: 'zebra=',
  table_autoincrement_body: 'start= inc=',
  table_filter_body: '列名=',
};
const descriptions = {
  width: '表示幅',
  height: '表示高さ',
  trigger: 'click / hover',
  start: '開始番号',
  page: '参照するローカルページ',
  title: '表示名・説明',
  alt: '画像の代替テキスト',
  color: '文字色',
  bgcolor: '背景色',
  linkpage: '画像のリンク先',
  anchor_only: 'trueで現在のページ内へ移動',
  option: 'aname: nolink / calendar: link',
  level: '見出しの最大階層',
  depth: '見出しの最大階層',
  show: '表示する文字',
  head: '見出しの装飾',
  hover: 'マウスを置いた行の装飾',
};

function activeArgument(text) {
  const stack = [];
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\' && (quote || /[=,(]/.test(text[i - 1] || ''))) {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if ('([{'.includes(c)) {
      const match = c === '(' && text.slice(0, i).match(/[&#](\w+)$/);
      stack.push({
        delimiter: c,
        name: match?.[1],
        start: match ? i - match[0].length : i,
        argsStart: i + 1,
      });
    } else if (')]}'.includes(c) && stack.at(-1)?.delimiter === '([{'[')]}'.indexOf(c)])
      stack.pop();
  }
  return stack.filter((s) => s.name).at(-1);
}
function query(prefix) {
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (/^\s*\/\//.test(line)) return null;
  const wiki = prefix.match(/\[\[([^\]]*)$/);
  const context = activeArgument(prefix);
  const tableBody = prefix.match(/#(table_sorter|table_autoincrement|table_filter)\(\)\{([^}]*)$/);
  if (tableBody)
    return {
      type: 'option',
      name: tableBody[1] + '_body',
      value: tableBody[2].split(/[\n,]/).at(-1).trimStart(),
    };
  if (wiki && (!context || wiki.index > context.start))
    return { type: 'page', value: wiki[1].split(/>>?/).at(-1) };
  const plugin = prefix.match(/[&#](\w*)$/);
  if (plugin) return { type: 'plugin', value: plugin[1] };
  if (!context) return null;
  const parts = splitTop(prefix.slice(context.argsStart));
  const value = parts.at(-1).trimStart();
  if (/^(page|linkpage)=/.test(value))
    return { type: 'page', value: value.slice(value.indexOf('=') + 1) };
  if (
    ['table_edit', 'include', 'inc', 'include_cache', 'include_random', 'splitinclude'].includes(
      context.name,
    )
  )
    return { type: 'page', value };
  if (['link_anchor', 'link_aname'].includes(context.name) && parts.length === 1)
    return { type: 'anchor', value };
  if (
    ['image', 'image2', 'ref', 'lightbox', 'blankimg'].includes(context.name) &&
    parts.length === 1
  )
    return { type: 'image', value };
  return { type: 'option', name: context.name, value };
}
function anchors(text) {
  // Use explicit site-compatible anchors, not preview-only generated heading IDs.
  const values = [];
  for (const m of text.matchAll(/&(?:aname|anchor)\(\s*([^,)]+)|^\*+[^\n]*\[#([^\]\n]+)\]\s*$/gm))
    values.push((m[1] || m[2]).trim());
  for (const m of text.matchAll(/^\*{1,5}([^\n]+)/gm))
    values.push(m[1].replace(/\s*\[#[^\]]+\]$/, '').trim());
  return [...new Set(values)];
}
function candidates(prefix, { pages = {}, images = [], ownText = '', pageName = '' } = {}) {
  const q = query(prefix);
  if (!q) return [];
  let items = [],
    value = q.value;
  if (q.type === 'plugin') items = names.map((name) => [name, '対応済みのアットウィキ記法']);
  if (q.type === 'option')
    items = (options[q.name] || bodyOptions[q.name] || '')
      .split(' ')
      .filter(Boolean)
      .map((s) => [s, descriptions[s.replace(/=$/, '')] || `${q.name} の対応オプション`]);
  if (q.type === 'option' && q.name === 'ref')
    items.push(...Object.keys(pages).map((s) => [s, 'ローカルページ']));
  if (q.type === 'image') {
    const folder = path.posix.dirname(pageName || '.');
    items = images.map((name) => [path.posix.relative(folder, name), 'ローカル画像']);
  }
  if (q.type === 'page' || q.type === 'anchor') {
    const hash = q.type === 'anchor' ? 0 : value.indexOf('#');
    if (hash >= 0) {
      const page =
        q.type === 'anchor' ? '' : value.slice(0, hash).replace(/\.(atwiki|atw|txt)$/i, '');
      const entry = !page || page === pageName ? ownText : pages[page];
      value = q.type === 'anchor' ? value : value.slice(hash + 1);
      items = anchors(typeof entry === 'string' ? entry : entry?.text || '').map((s) => [
        s,
        '明示アンカー',
      ]);
    } else items = Object.keys(pages).map((s) => [s, 'ローカルページ']);
  }
  return items
    .filter(([s]) => s.startsWith(value))
    .map(([label, detail]) => ({ label, insertText: label, detail, replace: value.length }));
}
function registerCompletion(vscode, context, index, pageRoots) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'atwiki' }, { language: 'plaintext', pattern: '**/*.txt', scheme: 'file' }],
      {
        async provideCompletionItems(document, position, token) {
          const prefix = !document.lineAt
            ? document.getText(new vscode.Range(0, 0, position.line, position.character))
            : Array.from({ length: position.line + 1 }, (_, i) =>
                document
                  .lineAt(i)
                  .text.slice(0, i === position.line ? position.character : undefined),
              ).join('\n');
          const q = query(prefix);
          if (!q || token?.isCancellationRequested) return [];
          let data = { ownText: document.getText() };
          if (['page', 'image', 'anchor'].includes(q.type) && document.uri.scheme === 'file') {
            const root = filePageRoot(vscode, document, pageRoots);
            const release = index.retain(root, () => {});
            try {
              data = {
                ...(await index.get(root)),
                ...data,
                pageName: pageNameFromFile(root, document.fileName),
              };
              data.pages = { ...data.pages, [data.pageName]: data.ownText };
            } catch {
              /* Syntax completion remains usable when a folder cannot be read. */
            } finally {
              release();
            }
          }
          if (token?.isCancellationRequested) return [];
          return candidates(prefix, data)
            .filter((entry) => entry.replace <= position.character)
            .map((entry) => {
              const item = new vscode.CompletionItem(entry.label);
              item.insertText = entry.insertText;
              item.detail = entry.detail;
              item.range = new vscode.Range(
                position.line,
                position.character - entry.replace,
                position.line,
                position.character,
              );
              return item;
            });
        },
      },
      '#',
      '&',
      '[',
      '>',
      '(',
      ',',
      '=',
      '/',
    ),
  );
}
module.exports = { candidates, registerCompletion, names, options, query, descriptions };
