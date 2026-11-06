'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AtWikiFeatures ||= {}).presentation = factory();
})(globalThis, function () {
  function click(el, container, send, scope) {
    if (el.hasAttribute('data-present')) {
      const template = el.nextElementSibling;
      const source = template?.hasAttribute('data-presentation-source')
        ? template.content
        : container;
      const headings = [...source.querySelectorAll('h2')];
      if (!headings.length) return;
      const dialog = document.createElement('dialog');
      dialog.className = 'presentation';
      const close = document.createElement('button');
      close.textContent = '閉じる';
      close.onclick = () => dialog.close();
      const previous = document.createElement('button');
      previous.textContent = '前へ';
      const next = document.createElement('button');
      next.textContent = '次へ';
      const body = document.createElement('section');
      body.className = 'slide-body';
      let index = 0;
      function show() {
        body.replaceChildren();
        let node = headings[index];
        while (node) {
          if (node !== headings[index] && node.tagName === 'H2') break;
          body.append(node.cloneNode(true));
          node = node.nextElementSibling;
        }
        if (el.dataset.incremental === 'true')
          for (const li of body.querySelectorAll('li')) li.hidden = true;
        previous.disabled = index === 0;
      }
      previous.onclick = () => {
        if (index > 0) {
          index--;
          show();
        }
      };
      next.onclick = () => {
        const hidden = body.querySelector('li[hidden]');
        if (hidden) {
          hidden.hidden = false;
          return;
        }
        if (index < headings.length - 1) {
          index++;
          show();
        }
      };
      dialog.addEventListener('close', () => dialog.remove());
      dialog.append(close, previous, next, body);
      document.body.append(dialog);
      show();
      scope.add(() => dialog.remove());
      dialog.showModal();
    }
  }

  return { click };
});
