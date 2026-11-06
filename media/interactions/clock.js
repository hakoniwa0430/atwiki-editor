'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../date-format'));
  else (root.AtWikiFeatures ||= {}).clock = factory(root.AtWikiDateFormat);
})(globalThis, function ({ formatDate }) {
  function initialize(container, send, scope) {
    if (!container.querySelectorAll('[data-clock]').length) return;
    const timer = setInterval(() => {
      const date = new Date();
      for (const el of container.querySelectorAll('[data-clock]')) {
        el.textContent = formatDate(
          date,
          el.dataset.japanese === 'true',
          el.dataset.clock === 'today',
        );
      }
    }, 1000);
    scope.add(() => clearInterval(timer));
  }

  return { initialize };
});
