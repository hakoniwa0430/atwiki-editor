'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewUpdate } = require('../src/preview-update');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function setup() {
  const jobs = [],
    messages = [],
    errors = [];
  const updates = createPreviewUpdate({
    payload() {
      const job = deferred();
      jobs.push(job);
      return job.promise;
    },
    send: async (message) => messages.push(message),
    onError: (error) => errors.push(error),
    delay: () => 0,
  });
  return { updates, jobs, messages, errors };
}

test('delivery failure is reported even when the webview cannot receive an error', async () => {
  const errors = [];
  const updates = createPreviewUpdate({
    payload: async () => ({ html: 'body' }),
    send: async () => {
      throw Error('delivery failed');
    },
    delay: () => 0,
    onError: (error) => errors.push(error.message),
  });
  await assert.doesNotReject(updates.update(true));
  assert.deepEqual(errors, ['delivery failed']);
  updates.dispose();
});
test('a stale success cannot replace a newer render', async () => {
  const app = setup(),
    first = app.updates.update(true),
    second = app.updates.update(true);
  app.jobs[1].resolve({ html: 'new' });
  await second;
  app.jobs[0].resolve({ html: 'old' });
  await first;
  assert.deepEqual(app.messages, [{ html: 'new' }]);
  app.updates.dispose();
});
test('a stale rejection cannot replace a newer render or show an error notification', async () => {
  const app = setup(),
    first = app.updates.update(true),
    second = app.updates.update(true);
  app.jobs[1].resolve({ html: 'new' });
  await second;
  app.jobs[0].reject(Error('old failure'));
  await first;
  assert.deepEqual(app.messages, [{ html: 'new' }]);
  assert.equal(app.errors.length, 0);
  app.updates.dispose();
});
test('current failures are reported and disposed work stays silent', async () => {
  const app = setup(),
    first = app.updates.update(true);
  app.jobs[0].reject(Error('current failure'));
  await first;
  assert.deepEqual(app.messages, [{ type: 'error', message: 'current failure' }]);
  assert.equal(app.errors.length, 1);
  const pending = app.updates.update(true);
  app.updates.dispose();
  app.jobs[1].reject(Error('closed'));
  await pending;
  assert.equal(app.messages.length, 1);
  assert.equal(app.errors.length, 1);
  app.updates.update(true);
  assert.equal(app.jobs.length, 2);
});
test('a newer update during delivery prevents the old render from delivering an anchor', async () => {
  let updates,
    anchors = 0,
    calls = 0;
  updates = createPreviewUpdate({
    payload: async () => ({}),
    send: async () => {
      if (++calls === 1) updates.update();
    },
    delay: () => 2000,
    onError: () => {},
    afterRender: () => anchors++,
  });
  await updates.update(true);
  assert.equal(anchors, 0);
  updates.dispose();
});
