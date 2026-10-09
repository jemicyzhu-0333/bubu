'use strict';

// Public BrowserWindow API only. Keep all existing DOM/input drafts visible and
// intact while disabling further input during the native installer handoff.
function holdUpdateWindows({ app, BrowserWindow }) {
  const windows = new Map();
  let released = false, faulted = false;
  function hold(window) {
    if (released || window.isDestroyed() || windows.has(window)) return;
    const state = { enabled: window.isEnabled(), focused: window.isFocused(), visible: window.isVisible() };
    windows.set(window, state);
    window.setEnabled(false);
    if (window.isEnabled()) throw new Error('update-window-hold-failed');
  }
  function onCreated(_event, window) {
    try { hold(window); } catch (_) { faulted = true; }
  }
  function release() {
    if (released) return;
    released = true; app.removeListener('browser-window-created', onCreated);
    let failure = null;
    for (const [window, state] of windows) {
      try { if (!window.isDestroyed()) window.setEnabled(state.enabled); }
      catch (error) { failure ||= error; }
    }
    for (const [window, state] of windows) {
      try { if (!window.isDestroyed() && state.focused && state.visible && window.isVisible()) window.focus(); }
      catch (error) { failure ||= error; }
    }
    windows.clear();
    if (failure) throw failure;
  }
  app.on('browser-window-created', onCreated);
  try { BrowserWindow.getAllWindows().forEach(hold); }
  catch (error) { release(); throw error; }
  return Object.freeze({ release, dispose() { released = true; app.removeListener('browser-window-created', onCreated); windows.clear(); }, isSafe: () => !released && !faulted
    && [...windows.keys()].every(window => window.isDestroyed() || !window.isEnabled()) });
}
module.exports = { holdUpdateWindows };
