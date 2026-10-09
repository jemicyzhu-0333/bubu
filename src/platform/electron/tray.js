'use strict';

const { nativeCopy, onNativeLocaleChanged } = require('./interface-copy');
const { createTrayIcon } = require('./tray-icon');

function copyRectangle(rectangle) {
  if (!rectangle
      || !Number.isFinite(rectangle.x)
      || !Number.isFinite(rectangle.y)
      || !Number.isFinite(rectangle.width)
      || !Number.isFinite(rectangle.height)) {
    throw new TypeError('tray bounds must contain finite geometry');
  }
  return Object.freeze({
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height
  });
}

function createTrayHost({
  Tray = require('electron').Tray,
  Menu = require('electron').Menu,
  nativeImage = require('electron').nativeImage,
  platform = process.platform,
  initialIcon,
  tooltip,
  onClick,
  onRightClick
}) {
  if (typeof Tray !== 'function') throw new TypeError('Electron Tray must be a constructor');
  if (!Menu || typeof Menu.buildFromTemplate !== 'function') {
    throw new TypeError('Electron Menu must build from templates');
  }
  if (typeof tooltip !== 'string' || tooltip.length === 0) {
    throw new TypeError('tray tooltip must be a non-empty string');
  }
  if (typeof onClick !== 'function' || typeof onRightClick !== 'function') {
    throw new TypeError('tray click handlers are required');
  }

  const nativeTray = new Tray(createTrayIcon({ nativeImage, ...initialIcon, platform }));
  nativeTray.setToolTip(nativeCopy(tooltip));
  nativeTray.on('click', onClick);
  nativeTray.on('right-click', onRightClick);
  let disposed = false;
  const stopLocale = onNativeLocaleChanged(() => { if (isAlive()) nativeTray.setToolTip(nativeCopy(tooltip)); });

  function isAlive() {
    return !disposed
      && (typeof nativeTray.isDestroyed !== 'function' || !nativeTray.isDestroyed());
  }

  function setIcon(icon) {
    if (!isAlive()) return false;
    nativeTray.setImage(createTrayIcon({ nativeImage, ...icon, platform }));
    return true;
  }

  function setTitle(title) {
    if (!isAlive()) return false;
    nativeTray.setTitle(String(title));
    return true;
  }

  function showMenu(template) {
    if (!isAlive()) return false;
    if (!Array.isArray(template)) throw new TypeError('tray menu template must be an array');
    const translateItem = item => {
      const label = item.label?.startsWith('快捷行动  ')
        ? nativeCopy('快捷行动  {shortcut}', { shortcut: item.label.slice('快捷行动  '.length) })
        : typeof item.label === 'string' ? nativeCopy(item.label) : item.label;
      return { ...item, ...(typeof label === 'string' ? { label } : {}),
        ...(Array.isArray(item.submenu) ? { submenu: item.submenu.map(translateItem) } : {}) };
    };
    nativeTray.popUpContextMenu(Menu.buildFromTemplate(template.map(translateItem)));
    return true;
  }

  function dispose() {
    if (disposed) return false;
    const alive = isAlive();
    disposed = true;
    stopLocale();
    if (!alive) return false;
    if (typeof nativeTray.removeListener === 'function') {
      nativeTray.removeListener('click', onClick);
      nativeTray.removeListener('right-click', onRightClick);
    }
    nativeTray.destroy();
    return true;
  }

  return Object.freeze({
    getBounds: () => copyRectangle(nativeTray.getBounds()),
    setIcon,
    setTitle,
    showMenu,
    dispose
  });
}

module.exports = { createTrayHost };
