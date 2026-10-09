'use strict';

// Native visibility waits for ready-to-show and the latest projection/layout.
// Hidden Windows surfaces may suspend rAF, so use a renderer task boundary.
// A hide/close supersedes an in-flight reveal, including a slow first load.
function createPanelReveal(nativeWindow, onError = () => {}) {
  let generation = 0;
  let ready = false;
  let pending = null;
  nativeWindow.once('ready-to-show', () => {
    ready = true;
    if (pending) { const show = pending; pending = null; void show(); }
  });
  async function show() {
    const token = ++generation;
    if (!ready) { pending = show; return; }
    try {
      await nativeWindow.webContents.executeJavaScript(
        'new Promise(resolve => setTimeout(() => resolve(document.documentElement.getBoundingClientRect().height), 0))'
      );
      if (token !== generation || nativeWindow.isDestroyed()) return;
      nativeWindow.show();
      nativeWindow.focus();
    } catch (error) { onError(error, { channel: 'window:prepare-reveal' }); }
  }
  function cancel() { generation++; pending = null; }
  nativeWindow.on('closed', cancel);
  return { show, cancel };
}
module.exports = { createPanelReveal };
