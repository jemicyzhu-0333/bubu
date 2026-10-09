'use strict';
const { createPanelReveal } = require('./panel-reveal');

function createWindowHost(nativeWindow, { onDeliveryError = () => {}, allowReload = false, platform = process.platform, preparePanel = false } = {}) {
  if (!nativeWindow || !nativeWindow.webContents) {
    throw new TypeError('nativeWindow must expose webContents');
  }
  if (typeof onDeliveryError !== 'function') {
    throw new TypeError('onDeliveryError must be a function');
  }

  function isAlive() {
    try {
      return typeof nativeWindow.isDestroyed !== 'function' || !nativeWindow.isDestroyed();
    } catch (_) {
      return false;
    }
  }

  function send(channel, payload) {
    try {
      if (!isAlive()) return false;
      const contents = nativeWindow.webContents;
      if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return false;
      contents.send(channel, payload);
      return true;
    } catch (error) {
      try { onDeliveryError(error, { channel }); } catch (_) {}
      return false;
    }
  }

  const reveal = preparePanel ? createPanelReveal(nativeWindow, onDeliveryError) : null;
  const operations = {
    isAlive,
    isVisible: () => isAlive() && nativeWindow.isVisible(),
    isLoading: () => !isAlive() || nativeWindow.webContents.isLoading(),
    getBounds: () => nativeWindow.getBounds(),
    setPosition: (x, y, animate = false) => nativeWindow.setPosition(x, y, animate),
    setSize: (width, height, animate = false) => nativeWindow.setSize(width, height, animate),
    setBounds: (bounds, animate = false) => {
      // Win32 permits programmatic bounds changes on a non-resizable window.
      // Toggling resizable adds/removes WS_THICKFRAME and rebuilds the transparent
      // native frame twice, producing a visible flash during every menu toggle.
      if (platform === 'win32') return nativeWindow.setBounds(bounds, animate);
      nativeWindow.setResizable(true);
      try {
        nativeWindow.setBounds(bounds, animate);
      } finally {
        nativeWindow.setResizable(false);
      }
    },
    show: () => nativeWindow.show(),
    showAndFocus: () => {
      if (reveal) return reveal.show();
      nativeWindow.show();
      nativeWindow.focus();
      // macOS 透明窗口的阴影按内容的透明度算，内容变了（弹层、抽屉、隐藏期间的刷新）它不会自己重算，
      // 显示的一瞬间阴影和内容对不上。让系统重算一次。
      if (platform === 'darwin' && typeof nativeWindow.invalidateShadow === 'function') nativeWindow.invalidateShadow();
    },
    showInactive: () => {
      if (typeof nativeWindow.showInactive === 'function') nativeWindow.showInactive();
      else nativeWindow.show();
    },
    ensureFocusable: ({ focus = false } = {}) => {
      nativeWindow.setFocusable(true);
      // Win32 changes taskbar membership when focusability changes.
      nativeWindow.setSkipTaskbar?.(true);
      if (focus) nativeWindow.focus();
    },
    hide: () => { reveal?.cancel(); nativeWindow.hide(); },
    close: () => { reveal?.cancel(); if (isAlive()) nativeWindow.close(); },
    send
  };
  if (allowReload) operations.reload = () => {
    if (!isAlive()) return false;
    nativeWindow.webContents.reload();
    return true;
  };
  return Object.freeze(operations);
}

function createHardenedWindow({
  BrowserWindow = require('electron').BrowserWindow,
  options,
  preloadPath,
  pagePath,
  onDeliveryError,
  configure,
  allowReload = false,
  preparePanel = false
}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow must be a constructor');
  if (!options || typeof options !== 'object') throw new TypeError('window options must be an object');
  if (typeof preloadPath !== 'string' || preloadPath.length === 0) {
    throw new TypeError('preloadPath must be a non-empty string');
  }
  if (typeof pagePath !== 'string' || pagePath.length === 0) throw new TypeError('pagePath must be a non-empty string');
  if (configure !== undefined && typeof configure !== 'function') {
    throw new TypeError('configure must be a function');
  }

  const nativeWindow = new BrowserWindow({
    title: '小步',
    // macOS：浮在别的应用上的无边框窗口不是“当前窗口”时，第一次点击默认只用来激活窗口、不会传给页面，
    // 用户得点两次（桌宠、提醒气泡最明显）。这些窗口的每一次点击都是有意的，所以默认接住第一下。
    acceptFirstMouse: true,
    ...options,
    skipTaskbar: true,
    webPreferences: {
      ...(options.webPreferences || {}),
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });
  const contents = nativeWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());

  const host = createWindowHost(nativeWindow, { onDeliveryError, allowReload, preparePanel });
  if (typeof configure === 'function') configure(nativeWindow, host);
  nativeWindow.loadFile(pagePath);
  return host;
}

module.exports = { createHardenedWindow, createWindowHost };
