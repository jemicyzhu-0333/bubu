'use strict';

function createShortcutHost({ globalShortcut = require('electron').globalShortcut } = {}) {
  if (!globalShortcut
      || typeof globalShortcut.register !== 'function'
      || typeof globalShortcut.unregisterAll !== 'function') {
    throw new TypeError('Electron globalShortcut is required');
  }

  let disposed = false;

  function registerAll(bindings) {
    if (disposed) throw new Error('shortcut host is disposed');
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new TypeError('shortcut bindings must be a non-empty array');
    }

    const seen = new Set();
    for (const binding of bindings) {
      if (!binding
          || Object.keys(binding).some(key => !['accelerator', 'handler'].includes(key))
          || typeof binding.accelerator !== 'string'
          || binding.accelerator.length === 0
          || typeof binding.handler !== 'function') {
        throw new TypeError('each shortcut binding must contain an accelerator and handler');
      }
      if (seen.has(binding.accelerator)) {
        throw new TypeError(`duplicate shortcut accelerator: ${binding.accelerator}`);
      }
      seen.add(binding.accelerator);
    }

    const failed = [];
    for (const { accelerator, handler } of bindings) {
      try {
        if (globalShortcut.register(accelerator, handler) !== true) failed.push(accelerator);
      } catch (_) {
        failed.push(accelerator);
      }
    }
    return Object.freeze({
      ok: failed.length === 0,
      failed: Object.freeze(failed)
    });
  }

  /**
   * Borrow a chord for as long as a surface is on screen.
   *
   * Unlike registerAll, this is allowed to fail quietly: the caller is offering
   * a keyboard route to something that is also reachable another way, so a chord
   * the user has already given to another app must not become a startup error.
   * Returns a release function, or null when the chord could not be borrowed.
   */
  function claim(accelerator, handler) {
    if (disposed) return null;
    if (typeof accelerator !== 'string' || accelerator.length === 0 || typeof handler !== 'function') {
      throw new TypeError('a claimed shortcut requires an accelerator and handler');
    }
    // Never take a chord an app-wide binding already owns: releasing it later
    // would silently disarm that binding for the rest of the session.
    try {
      if (typeof globalShortcut.isRegistered === 'function' && globalShortcut.isRegistered(accelerator)) {
        return null;
      }
    } catch (_) {
      return null;
    }

    let owned = false;
    try {
      owned = globalShortcut.register(accelerator, handler) === true;
    } catch (_) {
      owned = false;
    }
    if (!owned) return null;

    let released = false;
    return () => {
      if (released) return false;
      released = true;
      // A disposed host already unregistered everything, so releasing is a no-op
      // rather than a reach into a torn-down Electron object.
      if (disposed) return true;
      try {
        if (typeof globalShortcut.unregister === 'function') globalShortcut.unregister(accelerator);
      } catch (_) {}
      return true;
    };
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    globalShortcut.unregisterAll();
    return true;
  }

  return Object.freeze({ registerAll, claim, dispose });
}

module.exports = { createShortcutHost };
