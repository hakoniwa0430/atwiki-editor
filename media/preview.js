'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const content = document.getElementById('content');
  const saved = vscode.getState() || {};
  const messageToken = document.querySelector('meta[name="atwiki-message-token"]')?.content;
  let first = true;
  let cleanup = () => {};
  let pendingAnchor = '';
  function revealAnchor(anchor) {
    const target =
      document.getElementById(anchor) ||
      [...content.querySelectorAll('h2,h3,h4,h5,h6')].find(
        (el) => el.textContent.trim() === anchor,
      );
    if (!target) return;
    let parent = target.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    target.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('message', (event) => {
    const message = event.data;
    // VS Code forwards from a host frame while masking window.parent as window.
    // Authenticate the payload instead of comparing event.source with window.
    if (!messageToken || !message || typeof message !== 'object' || message.token !== messageToken)
      return;
    if (message.type === 'error') {
      document.getElementById('status').textContent = `表示エラー: ${message.message}`;
      return;
    }
    try {
      if (message.type === 'anchor') {
        pendingAnchor = message.anchor;
        revealAnchor(pendingAnchor);
      }
      if (message.type === 'render') {
        const top = first ? saved.scroll || 0 : window.scrollY;
        const expanded = new Map(
          [...content.querySelectorAll('details[data-line]')].map((el) => [
            el.dataset.line,
            el.open,
          ]),
        );
        cleanup();
        content.innerHTML = `<article class="atwiki-contents">${message.html}</article>`;
        for (const detail of content.querySelectorAll('details[data-line]'))
          if (
            detail.dataset.remember &&
            Object.hasOwn(message.remembered || {}, detail.dataset.remember)
          )
            detail.open = message.remembered[detail.dataset.remember];
          else if (expanded.has(detail.dataset.line))
            detail.open = expanded.get(detail.dataset.line);
        cleanup = AtWikiInteractions.initialize(content.firstElementChild, (message) =>
          vscode.postMessage(message),
        );
        document.body.className = ['uikit', 'paper', 'editor'].includes(message.theme)
          ? message.theme
          : 'uikit';
        document.getElementById('filename').textContent = message.name;
        document.getElementById('status').textContent = `${message.lines} 行 · 更新済み`;
        const list = document.getElementById('warning-list');
        list.replaceChildren(
          ...message.warnings.map((warning) => {
            const li = document.createElement('li');
            const diagnostic = message.diagnostics?.find((d) => d.message === warning);
            if (diagnostic) {
              const button = document.createElement('button');
              button.textContent = warning;
              button.addEventListener('click', () =>
                vscode.postMessage(
                  diagnostic.page
                    ? { type: 'page', page: diagnostic.page, line: diagnostic.line }
                    : { type: 'reveal', line: diagnostic.line },
                ),
              );
              li.appendChild(button);
            } else li.textContent = warning;
            return li;
          }),
        );
        document.getElementById('warnings').hidden = message.warnings.length === 0;
        document.getElementById('warning-count').textContent = `(${message.warnings.length})`;
        window.scrollTo(0, top);
        if (pendingAnchor) {
          revealAnchor(pendingAnchor);
          pendingAnchor = '';
        }
        first = false;
      }
      if (message.type === 'scroll') {
        const elements = [...content.querySelectorAll('[data-line]')];
        const el =
          elements.find((el) => Number(el.dataset.line) >= message.line) || elements.at(-1);
        if (el) {
          let parent = el.parentElement;
          while (parent && parent !== content) {
            if (parent.tagName === 'DETAILS') parent.open = true;
            parent = parent.parentElement;
          }
          el.scrollIntoView({ block: 'start' });
        }
      }
    } catch (error) {
      document.getElementById('status').textContent = `表示エラー: ${error.message}`;
    }
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    if (link.dataset.attachment) {
      vscode.postMessage({ type: 'attachment', path: link.dataset.attachment });
      return;
    }
    if (link.dataset.page) {
      vscode.postMessage({
        type: 'page',
        page: link.dataset.page,
        newWindow: link.dataset.newWindow === 'true',
      });
      return;
    }
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#')) {
      let anchor = href.slice(1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        /* keep original */
      }
      revealAnchor(anchor);
    } else if (/^(https?:\/\/|mailto:|tel:)/i.test(href))
      vscode.postMessage({ type: 'external', url: href });
  });
  content.addEventListener('dblclick', (event) => {
    if (event.target.closest('a, summary, button, input, textarea')) return;
    const include = event.target.closest('[data-include]');
    if (include) {
      vscode.postMessage({
        type: 'page',
        page: include.dataset.include,
        ...(include.dataset.editableInclude === 'true'
          ? { line: Number(event.target.closest('[data-line]')?.dataset.line) }
          : {}),
      });
      return;
    }
    const el = event.target.closest('[data-line]');
    if (el) vscode.postMessage({ type: 'reveal', line: Number(el.dataset.line) });
  });
  content.addEventListener(
    'toggle',
    (event) => {
      const detail = event.target;
      if (detail.dataset.remember)
        vscode.postMessage({ type: 'remember', id: detail.dataset.remember, open: detail.open });
    },
    true,
  );
  content.addEventListener(
    'error',
    (event) => {
      if (event.target.tagName !== 'IMG') return;
      const list = document.getElementById('warning-list'),
        li = document.createElement('li');
      li.textContent = '画像を読み込めません: ' + event.target.getAttribute('src');
      list.appendChild(li);
      document.getElementById('warnings').hidden = false;
      document.getElementById('warning-count').textContent = '(' + list.children.length + ')';
    },
    true,
  );
  let scrollTimer;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => vscode.setState({ scroll: window.scrollY }), 100);
    },
    { passive: true },
  );
  vscode.postMessage({ type: 'ready' });
})();
