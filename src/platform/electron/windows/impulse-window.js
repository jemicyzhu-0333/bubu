'use strict';

const { createHardenedWindow } = require('./window-host');

const QUICK_PANEL_SIZES = Object.freeze({
  fallback: Object.freeze({ width: 480, height: 180 }),
  idle: Object.freeze({ width: 480, height: 320 }),
  active: Object.freeze({ width: 480, height: 500 })
});

function quickPanelSize(mode) {
  return QUICK_PANEL_SIZES[mode] || QUICK_PANEL_SIZES.fallback;
}

function createImpulseWindowHost({ BrowserWindow, preloadPath, pagePath, onLoaded, onHidden, onDeliveryError, platform = process.platform }) {
  let available = null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    preparePanel: true,
    options: {
      width: 480,
      height: 160,
      show: false,
      frame: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      // 没有 vibrancy：毛玻璃铺满整个矩形窗口，不理会页面的 border-radius，圆角外面会露出方形的毛玻璃和方形阴影；
      // 而这个页面本身是不透明的圆角卡片，毛玻璃根本看不见，只留下方角这个副作用。
      transparent: platform !== 'win32',
      backgroundColor: platform === 'win32' ? '#f3f4f8' : '#00000000',
      webPreferences: { backgroundThrottling: false }
    },
    configure: (nativeWindow, host) => {
      if (typeof onLoaded === 'function') nativeWindow.webContents.on('did-finish-load', onLoaded);
      if (typeof onHidden === 'function') nativeWindow.on('hide', onHidden);
      nativeWindow.on('blur', () => { if (!nativeWindow.webContents.isDevToolsOpened()) host.hide(); });
    }
  });
  return Object.freeze({
    isAlive: host.isAlive,
    isVisible: host.isVisible,
    isLoading: host.isLoading,
    getBounds: host.getBounds,
    setPosition: host.setPosition,
    setMode: (view, workArea = available) => {
      available = workArea;
      const mode = typeof view === 'string' ? view : view?.mode;
      const preferred = quickPanelSize(mode);
      let height = preferred.height;
      if (mode === 'idle' && Array.isArray(view?.candidates)) height = Math.max(190, 174 + view.candidates.length * 52);
      if (mode === 'idle' && view?.candidates?.some(item => item.quickStartAction?.intent === 'clarify-and-start' && item.quickStartAction.enabled)) height += 156;
      if (mode === 'active' && Array.isArray(view?.steps)) height = Math.min(500, 340 + view.steps.length * 42);
      const size = { width: Math.min(preferred.width, workArea ? workArea.width - 16 : preferred.width), height: Math.min(height, workArea ? workArea.height - 16 : height) };
      const bounds = host.getBounds();
      if (bounds.width !== size.width || bounds.height !== size.height) host.setSize(size.width, size.height, false);
      return size;
    },
    showAndFocus: host.showAndFocus,
    hide: host.hide,
    close: host.close,
    send: host.send
  });
}

module.exports = { QUICK_PANEL_SIZES, quickPanelSize, createImpulseWindowHost };
