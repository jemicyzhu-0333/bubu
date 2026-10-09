'use strict';

// Public Electron autoUpdater API only. The official downloader prepares its
// authenticated local feed; native staging starts only after explicit approval.
// Squirrel has no public unstage API. Any error after checkForUpdates is unknown,
// not cancellation, and must retain the application's quiescence lease.
function createMacUpdateHandoff(nativeUpdater, onUnknown = () => {}, { setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 120_000 } = {}) {
  let active = null, closed = false, handedOff = false;
  function install(canHandoff) {
    if (closed || active || handedOff || typeof nativeUpdater.checkForUpdates !== 'function'
        || typeof nativeUpdater.quitAndInstall !== 'function') throw new Error('native-update-handoff-unavailable');
    return new Promise((resolve, reject) => {
      const ticket = { unknown: false };
      let timer = null;
      function cleanup() {
        clearTimer(timer);
        nativeUpdater.removeListener('update-downloaded', ready);
        nativeUpdater.removeListener('error', failed);
        if (active === ticket) active = null;
      }
      function failed() {
        if (ticket.unknown || closed) return;
        ticket.unknown = true; clearTimer(timer);
        onUnknown();
        const error = new Error('handoff-unknown'); error.code = 'handoff-unknown'; reject(error);
      }
      function ready() {
        if (closed || active !== ticket) return;
        // A late native success cannot silently turn an unknown result into quit.
        if (ticket.unknown) { cleanup(); return; }
        try {
          if (!canHandoff()) { failed(); return; }
          nativeUpdater.quitAndInstall(); cleanup(); resolve();
        } catch (_) { failed(); }
      }
      ticket.cleanup = cleanup;
      ticket.close = () => { cleanup(); const error = new Error('handoff-unknown'); error.code = 'handoff-unknown'; reject(error); };
      active = ticket;
      nativeUpdater.once('update-downloaded', ready);
      nativeUpdater.on('error', failed);
      timer = setTimer(failed, timeoutMs);
      handedOff = true;
      try { nativeUpdater.checkForUpdates(); } catch (_) { failed(); }
    });
  }
  function close() { closed = true; active?.close(); }
  return Object.freeze({ install, close, hasHandedOff: () => handedOff });
}
module.exports = { createMacUpdateHandoff };
