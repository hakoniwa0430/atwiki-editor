'use strict';
(function (root, factory) {
  const features =
    typeof module === 'object' && module.exports
      ? {
          tables: require('./interactions/tables'),
          calculator: require('./interactions/calculator'),
          calendar: require('./interactions/calendar'),
          images: require('./interactions/images'),
          presentation: require('./interactions/presentation'),
          clock: require('./interactions/clock'),
          external: require('./interactions/external'),
        }
      : root.AtWikiFeatures;
  const api = factory(features);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtWikiInteractions = api;
})(globalThis, function (features) {
  function initialize(container, send) {
    const disposers = [];
    const scope = {
      add(dispose) {
        disposers.push(dispose);
      },
      on(target, type, listener) {
        target.addEventListener(type, listener);
        this.add(() => target.removeEventListener(type, listener));
      },
    };
    const cleanup = () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
    try {
      scope.on(container, 'input', (event) => {
        if (event.target.matches('[data-local-search]')) {
          const word = event.target.value.toLocaleLowerCase();
          for (const li of event.target
            .closest('.local-search')
            .querySelectorAll('[data-search-text]'))
            li.hidden = !li.dataset.searchText.toLocaleLowerCase().includes(word);
        }
      });
      scope.on(container, 'click', (event) => {
        const el = event.target.closest('button,[data-sort]');
        if (!el) return;
        if (el.hasAttribute('data-toggle')) {
          const content = el.nextElementSibling;
          content.hidden = !content.hidden;
          el.setAttribute('aria-expanded', String(!content.hidden));
        }
        if (el.hasAttribute('data-infobox')) {
          const box = el.closest('.infobox');
          box.classList.toggle('is-open');
          el.setAttribute('aria-expanded', String(box.classList.contains('is-open')));
        }
        if (el.hasAttribute('data-page-jump')) {
          const select = el.parentElement.querySelector('select');
          if (select?.value)
            send(
              /^https?:\/\//.test(select.value)
                ? { type: 'external', url: select.value }
                : { type: 'page', page: select.value },
            );
        }
        if (el.hasAttribute('data-random-pages')) {
          const names = JSON.parse(el.dataset.randomPages);
          if (names.length)
            send({ type: 'page', page: names[Math.floor(Math.random() * names.length)] });
        }
        if (el.hasAttribute('data-reveal')) send({ type: 'reveal', line: +el.dataset.reveal });
        if (el.hasAttribute('data-action')) send({ type: el.dataset.action });
        if (el.hasAttribute('data-mode')) send({ type: 'mode', mode: el.dataset.mode });
        if (el.hasAttribute('data-google-search'))
          send({
            type: 'external',
            url:
              'https://www.google.com/search?q=' +
              encodeURIComponent(el.parentElement.querySelector('input').value),
          });
        for (const feature of Object.values(features)) feature.click?.(el, container, send, scope);
      });
      for (const feature of Object.values(features)) feature.initialize?.(container, send, scope);
      return cleanup;
    } catch (error) {
      cleanup();
      throw error;
    }
  }
  return {
    initialize,
    compare: features.tables.compare,
    sortTable: features.tables.sortTable,
    calculate: features.calculator.calculate,
  };
});
