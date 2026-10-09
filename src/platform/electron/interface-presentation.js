'use strict';
const { setNativeLocale } = require('./interface-copy');

// The OS theme source is process-wide, so native controls and every BrowserWindow
// receive the same setting. This adapter contains no business-state writer.
function createInterfacePresentationHost({ nativeTheme, app, BrowserWindow } = require('electron')) {
  return Object.freeze({
    languages: () => app.getPreferredSystemLanguages(),
    apply(snapshot) {
      setNativeLocale(snapshot.resolvedLocale);
      nativeTheme.themeSource = snapshot.theme;
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send('settings:interface-changed', snapshot);
          }
        } catch (_) { /* A closing surface recovers from the initial query when reopened. */ }
      }
    }
  });
}
module.exports = { createInterfacePresentationHost };
