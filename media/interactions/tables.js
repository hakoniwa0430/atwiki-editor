'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AtWikiFeatures ||= {}).tables = factory();
})(globalThis, function () {
  function compare(a, b, direction = 1) {
    a = String(a).trim();
    b = String(b).trim();
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    const na = Number(a.replace(/,/g, '')),
      nb = Number(b.replace(/,/g, ''));
    if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * direction;
    if (/^\d{2,4}[/-]\d{1,2}[/-]\d{1,2}/.test(a) && /^\d{2,4}[/-]\d{1,2}[/-]\d{1,2}/.test(b)) {
      const da = Date.parse(a),
        db = Date.parse(b);
      if (Number.isFinite(da) && Number.isFinite(db)) return (da - db) * direction;
    }
    return a.localeCompare(b, 'ja', { numeric: true, sensitivity: 'base' }) * direction;
  }
  function sortTable(table, column, append = false) {
    const priorities = append ? JSON.parse(table.dataset.sortKeys || '[]') : [];
    const old = JSON.parse(table.dataset.sortKeys || '[]').find((k) => k.col === column);
    const direction = old ? -old.direction : 1;
    const keys = priorities.filter((k) => k.col !== column);
    keys.push({ col: column, direction });
    table.dataset.sortKeys = JSON.stringify(keys);
    for (const body of table.tBodies) {
      for (const repeated of body.querySelectorAll('[data-repeat]')) repeated.remove();
      const rows = [...body.rows],
        groups = [];
      let end = 0,
        group = [];
      rows.forEach((row, i) => {
        if (i >= end && group.length) {
          groups.push(group);
          group = [];
        }
        group.push(row);
        end = Math.max(end, i + 1, ...[...row.cells].map((c) => i + c.rowSpan));
      });
      if (group.length) groups.push(group);
      function cellText(group, col) {
        for (const row of group)
          for (const cell of row.cells) {
            const start = Number(cell.dataset.column);
            if (start <= col && start + cell.colSpan > col)
              return cell.textContent.replace(/ ▲▼$/, '');
          }
        return '';
      }
      const compareGroups = (a, b) => {
        for (const key of keys) {
          const diff = compare(cellText(a, key.col), cellText(b, key.col), key.direction);
          if (diff) return diff;
        }
        return 0;
      };
      // Header rows are barriers; merged rows stay in one sortable group.
      for (let start = 0; start < groups.length; ) {
        if (groups[start][0].dataset.header) {
          start++;
          continue;
        }
        let end = start;
        while (end < groups.length && !groups[end][0].dataset.header) end++;
        groups.splice(start, end - start, ...groups.slice(start, end).sort(compareGroups));
        start = end;
      }
      for (const group of groups) for (const row of group) body.append(row);
      const n = +table.dataset.repeathead,
        head = table.tHead?.rows[0] || rows.find((r) => r.dataset.header);
      if (n > 0 && head) {
        let count = 0;
        for (const group of groups) {
          if (count && count % n === 0 && !group[0].dataset.header) {
            const copy = head.cloneNode(true);
            copy.dataset.repeat = 'true';
            for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id');
            body.insertBefore(copy, group[0]);
          }
          count += group.length;
        }
      }
    }
    for (const cell of table.querySelectorAll('[data-sort]'))
      cell.setAttribute(
        'aria-sort',
        +cell.dataset.sort === column ? (direction === 1 ? 'ascending' : 'descending') : 'none',
      );
    if (table.dataset.stripes) {
      const stripes = JSON.parse(table.dataset.stripes);
      let i = 0;
      for (const row of table.rows) {
        if (row.dataset.repeat) continue;
        const stripe =
          stripes.all || !row.dataset.header ? (++i % 2 ? stripes.odd : stripes.even) || '' : '';
        for (const cell of row.cells)
          if (cell.dataset.baseStyle !== undefined)
            cell.setAttribute('style', stripe + cell.dataset.baseStyle);
      }
    }
    if (table.dataset.numbering) {
      const p = JSON.parse(table.dataset.numbering);
      let n = Number.isFinite(+p.start) ? +p.start : 1;
      const inc = Number.isFinite(+p.inc) ? +p.inc : 1;
      for (const cell of table.querySelectorAll('[data-sequence]')) {
        if (!cell.dataset.sequenceSkip) {
          cell.textContent = String(n);
          n += inc;
        }
      }
    }
  }
  function initialize(container, send, scope) {
    scope.on(container, 'change', (event) => {
      const input = event.target.closest('input[data-table]');
      if (!input) return;
      const table = document.getElementById(input.dataset.table);
      if (!table) return;
      const controls = [...container.querySelectorAll('input[data-table]')].filter(
        (el) => el.dataset.table === input.dataset.table,
      );
      for (const cell of table.querySelectorAll('[data-column]')) {
        const start = +cell.dataset.column,
          cols = Array.from({ length: cell.colSpan }, (_, i) => start + i);
        cell.hidden = cols.every((col) =>
          controls.some((c) => +c.dataset.column === col && !c.checked),
        );
      }
    });
    scope.on(container, 'keydown', (event) => {
      if (event.target.matches('[data-sort]') && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        sortTable(event.target.closest('table'), +event.target.dataset.sort, event.shiftKey);
      }
    });
    scope.on(container, 'click', (event) => {
      const el = event.target.closest('[data-sort]');
      if (el) sortTable(el.closest('table'), +el.dataset.sort, event.shiftKey);
    });
  }

  return { compare, sortTable, initialize };
});
