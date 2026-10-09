'use strict';

function createIpcRegistrar(options = {}) {
  const { ipcHost, senderPage, allowedPagesFor, validatePayload } = options;
  if (!ipcHost || typeof ipcHost.handle !== 'function') throw new TypeError('IPC host is required');
  if (typeof senderPage !== 'function' || typeof allowedPagesFor !== 'function' || typeof validatePayload !== 'function') {
    throw new TypeError('sender, capability and payload validators are required');
  }
  return function registerIpc(channel, handler) {
    if (typeof channel !== 'string' || !channel || typeof handler !== 'function') {
      throw new TypeError('invalid IPC registration');
    }
    ipcHost.handle(channel, async (event, payload) => {
      const page = senderPage(event);
      const allowed = allowedPagesFor(channel);
      if (!page || !Array.isArray(allowed) || !allowed.includes(page)) {
        throw new Error(`IPC sender is not allowed for ${channel}`);
      }
      const value = validatePayload(channel, payload);
      return handler(event, value);
    });
  };
}

module.exports = { createIpcRegistrar };
