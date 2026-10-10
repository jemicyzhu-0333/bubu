'use strict';

const { createHardenedWindow } = require('./window-host');

const QUICK_PANEL_SIZES = Object.freeze({
  fallback: Object.freeze({ width: 480, height: 144 }),
  idle: Object.freeze({ width: 480, height: 356 }),
  active: Object.freeze({ width: 480, height: 500 })
});

function quickPanelSize(mode) {
  return QUICK_PANEL_SIZES[mode] || QUICK_PANEL_SIZES.fallback;
}

function createImpulseWindowHost({ BrowserWindow, preloadPath, pagePath, onLoaded, onHidden, onDeliveryError, getWorkArea, platform = process.platform }) {
  let available = null;
  let measuredHeight = null;
  let contents = null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    preparePanel: true,
    options: {
      width: 480,
      height: 144,
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
      contents = nativeWindow.webContents;
      if (typeof onLoaded === 'function') nativeWindow.webContents.on('did-finish-load', onLoaded);
      if (typeof onHidden === 'function') nativeWindow.on('hide', onHidden);
      nativeWindow.on('blur', () => { if (!nativeWindow.webContents.isDevToolsOpened()) host.hide(); });
    }
  });
  function fit(height, workArea) {
    const bounds = host.getBounds();
    const area = workArea || (typeof getWorkArea === 'function' ? getWorkArea(bounds) : available);
    const size = {
      width: Math.max(1, Math.min(480, area ? area.width - 16 : 480)),
      height: Math.max(1, Math.min(Math.max(130, height), 620, area ? area.height - 16 : 620))
    };
    if (bounds.width !== size.width || bounds.height !== size.height) host.setSize(size.width, size.height, false);
    if (area && Number.isFinite(area.x) && Number.isFinite(area.y)) {
      const x = Math.round(Math.max(area.x + 8, Math.min(bounds.x, area.x + area.width - size.width - 8)));
      const y = Math.round(Math.max(area.y + 8, Math.min(bounds.y, area.y + area.height - size.height - 8)));
      if (x !== bounds.x || y !== bounds.y) host.setPosition(x, y, false);
    }
    return size;
  }
  return Object.freeze({
    isAlive: host.isAlive,
    isVisible: host.isVisible,
    isLoading: host.isLoading,
    getBounds: host.getBounds,
    setPosition: host.setPosition,
    resizeContent: (event, { height }) => {
      if (!host.isAlive() || event?.sender !== contents || !Number.isInteger(height) || height < 1 || height > 4096) {
        return { ok: false };
      }
      measuredHeight = height;
      return { ok: true, ...fit(height) };
    },
    setMode: (view, workArea) => {
      if (workArea) { available = workArea; measuredHeight = null; }
      const mode = typeof view === 'string' ? view : view?.mode;
      let height = quickPanelSize(mode).height;
      if (mode === 'idle' && Array.isArray(view?.candidates)) height = 190 + Math.min(3, view.candidates.length) * 56;
      if (mode === 'active' && Array.isArray(view?.steps)) height = Math.min(500, 340 + view.steps.length * 42);
      // Projection pushes must not erase a measured textarea or local editor.
      return fit(measuredHeight ?? height, workArea);
    },
    showAndFocus: host.showAndFocus,
    hide: host.hide,
    close: host.close,
    send: host.send
  });
}

function registerImpulseWindowIpc({ registerIpc, open, hide, getWindow, describeShortcut }) {
  registerIpc('impulse:open', () => { open(); return { ok: true }; });
  registerIpc('impulse:hide', hide);
  // Read the effective shortcut from its existing host; no second registry.
  registerIpc('quickPanel:describeShortcut', describeShortcut);
  registerIpc('impulse:resize', (event, payload) => getWindow()?.resizeContent(event, payload) || { ok: false });
}

module.exports = { QUICK_PANEL_SIZES, quickPanelSize, createImpulseWindowHost, registerImpulseWindowIpc };
