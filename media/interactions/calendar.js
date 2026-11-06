'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AtWikiFeatures ||= {}).calendar = factory();
})(globalThis, function () {
  function calendar(el) {
    const year = +el.dataset.year,
      month = +el.dataset.month,
      english = el.dataset.language === 'en';
    const title = el.querySelector('.calendar-title');
    title.textContent = `${year} / ${month + 1}`;
    const table = document.createElement('table'),
      head = table.createTHead().insertRow();
    for (const name of english
      ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['日', '月', '火', '水', '木', '金', '土']) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    const body = table.createTBody(),
      first = new Date(year, month, 1).getDay(),
      days = new Date(year, month + 1, 0).getDate();
    let row;
    for (let i = 0; i < Math.ceil((first + days) / 7) * 7; i++) {
      if (i % 7 === 0) row = body.insertRow();
      const cell = row.insertCell(),
        day = i - first + 1;
      if (day < 1 || day > days) continue;
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const page = (el.dataset.prefix ? el.dataset.prefix + '/' : '') + date;
      if (el.dataset.forceLinks === 'true' || JSON.parse(el.dataset.pages || '[]').includes(page)) {
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.page = page;
        a.textContent = String(day);
        cell.append(a);
      } else cell.textContent = String(day);
    }
    el.querySelector('.calendar-grid').replaceChildren(table);
  }
  function initialize(container) {
    for (const el of container.querySelectorAll('.calendar')) calendar(el);
  }
  function click(el) {
    if (el.hasAttribute('data-month-step')) {
      const cal = el.closest('.calendar'),
        date = new Date(+cal.dataset.year, +cal.dataset.month + +el.dataset.monthStep, 1);
      cal.dataset.year = date.getFullYear();
      cal.dataset.month = date.getMonth();
      calendar(cal);
    }
  }

  return { initialize, click };
});
