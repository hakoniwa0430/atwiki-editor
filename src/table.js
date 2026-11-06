'use strict';
const {
  escapeHtml: esc,
  splitTop,
  parameters,
  colorValue,
  lengthValue,
  decoration,
} = require('./syntax');

function cellSpec(text) {
  const heading = text.startsWith('~') && text.length > 1;
  let style = '',
    rest = heading ? text.slice(1) : text,
    match;
  while (
    (match = rest.match(
      /^(LEFT|CENTER|RIGHT|BGCOLOR\(([^)]*)\)|COLOR\(([^)]*)\)|SIZE\(([^)]*)\)|(?:WIDTH\()?([0-9]+)(?:\))?):/i,
    ))
  ) {
    const key = match[1].toUpperCase();
    if (['LEFT', 'CENTER', 'RIGHT'].includes(key)) style += `text-align:${key.toLowerCase()};`;
    else if (key.startsWith('BGCOLOR') && colorValue(match[2]))
      style += `background-color:${colorValue(match[2])};`;
    else if (key.startsWith('COLOR') && colorValue(match[3]))
      style += `color:${colorValue(match[3])};`;
    else if (key.startsWith('SIZE') && lengthValue(match[4]))
      style += `font-size:${lengthValue(match[4])};`;
    else if (match[5]) style += `width:${match[5]}px;`;
    rest = rest.slice(match[0].length);
  }
  return { text: (heading ? '~' : '') + rest, style };
}
function renderTable(lines, configs, ctx) {
  const { inline, warn, id } = ctx,
    tableId = id('table');
  const rows = [],
    styles = { columns: Object.create(null) },
    filters = Object.create(null);
  let templates = [],
    previous = [],
    sorter = null,
    numbering = null,
    filterMode = '',
    stripeIndex = 0;
  for (const config of configs) {
    const p = parameters(config.args),
      body = parameters(config.body || '');
    if (config.name === 'table_style' || config.name === 'table_color') {
      styles.head = p.values.head
        ? decoration(p.values.head, warn)
        : p.flags[0] && colorValue(p.flags[0])
          ? `background-color:${p.flags[0]};`
          : '';
      styles.hover = p.values.hover
        ? decoration(p.values.hover, warn)
        : p.flags[1] && colorValue(p.flags[1])
          ? `background-color:${p.flags[1]};`
          : '';
      Object.assign(
        styles.columns,
        Object.fromEntries(
          Object.entries(body.values).map(([key, value]) => [key, decoration(value, warn)]),
        ),
      );
    }
    if (config.name === 'table_filter') {
      Object.assign(filters, body.values);
      filterMode = p.flags.find((v) => v === 'pc' || v === 'sp') || '';
    }
    if (config.name === 'table_zebra') {
      const colors = p.flags.filter(colorValue);
      styles.odd = colors[0] ? `background-color:${colors[0]};` : '';
      styles.even = colors[1] ? `background-color:${colors[1]};` : '';
      if (colors[2]) styles.head = `background-color:${colors[2]};`;
      styles.zebraAll = !colors[2];
    }
    if (config.name === 'table_sorter') {
      sorter = body.values;
      if (sorter.zebra === '1') {
        styles.odd = 'background-color:#f0f0f0;';
        styles.even = 'background-color:#ffffff;';
      }
      for (const key of ['head', 'odd', 'even'])
        if (colorValue(sorter[key])) styles[key] = `background-color:${sorter[key]};`;
    }
    if (config.name === 'table_autoincrement') numbering = body.values;
  }
  for (const line of lines) {
    const type = line.text.match(/\|([hfc]?)$/)[1];
    const cells = splitTop(line.text.slice(1, type ? -2 : -1), '|').map(cellSpec);
    if (type === 'c') {
      templates = cells.map((c) => c.style + (/^\d+$/.test(c.text) ? `width:${c.text}px;` : ''));
      continue;
    }
    const group = type === 'h' ? 'head' : type === 'f' ? 'foot' : 'body';
    if (rows.length && rows.at(-1).group !== group) previous = [];
    const row = {
      cells: [],
      line: line.line,
      group,
      header: type === 'h' || cells.every((c) => c.text.startsWith('~') && c.text !== '~'),
    };
    const grid = [];
    let col = 0;
    while (col < cells.length) {
      let span = 1,
        start = col;
      while (cells[col]?.text === '>' && col < cells.length - 1) {
        span++;
        col++;
      }
      const spec = cells[col];
      if (spec.text === '~') {
        const above = previous[start];
        if (
          above &&
          above.col === start &&
          above.colspan === span &&
          Array.from({ length: span }, (_, n) => previous[start + n]).every((c) => c === above)
        ) {
          above.rowspan++;
          for (let c = start; c < start + span; c++) grid[c] = above;
          col++;
          continue;
        }
        // A colspan continuation may be represented by one ~ per occupied column.
        if (
          above &&
          above.col === start &&
          span === 1 &&
          above.colspan > 1 &&
          cells.slice(start, start + above.colspan).length === above.colspan &&
          cells.slice(start, start + above.colspan).every((c) => c.text === '~')
        ) {
          above.rowspan++;
          for (let c = start; c < start + above.colspan; c++) grid[c] = above;
          col += above.colspan;
          continue;
        }
        warn(`表の縦結合先が不正です（${line.line + 1}行目）`);
      }
      if (spec.text === '>') warn(`表の横結合先がありません（${line.line + 1}行目）`);
      const header = type === 'h' || (spec.text.startsWith('~') && spec.text.length > 1);
      const cell = {
        col: start,
        colspan: span,
        rowspan: 1,
        header,
        text: header && spec.text.startsWith('~') ? spec.text.slice(1) : spec.text,
        style: templates[start] || '',
      };
      cell.style += spec.style;
      row.cells.push(cell);
      for (let c = start; c < start + span; c++) grid[c] = cell;
      col++;
    }
    previous = grid;
    rows.push(row);
  }
  const header = rows.find((r) => r.header),
    names = [];
  if (header)
    for (const c of header.cells) for (let n = 0; n < c.colspan; n++) names[c.col + n] = c.text;
  if ((sorter || Object.keys(filters).length) && !header)
    warn('table_sorter/table_filter に見出し行が必要です');
  let controls = '';
  if (!filterMode || filterMode === (ctx.mode === 'mobile' ? 'sp' : 'pc')) {
    controls = Object.entries(filters)
      .map(([name, state]) => {
        const col = names.indexOf(name);
        if (col < 0) {
          warn(`table_filter の列が見つかりません: ${name}`);
          return '';
        }
        if (!['show', 'hide'].includes(state)) warn(`table_filter の指定が不正です: ${state}`);
        return `<label><input type="checkbox" data-table="${tableId}" data-column="${col}"${state === 'hide' ? '' : ' checked'}>${esc(name)}</label>`;
      })
      .join(' ');
  }
  let seq = Number.isFinite(+numbering?.start) ? +numbering.start : 1;
  const inc = Number.isFinite(+numbering?.inc) ? +numbering.inc : 1,
    skip = Math.max(0, +numbering?.skip || 0);
  const rowHtml = (row, index, repeated = false) => {
    const stripe =
      styles.zebraAll || !row.header ? (++stripeIndex % 2 ? styles.odd : styles.even) || '' : '';
    let cells = '';
    if (numbering)
      cells += row.header
        ? `<th>${esc(numbering.label || '')}</th>`
        : `<td data-sequence${index < skip ? ' data-sequence-skip="true"' : ''}>${index < skip ? '' : seq}</td>`;
    if (numbering && !row.header && index >= skip) seq += inc;
    cells += row.cells
      .map((cell) => {
        const tag = cell.header ? 'th' : 'td',
          colStyle = styles.columns[names[cell.col]] || '';
        const hidden =
          (!filterMode || filterMode === (ctx.mode === 'mobile' ? 'sp' : 'pc')) &&
          Array.from({ length: cell.colspan }, (_, i) => filters[names[cell.col + i]]).every(
            (state) => state === 'hide',
          );
        const style = stripe + colStyle + (cell.header ? styles.head || '' : '') + cell.style;
        cell.baseStyle = colStyle + (cell.header ? styles.head || '' : '') + cell.style;
        return `<${tag} data-column="${cell.col}"${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}${hidden ? ' hidden' : ''}${style ? ` style="${esc(style)}"` : ''}${sorter && cell.header ? ` tabindex="0" role="button" data-sort="${cell.col}" aria-label="${esc(cell.text)}で並べ替え"` : ''}>${ctx.atLine ? ctx.atLine(row.line, () => inline(cell.text)) : inline(cell.text)}${sorter && cell.header ? '<span aria-hidden="true" class="sort-indicator"> ▲▼</span>' : ''}</${tag}>`;
      })
      .join('');
    if (sorter && (styles.odd || styles.even)) {
      let n = 0;
      cells = cells.replace(/<(td|th) data-column=/g, (tag) =>
        tag.replace(
          ' data-column=',
          ` data-base-style="${esc(row.cells[n++].baseStyle)}" data-column=`,
        ),
      );
    }
    return `<tr data-line="${row.line}"${row.header ? ' data-header="true"' : ''}${repeated ? ' data-repeat="true"' : ''}>${cells}</tr>`;
  };
  // Preserve source order within each HTML table section. Cross-section rowspans were rejected above.
  let html = controls
    ? `<fieldset class="table-filters"><legend>表示する列</legend>${controls}</fieldset>`
    : '';
  if (styles.hover)
    html += `<style>#${tableId} tr:hover > td,#${tableId} tr:hover > th{${styles.hover}}</style>`;
  html += `<div class="table-scroll" data-line="${lines[0].line}"><table id="${tableId}"${sorter ? ' data-sortable="true"' : ''}${sorter && (styles.odd || styles.even) ? ` data-stripes="${esc(JSON.stringify({ odd: styles.odd, even: styles.even, all: !!styles.zebraAll }))}"` : ''}${numbering ? ` data-numbering="${esc(JSON.stringify(numbering))}"` : ''}${sorter?.repeathead ? ` data-repeathead="${Math.max(0, +sorter.repeathead || 0)}"` : ''}>`;
  for (const [group, tag] of [
    ['head', 'thead'],
    ['body', 'tbody'],
    ['foot', 'tfoot'],
  ]) {
    const selected = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.group === group);
    if (selected.length)
      html += `<${tag}>${selected
        .map(({ r, i }, n) => {
          const crossed = selected
            .slice(0, n)
            .some(({ r }, j) => r.cells.some((c) => j + c.rowspan > n));
          const repeat =
            group === 'body' &&
            header &&
            +sorter?.repeathead > 0 &&
            n > 0 &&
            n % +sorter.repeathead === 0 &&
            !crossed;
          return (repeat ? rowHtml(header, i, true) : '') + rowHtml(r, i);
        })
        .join('')}</${tag}>`;
  }
  return html + '</table></div>';
}
module.exports = { renderTable, cellSpec };
