'use strict';

const { createHardenedWindow } = require('./window-host');
const { clampPopoverHeight, clampPopoverWidth, placePopover, placeFloatingPanel } = require('../../../core/window-placement');

function createPopoverWindowHost({ BrowserWindow, preloadPath, pagePath, workArea, width = 560, height = 680, onDeliveryError, now = Date.now, platform = process.platform }) {
  // 失焦就隐藏。macOS 上点托盘图标想关掉它时，鼠标按下那一刻窗口先失焦、被隐藏，随后托盘的 click 才到——
  // 看到“已隐藏”就又把它打开，于是点了没反应或一闪又回来。记下上一次是不是刚被失焦隐藏，托盘点击据此把这一下当作“关闭”。
  let hiddenByBlurAt = -Infinity;
  let remembered = null;
  const host = createHardenedWindow({
    BrowserWindow,
    preloadPath,
    pagePath,
    onDeliveryError,
    preparePanel: true,
    options: {
      width: workArea ? clampPopoverWidth(workArea) : width,
      height: workArea ? clampPopoverHeight(workArea) : height,
      show: false,
      frame: false,
      resizable: false,
      movable: platform !== 'darwin',
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
      nativeWindow.on('hide', () => host.send('popover:hidden'));
      nativeWindow.on('moved', () => { if (host.isVisible()) remembered = host.getBounds(); });
      nativeWindow.on('blur', () => {
        if (!nativeWindow.webContents.isDevToolsOpened()) {
          hiddenByBlurAt = now();
          host.hide();
        }
      });
    }
  });
  function fitToWorkArea(area) {
    const nextWidth = clampPopoverWidth(area);
    const nextHeight = clampPopoverHeight(area);
    const bounds = host.getBounds();
    if (bounds.width !== nextWidth || bounds.height !== nextHeight) host.setSize(nextWidth, nextHeight, false);
  }
  return Object.freeze({
    anchorForOpen: trayBounds => platform !== 'darwin' && remembered
      ? { x: remembered.x + remembered.width / 2, y: remembered.y + remembered.height / 2 }
      : { x: trayBounds.x, y: trayBounds.y },
    placeForOpen({ trayBounds, display }) {
      fitToWorkArea(display.workArea);
      const bounds = host.getBounds();
      const area = display.workArea;
      const position = platform === 'darwin'
        ? placePopover({ trayBounds, popoverBounds: bounds, displayBounds: display.bounds, workArea: area })
        : placeFloatingPanel({ bounds, workArea: area, remembered });
      host.setPosition(position.x, position.y, false);
    },
    getBounds: host.getBounds,
    setPosition: host.setPosition,
    fitToWorkArea,
    isVisible: host.isVisible,
    justHiddenByBlur: (withinMs = 350) => now() - hiddenByBlurAt < withinMs,
    showAndFocus: host.showAndFocus,
    hide: host.hide,
    close: host.close,
    send: host.send
  });
}

module.exports = { createPopoverWindowHost };
