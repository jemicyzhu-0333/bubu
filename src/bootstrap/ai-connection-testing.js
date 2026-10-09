'use strict';

const { createConnectionTests } = require('../application/ai/connection-tests');

function createAiConnectionTesting({ credentialStore, getSettings, requestScope, lifecycle,
  getWindowForSender = sender => require('electron').BrowserWindow.fromWebContents(sender) }) {
  const tests = createConnectionTests({ getSettings, getCredential: () => credentialStore.get(), requestScope });
  const listeners = new Map();
  function detach(sender) {
    const listener = listeners.get(sender);
    if (!listener) return;
    sender.removeListener('destroyed', listener.destroyed);
    sender.removeListener('render-process-gone', listener.gone);
    listener.window?.removeListener('hide', listener.gone);
    listener.window?.removeListener('closed', listener.gone);
    listeners.delete(sender);
  }
  function observe(sender, window) {
    if (listeners.has(sender)) return;
    const destroyed = () => { tests.cancelOwner(sender); detach(sender); };
    const gone = () => tests.cancelOwner(sender);
    window?.on('hide', gone);
    window?.on('closed', gone);
    sender.once('destroyed', destroyed);
    sender.on('render-process-gone', gone);
    listeners.set(sender, { destroyed, gone, window });
  }
  function register(registerIpc) {
    registerIpc('ai:test-connection', async (event, draft) => {
      if (!event.sender || event.sender.isDestroyed()) return { ok: false, reason: 'cancelled' };
      let window;
      try { window = getWindowForSender(event.sender); } catch (_) {}
      if (!window || window.isDestroyed() || !window.isVisible()) return { ok: false, reason: 'cancelled' };
      observe(event.sender, window);
      return tests.run(event.sender, draft);
    });
    registerIpc('ai:cancel-connection-test', (event, payload) => tests.cancel(event.sender, payload.requestId));
  }
  function dispose() {
    tests.dispose();
    for (const sender of listeners.keys()) detach(sender);
  }
  lifecycle?.register('ai:connection-tests', dispose);
  return Object.freeze({ register, dispose });
}
module.exports = { createAiConnectionTesting };
