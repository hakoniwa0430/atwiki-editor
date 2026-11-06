'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AtWikiFeatures ||= {}).images = factory();
})(globalThis, function () {
  function click(el, container, send, scope) {
    if (el.hasAttribute('data-image')) {
      const dialog = document.createElement('dialog'),
        image = document.createElement('img'),
        close = document.createElement('button');
      image.src = el.dataset.image;
      image.alt = el.getAttribute('aria-label') || '';
      close.textContent = '閉じる';
      close.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove());
      dialog.append(close, image);
      document.body.append(dialog);
      scope.add(() => dialog.remove());
      dialog.showModal();
    }
    const slides = el.closest('.image-slides');
    if (slides && (el.hasAttribute('data-slide-step') || el.hasAttribute('data-slide-play'))) {
      const step = (n) => {
        const items = [...slides.querySelector('.slide-items').children];
        if (!items.length) return;
        const i = ((+slides.dataset.slide || 0) + n + items.length) % items.length;
        slides.dataset.slide = i;
        items.forEach((el, k) => (el.hidden = k !== i));
      };
      if (el.hasAttribute('data-slide-step')) step(+el.dataset.slideStep);
      else if (slides._timer) {
        clearInterval(slides._timer);
        slides._timer = null;
      } else {
        slides._timer = setInterval(() => step(1), +slides.dataset.interval || 3000);
        scope.add(() => {
          clearInterval(slides._timer);
          slides._timer = null;
        });
      }
    }
  }
  function initialize(container) {
    for (const slides of container.querySelectorAll('.image-slides[data-auto="true"]'))
      slides.querySelector('[data-slide-play]').click();
  }

  return { click, initialize };
});
