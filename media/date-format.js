'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtWikiDateFormat = factory();
})(globalThis, function () {
  function formatDate(date, japanese = false, dateOnly = false) {
    const pad = (n) => String(n).padStart(2, '0'),
      y = date.getFullYear(),
      m = pad(date.getMonth() + 1),
      d = pad(date.getDate()),
      time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    return japanese
      ? `${y}年${m}月${d}日 (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})${dateOnly ? '' : ' ' + time}`
      : `${y}-${m}-${d}${dateOnly ? '' : ' ' + time} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]})`;
  }

  return { formatDate };
});
