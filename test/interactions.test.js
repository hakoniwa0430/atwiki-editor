'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { previewHtml } = require('../src/preview-html');

// A small DOM fixture exercises the shipped browser scripts without CommonJS globals.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.queries = new Map();
    this.closestMap = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, target = this, extra = {}) {
    for (const fn of this.listeners.get(type) || []) fn({ target, ...extra });
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  closest(selector) {
    return this.closestMap.get(selector) || null;
  }
  querySelector(selector) {
    return this.queries.get(selector)?.[0] || null;
  }
  querySelectorAll(selector) {
    return this.queries.get(selector) || [];
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  remove() {
    this.removed = true;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatch('close');
  }
  cloneNode() {
    return new Element(this.tagName);
  }
  createTHead() {
    const head = new Element('thead');
    head.insertRow = () => {
      const row = new Element('tr');
      head.append(row);
      return row;
    };
    this.append(head);
    return head;
  }
  createTBody() {
    const body = new Element('tbody');
    body.insertRow = () => {
      const row = new Element('tr');
      row.insertCell = () => {
        const cell = new Element('td');
        row.append(cell);
        return cell;
      };
      body.append(row);
      return row;
    };
    this.append(body);
    return body;
  }
}
function setup(DateClass = Date) {
  const body = new Element('body'),
    container = new Element('article'),
    timers = new Map();
  let next = 0;
  const document = { body, createElement: (tag) => new Element(tag), getElementById: () => null };
  const context = vm.createContext({
    Date: DateClass,
    document,
    setInterval(fn) {
      const id = ++next;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
  });
  const html = previewHtml(
    { Uri: { joinPath: (...parts) => path.posix.join(...parts) } },
    { webview: { cspSource: 'local', asWebviewUri: (value) => value } },
    'media',
    'nonce',
    'token',
  );
  const scripts = [...html.matchAll(/<script nonce="nonce" src="([^"]+)"><\/script>/g)].map(
    (m) => m[1],
  );
  assert.equal(scripts.at(-1), 'media/preview.js');
  for (const script of scripts.slice(0, -1))
    vm.runInContext(fs.readFileSync(script, 'utf8'), context, { filename: script });
  return { body, container, timers, api: context.AtWikiInteractions };
}
function button(attributes = {}) {
  const el = new Element('button');
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.closestMap.set('button,[data-sort]', el);
  return el;
}
test('browser feature scripts load in HTML order; cleanup prevents duplicate toggles', () => {
  const app = setup(),
    toggle = button({ 'data-toggle': '' });
  toggle.nextElementSibling = { hidden: true };
  const cleanup = app.api.initialize(app.container, () => {});
  app.container.dispatch('click', toggle);
  assert.equal(toggle.nextElementSibling.hidden, false);
  cleanup();
  cleanup();
  app.container.dispatch('click', toggle);
  assert.equal(toggle.nextElementSibling.hidden, false);
  const next = app.api.initialize(app.container, () => {});
  app.container.dispatch('click', toggle);
  assert.equal(toggle.nextElementSibling.hidden, true);
  next();
  assert.equal(app.timers.size, 0);
});
test('image autoplay and popups are disposed when the article is replaced', () => {
  const app = setup(),
    slides = new Element(),
    items = new Element(),
    play = button({ 'data-slide-play': '' });
  items.children = [{ hidden: false }, { hidden: true }];
  slides.dataset = { interval: '10', slide: '0' };
  slides.queries.set('.slide-items', [items]);
  slides.queries.set('[data-slide-play]', [play]);
  play.closestMap.set('.image-slides', slides);
  play.click = () => app.container.dispatch('click', play);
  app.container.queries.set('.image-slides[data-auto="true"]', [slides]);
  const cleanup = app.api.initialize(app.container, () => {});
  assert.equal(app.timers.size, 1);
  [...app.timers.values()][0]();
  assert.equal(items.children[1].hidden, false);
  const popup = button({ 'data-image': '' });
  popup.dataset.image = 'image.png';
  app.container.dispatch('click', popup);
  const dialog = app.body.children[0];
  assert.equal(dialog.open, true);
  cleanup();
  assert.equal(app.timers.size, 0);
  assert.equal(dialog.removed, true);
});
test('calendar navigation crosses the year boundary and rebuilds its grid', () => {
  const app = setup(),
    calendar = new Element(),
    title = new Element(),
    grid = new Element();
  calendar.dataset = { year: '2026', month: '11', pages: '[]' };
  calendar.queries.set('.calendar-title', [title]);
  calendar.queries.set('.calendar-grid', [grid]);
  app.container.queries.set('.calendar', [calendar]);
  const cleanup = app.api.initialize(app.container, () => {});
  assert.equal(title.textContent, '2026 / 12');
  const next = button({ 'data-month-step': '' });
  next.dataset.monthStep = '1';
  next.closestMap.set('.calendar', calendar);
  app.container.dispatch('click', next);
  assert.equal(title.textContent, '2027 / 1');
  assert.equal(grid.children.length, 1);
  cleanup();
});
test('presentation dialogs are removed on cleanup', () => {
  const app = setup(),
    heading = new Element('h2');
  app.container.queries.set('h2', [heading]);
  const cleanup = app.api.initialize(app.container, () => {});
  app.container.dispatch('click', button({ 'data-present': '' }));
  assert.equal(app.body.children[0].open, true);
  cleanup();
  assert.equal(app.body.children[0].removed, true);
});
test('partial initialization failures remove registered event handlers', () => {
  const app = setup();
  app.container.queries.set('.calendar', [new Element()]);
  assert.throws(() => app.api.initialize(app.container, () => {}));
  for (const listeners of app.container.listeners.values()) assert.equal(listeners.size, 0);
});

test('presentation opens the selected template even when current page has no headings', () => {
  const app = setup(),
    target = new Element('h2'),
    template = new Element('template');
  template.setAttribute('data-presentation-source', '');
  template.content = new Element();
  template.content.queries.set('h2', [target]);
  const trigger = button({ 'data-present': '' });
  trigger.nextElementSibling = template;
  const cleanup = app.api.initialize(app.container, () => {});
  app.container.dispatch('click', trigger);
  assert.equal(app.body.children[0].open, true);
  assert.equal(app.body.children[0].children[3].children[0].tagName, 'H2');
  cleanup();
  assert.equal(app.body.children[0].removed, true);
});

test('browser clocks preserve initial formats across year rollover and dispose timers', () => {
  let current = new Date(2026, 11, 31, 23, 59, 59);
  const app = setup(
    class extends Date {
      constructor() {
        super(current);
      }
    },
  );
  const cases = [
    ['now', false, '2026-12-31 23:59:59 (Thu)', '2027-01-01 01:02:03 (Fri)'],
    ['now', true, '2026年12月31日 (木) 23:59:59', '2027年01月01日 (金) 01:02:03'],
    ['today', false, '2026-12-31 (Thu)', '2027-01-01 (Fri)'],
    ['today', true, '2026年12月31日 (木)', '2027年01月01日 (金)'],
    ['fclock', false, '2026-12-31 23:59:59 (Thu)', '2027-01-01 01:02:03 (Fri)'],
  ];
  const elements = cases.map(([name, japanese, initial]) => {
    const html = require('../src/renderer').render(`&${name}(${japanese ? 'J' : ''})`, {
      now: current,
    }).html;
    assert.ok(html.includes(`>${initial}</time>`), html);
    const el = new Element('time');
    el.dataset = { clock: name, japanese: String(japanese) };
    el.textContent = initial;
    return el;
  });
  app.container.queries.set('[data-clock]', elements);
  const cleanup = app.api.initialize(app.container, () => {});
  assert.equal(app.timers.size, 1);
  for (const tick of app.timers.values()) tick();
  assert.deepEqual(
    elements.map((el) => el.textContent),
    cases.map((c) => c[2]),
  );
  current = new Date(2027, 0, 1, 1, 2, 3);
  for (const tick of app.timers.values()) tick();
  assert.deepEqual(
    elements.map((el) => el.textContent),
    cases.map((c) => c[3]),
  );
  cleanup();
  assert.equal(app.timers.size, 0);
  const next = app.api.initialize(app.container, () => {});
  assert.equal(app.timers.size, 1);
  next();
  assert.equal(app.timers.size, 0);
});
