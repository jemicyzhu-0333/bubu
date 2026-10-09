'use strict';

const { createHardenedWindow } = require('./window-host');
const { createPetViewport } = require('./pet-viewport');

function createPetWindowHost({
  BrowserWindow,
  preloadPath,
  pagePath,
  bounds,
  onLoaded,
  onHidden,
  onClosed,
  onDeliveryError,
  enableReload = false,
  platform = process.platform,
  screen = require('electron').screen
}) {
  const viewport = (platform === 'win32' || platform === 'darwin') && screen?.getDisplayNearestPoint
    ? createPetViewport({ bounds, screen }) : null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    allowReload: enableReload,
    options: {
      ...(viewport ? viewport.initialBounds : bounds),
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      transparent: true,
      focusable: true,
      fullscreenable: false
    },
    configure: (nativeWindow) => {
      viewport?.attach(nativeWindow);
      nativeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      nativeWindow.setAlwaysOnTop(true, 'floating');
      if (typeof onLoaded === 'function') nativeWindow.webContents.on('did-finish-load', onLoaded);
      if (typeof onHidden === 'function') nativeWindow.on('hide', onHidden);
      if (typeof onClosed === 'function') nativeWindow.on('closed', onClosed);
    }
  });
  return Object.freeze({
    isAlive: host.isAlive,
    isVisible: host.isVisible,
    getBounds: viewport ? viewport.getBounds : host.getBounds,
    setPosition: viewport ? viewport.setPosition : host.setPosition,
    setBounds: viewport ? viewport.setBounds : host.setBounds,
    setMenuOpen: viewport ? viewport.setMenuOpen : null,
    showInactive: host.showInactive,
    ensureFocusable: host.ensureFocusable,
    close: host.close,
    send: host.send,
    ...(enableReload ? { reload: host.reload, isLoading: host.isLoading } : {})
  });
}

module.exports = { createPetWindowHost };
