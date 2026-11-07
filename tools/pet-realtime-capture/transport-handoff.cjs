'use strict';
const EVENT = 'bubu:fixture-transport-port';
const METHODS = Object.freeze(['prepareFixture', 'arm', 'translate', 'read', 'finish', 'abort', 'restoreFixture']);
function validTransportPort(port) {
  if (!port || !Object.isFrozen(port) || Object.getPrototypeOf(port) !== Object.prototype) return false;
  const fields = Object.getOwnPropertyDescriptors(port);
  return Reflect.ownKeys(fields).length === METHODS.length
    && METHODS.every(key => fields[key] && Object.hasOwn(fields[key], 'value') && typeof fields[key].value === 'function');
}
/** Install before launch/configure. The emitting BrowserWindow is the authority, not its URL. */
function captureTransportHandoff(app) {
  const listeners = new Map(); let selected = null, invalid = false, closed = false;
  function created(_event, window) {
    if (listeners.has(window)) { invalid = true; return; }
    const receive = port => {
      if (closed || selected || !validTransportPort(port)) { invalid = true; return; }
      selected = { window, port };
    };
    listeners.set(window, receive); window.on(EVENT, receive);
  }
  app.on('browser-window-created', created);
  return Object.freeze({
    take(window) {
      if (closed || invalid) throw Error('capture-transport-handoff-invalid');
      if (!selected) return null;
      if (selected.window !== window) throw Error('capture-transport-window-mismatch');
      return Object.freeze({ window, port: selected.port,
        assertCurrent() {
          if (closed || invalid || selected?.window !== window) throw Error('capture-transport-handoff-invalid');
        } });
    },
    close() {
      closed = true; app.removeListener('browser-window-created', created);
      for (const [window, listener] of listeners) window.removeListener(EVENT, listener);
      listeners.clear(); selected = null;
    }
  });
}
module.exports = { captureTransportHandoff, validTransportPort };
