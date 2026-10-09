'use strict';

function createPermissionHost({ session = require('electron').session } = {}) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('Electron session is required');
  }

  function denyAll() {
    const target = session.defaultSession;
    if (!target
        || typeof target.setPermissionCheckHandler !== 'function'
        || typeof target.setPermissionRequestHandler !== 'function') {
      throw new TypeError('defaultSession must expose permission handlers');
    }

    target.setPermissionCheckHandler(() => false);
    try {
      target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    } catch (error) {
      target.setPermissionCheckHandler(null);
      throw error;
    }

    let installed = true;
    return () => {
      if (!installed) return false;
      installed = false;
      target.setPermissionRequestHandler(null);
      target.setPermissionCheckHandler(null);
      return true;
    };
  }

  return Object.freeze({ denyAll });
}

module.exports = { createPermissionHost };
