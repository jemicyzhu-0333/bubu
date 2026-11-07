'use strict';
const { pathToFileURL } = require('node:url');

// A same-URL replacement frame is a different document owner. A completed load
// is necessary; URL admission alone cannot make a crashed/loading page ready.
function createPetInputDocument({ window, selectedPage, onInvalidate, onReady }) {
  const contents = window.webContents, expectedURL = pathToFileURL(selectedPage).href;
  let frame = null, ready = false, generation = 0, token = null;
  function identity() {
    try {
      if (window.isDestroyed() || window.webContents !== contents || contents.isDestroyed?.()) return null;
      if (contents.isLoadingMainFrame?.() || (!contents.isLoadingMainFrame && contents.isLoading?.())) return null;
      const current = contents.mainFrame;
      return current && !current.detached && current.url === expectedURL && contents.getURL() === expectedURL ? current : null;
    } catch { return null; }
  }
  function invalidate() { ready = false; frame = null; token = null; generation++; onInvalidate(); }
  function mainNavigation(event, url, isInPlace, isMainFrame) {
    if (isMainFrame === true || event?.isMainFrame === true) invalidate();
  }
  contents.on('did-start-navigation', mainNavigation);
  contents.on('did-navigate', invalidate);
  contents.on('did-navigate-in-page', (event, url, isMainFrame) => {
    if (isMainFrame === true || event?.isMainFrame === true) invalidate();
  });
  contents.on('will-navigate', invalidate);
  contents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (isMainFrame === true || event?.isMainFrame === true) invalidate();
  });
  contents.on('render-process-gone', invalidate);
  contents.on('destroyed', invalidate);
  contents.on('did-finish-load', () => {
    const current = identity();
    if (!current) { invalidate(); return; }
    const newDocument = !ready || frame !== current;
    frame = current; ready = true;
    if (newDocument) token = Object.freeze({ generation: ++generation });
    onReady(newDocument);
  });
  function isReady() {
    if (!ready) return false;
    if (identity() !== frame) { invalidate(); return false; }
    return true;
  }
  return Object.freeze({ isReady, capture: () => isReady() ? token : null });
}
module.exports = { createPetInputDocument };
