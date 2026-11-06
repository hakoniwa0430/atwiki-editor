'use strict';

// One generation governs both successful renders and errors from asynchronous work.
function createPreviewUpdate({ payload, send, onError, delay, afterRender }) {
  let timer,
    revision = 0,
    disposed = false;
  function update(immediate = false) {
    clearTimeout(timer);
    const ticket = ++revision;
    const current = () => !disposed && ticket === revision;
    async function run() {
      try {
        const data = await payload();
        if (!current()) return;
        await send(data);
        if (current()) await afterRender?.(current);
      } catch (error) {
        if (!current()) return;
        try {
          await send({ type: 'error', message: error.message });
        } catch {
          // A closed/broken webview cannot receive the error either.
        }
        if (current()) onError(error);
      }
    }
    if (disposed) return;
    if (immediate) return run();
    timer = setTimeout(run, Math.max(0, Math.min(2000, delay())));
  }
  return {
    update,
    dispose() {
      disposed = true;
      revision++;
      clearTimeout(timer);
    },
  };
}
module.exports = { createPreviewUpdate };
