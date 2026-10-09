'use strict';

const { createPetHotReload } = require('./pet-hot-reload');

function createPetDevelopment({ profile, sourceRoot, getWindow, showPet } = {}) {
  const enabled = profile === 'development';
  if (!enabled) return Object.freeze({
    open: () => false,
    onLoaded: () => false,
    after: callback => { if (typeof callback === 'function') callback(); return false; },
    menuItems: () => [],
    start: () => () => {}
  });
  if (typeof sourceRoot !== 'string' || !sourceRoot) throw new TypeError('pet development source root is required');
  if (typeof getWindow !== 'function' || typeof showPet !== 'function') {
    throw new TypeError('pet development window ports are required');
  }

  let openRequested = false;
  let hotReload = null;

  function sendOpen(window) {
    if (!window || !window.isAlive() || window.isLoading()) return false;
    if (!window.send('pet:sync', { devMode: true })) return false;
    const sent = window.send('pet:devtools', { open: true });
    openRequested = !sent;
    return sent;
  }

  function open() {
    openRequested = true;
    showPet();
    return sendOpen(getWindow());
  }

  function onLoaded() {
    const window = getWindow();
    if (!window || !window.isAlive() || window.isLoading()) return false;
    return openRequested ? sendOpen(window) : window.send('pet:sync', { devMode: true });
  }

  function after(callback) {
    if (typeof callback !== 'function') throw new TypeError('pet development callback is required');
    callback();
    return onLoaded();
  }

  function menuItems() {
    return [{ label: '🧪 宠物开发检验台', click: open }];
  }

  function start() {
    if (hotReload) return () => hotReload.stop();
    hotReload = createPetHotReload({
      sourceRoot,
      reload: () => {
        const window = getWindow();
        if (window && window.isAlive() && typeof window.reload === 'function') window.reload();
      }
    });
    hotReload.start();
    return () => {
      if (hotReload) hotReload.stop();
      hotReload = null;
    };
  }

  return Object.freeze({ open, onLoaded, after, menuItems, start });
}

module.exports = Object.freeze({ createPetDevelopment });
