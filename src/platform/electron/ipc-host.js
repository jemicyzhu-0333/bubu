'use strict';

function createIpcHost({ ipcMain = require('electron').ipcMain } = {}) {
  if (!ipcMain
      || typeof ipcMain.handle !== 'function'
      || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('Electron ipcMain must support handle and removeHandler');
  }

  const channels = new Set();
  let disposed = false;

  function handle(channel, handler) {
    if (disposed) throw new Error('IPC host is disposed');
    if (typeof channel !== 'string' || channel.length === 0 || typeof handler !== 'function') {
      throw new TypeError('IPC registration requires a channel and handler');
    }
    if (channels.has(channel)) throw new TypeError(`duplicate IPC handler: ${channel}`);

    ipcMain.handle(channel, handler);
    channels.add(channel);
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    const errors = [];
    for (const channel of [...channels].reverse()) {
      try {
        ipcMain.removeHandler(channel);
      } catch (error) {
        errors.push(error);
      }
    }
    channels.clear();
    if (errors.length > 0) throw new AggregateError(errors, 'IPC handler cleanup failed');
    return true;
  }

  return Object.freeze({ handle, dispose });
}

module.exports = { createIpcHost };
