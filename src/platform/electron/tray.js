'use strict';

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

  const nativeTray = new Tray(createTrayIcon({ nativeImage, ...initialIcon }));
  nativeTray.setToolTip(tooltip);
  nativeTray.on('click', onClick);
  nativeTray.on('right-click', onRightClick);
  let disposed = false;

  function isAlive() {
    return !disposed
      && (typeof nativeTray.isDestroyed !== 'function' || !nativeTray.isDestroyed());
  }

  function setIcon(icon) {
    if (!isAlive()) return false;
    nativeTray.setImage(createTrayIcon({ nativeImage, ...icon }));
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
    nativeTray.popUpContextMenu(Menu.buildFromTemplate(template));
    return true;
  }

  function dispose() {
    if (!isAlive()) return false;
    disposed = true;
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
