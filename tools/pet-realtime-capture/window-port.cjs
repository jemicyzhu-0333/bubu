'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');

/** Only the genuine fixture pet webContents may be sampled or receive fixed injected input. */
function createOwnedWindowPort({ window, pagePath, readProfileOwnership, signal, timeoutMs = 5000, startupTimeoutMs = 35000 }) {
  const expected = pathToFileURL(path.resolve(pagePath)).href;
  let generation = 0, closed = false, expectedInstance = null;
  function assertCurrent() {
    if (closed || signal?.aborted || window.isDestroyed() || window.webContents.isDestroyed()
      || window.webContents.getURL() !== expected || readProfileOwnership() !== true) throw new Error('capture-window-owner-invalid');
  }
  async function bounded(promise, milliseconds) {
    let timer, abort;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        abort = () => reject(new Error('capture-collector-aborted'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        timer = setTimeout(() => reject(new Error('capture-collector-timeout')), milliseconds);
      })]);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function evaluate(method, argument, readTimeoutMs = null) {
    assertCurrent();
    if (!['readDiagnostics', 'pause', 'cancel', 'dispose'].includes(method)) throw new Error('capture-method-rejected');
    if (readTimeoutMs !== null && (method !== 'readDiagnostics' || !Number.isFinite(readTimeoutMs) || readTimeoutMs <= 0 || readTimeoutMs > timeoutMs))
      throw new Error('capture-read-timeout-invalid');
    const ticket = generation;
    const expression = `import(${JSON.stringify(pathToFileURL(path.join(path.dirname(pagePath), 'entry.mjs')).href)}).then(module => module.surface.${method}(${argument === undefined ? '' : JSON.stringify(argument)}))`;
    const value = await bounded(window.webContents.executeJavaScript(expression), readTimeoutMs ?? (expectedInstance === null ? startupTimeoutMs : timeoutMs));
    assertCurrent(); if (ticket !== generation) throw new Error('capture-late-generation-response');
    if (method === 'readDiagnostics') {
      if (typeof value?.instanceId !== 'string' || value.instanceId === 'unavailable') throw new Error('capture-instance-unavailable');
      if (expectedInstance !== null && expectedInstance !== value.instanceId) throw new Error('capture-instance-changed');
      expectedInstance ??= value.instanceId;
    }
    return value;
  }
  return Object.freeze({
    read: (options, limits) => evaluate('readDiagnostics', options, limits?.timeoutMs ?? null),
    pause: value => { if (typeof value !== 'boolean') return Promise.reject(new Error('capture-pause-boolean')); return evaluate('pause', value); },
    cancel: () => evaluate('cancel'), dispose: () => evaluate('dispose'),
    async input(type, point) {
      assertCurrent();
      if (!['mouseDown', 'mouseMove', 'mouseUp'].includes(type) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('capture-input-rejected');
      const bounds = window.getContentBounds();
      if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) throw new Error('capture-input-outside-owned-window');
      // Electron's supported API requires this owned window to be focused.
      if (!window.isFocused()) { window.focus(); await bounded(new Promise(resolve => setTimeout(resolve, 50)), timeoutMs); assertCurrent(); }
      if (!window.isFocused()) throw new Error('capture-owned-window-focus-blocked');
      window.webContents.sendInputEvent({ type, x: Math.round(point.x), y: Math.round(point.y),
        ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : { button: 'left', clickCount: 1 }) });
    },
    async screenshot() { assertCurrent(); const ticket = generation; const image = await bounded(window.webContents.capturePage(), timeoutMs);
      assertCurrent(); if (ticket !== generation) throw new Error('capture-late-screenshot'); return image.toPNG(); },
    reload(previousInstance) {
      assertCurrent(); if (previousInstance !== expectedInstance) throw new Error('capture-reload-instance-mismatch');
      generation++; expectedInstance = null;
      return new Promise((resolve, reject) => {
        let timer;
        const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); window.webContents.removeListener('did-finish-load', loaded); window.webContents.removeListener('did-fail-load', failed); };
        const loaded = () => { clean(); try { assertCurrent(); resolve(); } catch (error) { reject(error); } };
        const failed = () => { clean(); reject(new Error('capture-reload-failed')); };
        const aborted = () => { clean(); reject(new Error('capture-reload-aborted')); };
        signal?.addEventListener('abort', aborted, { once: true });
        window.webContents.once('did-finish-load', loaded); window.webContents.once('did-fail-load', failed);
        timer = setTimeout(() => { clean(); reject(new Error('capture-reload-timeout')); }, timeoutMs * 3);
        window.webContents.reload();
      });
    },
    close() { closed = true; generation++; }
  });
}
module.exports = { createOwnedWindowPort };
