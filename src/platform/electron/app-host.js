'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { defaultStoragePath } = require('../../core/runtime-profile');
const { configureNativeBranding } = require('./native-branding');

const APP_EVENTS = Object.freeze({
  onSecondInstance: 'second-instance',
  onBeforeQuit: 'before-quit',
  onWillQuit: 'will-quit'
});

function createAppHost({ app = require('electron').app, platform = process.platform, io = fs } = {}) {
  const requiredMethods = [
    'getPath',
    'setPath',
    'requestSingleInstanceLock',
    'quit',
    'isReady',
    'whenReady',
    'getLoginItemSettings',
    'setLoginItemSettings',
    'on'
  ];
  if (!app || requiredMethods.some(method => typeof app[method] !== 'function')) {
    throw new TypeError('Electron app is missing a required process capability');
  }
  const removeListener = typeof app.off === 'function'
    ? (eventName, listener) => app.off(eventName, listener)
    : typeof app.removeListener === 'function'
      ? (eventName, listener) => app.removeListener(eventName, listener)
      : null;
  if (!removeListener) throw new TypeError('Electron app must support event removal');

  const initialDirectory = app.getPath('userData');
  const explicitDirectory = app.commandLine?.hasSwitch?.('user-data-dir') === true;
  const compatibleDirectory = explicitDirectory ? initialDirectory : defaultStoragePath(initialDirectory);
  if (initialDirectory !== compatibleDirectory) setDataDirectory(compatibleDirectory);
  // The runtime and OS safeStorage identity use bubu. No earlier credentials
  // are imported or migrated into this product identity.
  if (typeof app.setName === 'function') app.setName('bubu');
  configureNativeBranding({ app });

  let activeLifecycleDisposer = null;

  function userDataPath() {
    return app.getPath('userData');
  }

  function acquireSingleInstanceLock() {
    if (platform === 'win32') {
      const directory = userDataPath();
      // Chromium uses CREATE_ALWAYS for its delete-on-close Windows lock.
      // Refuse observed foreign contents before that native call can truncate
      // them. This is a preflight, not protection from concurrent replacement.
      for (const [target, valid] of [
        [directory, entry => entry.isDirectory()],
        [path.join(directory, 'lockfile'), entry => entry.isFile() && entry.size === 0n]
      ]) {
        let entry;
        try { entry = io.lstatSync(target, { bigint: true }); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (!valid(entry)) throw Object.assign(new Error('config-profile-brand-required: Select a new empty profile directory for bubu; this directory contains unbound data.'),
          { code: 'config-profile-brand-required' });
      }
    }
    return app.requestSingleInstanceLock() === true;
  }

  function setDataDirectory(directory) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('application data directory must be a non-empty path');
    }
    const previousUserData = app.getPath('userData');
    const previousSessionData = app.getPath('sessionData');
    app.setPath('userData', directory);
    try {
      app.setPath('sessionData', directory);
    } catch (error) {
      app.setPath('userData', previousUserData);
      app.setPath('sessionData', previousSessionData);
      throw error;
    }
    return directory;
  }

  function subscribeLifecycle(options) {
    const expectedKeys = [...Object.keys(APP_EVENTS), 'keepAliveWithoutWindows'];
    if (!options
        || typeof options !== 'object'
        || Array.isArray(options)
        || Object.keys(options).length !== expectedKeys.length
        || Object.keys(options).some(key => !expectedKeys.includes(key))
        || Object.keys(APP_EVENTS).some(name => typeof options[name] !== 'function')
        || typeof options.keepAliveWithoutWindows !== 'boolean') {
      throw new TypeError('application lifecycle handlers must be complete and closed');
    }

    if (activeLifecycleDisposer) activeLifecycleDisposer();
    const bindings = Object.entries(APP_EVENTS).map(([handlerName, eventName]) => (
      [eventName, options[handlerName]]
    ));
    bindings.push(['window-all-closed', event => {
      if (options.keepAliveWithoutWindows) event.preventDefault();
    }]);

    const registered = [];
    try {
      for (const [eventName, listener] of bindings) {
        app.on(eventName, listener);
        registered.push([eventName, listener]);
      }
    } catch (error) {
      for (const [eventName, listener] of registered.reverse()) removeListener(eventName, listener);
      throw error;
    }

    let active = true;
    const dispose = () => {
      if (!active) return false;
      active = false;
      for (const [eventName, listener] of registered.reverse()) removeListener(eventName, listener);
      if (activeLifecycleDisposer === dispose) activeLifecycleDisposer = null;
      return true;
    };
    activeLifecycleDisposer = dispose;
    return dispose;
  }

  return Object.freeze({
    userDataPath,
    hasExplicitUserDataPath: () => explicitDirectory,
    setDataDirectory,
    acquireSingleInstanceLock,
    isPackaged: () => app.isPackaged === true,
    appPath: () => app.getAppPath(),
    isReady: () => app.isReady(),
    whenReady: () => app.whenReady(),
    hideDock: () => {
      if (!app.dock || typeof app.dock.hide !== 'function') return false;
      const hide = () => { app.setActivationPolicy?.('accessory'); app.dock.hide(); };
      if (app.isReady()) hide();
      else app.once('ready', hide);
      return true;
    },
    openAtLogin: () => app.getLoginItemSettings().openAtLogin === true,
    setOpenAtLogin: enabled => {
      if (typeof enabled !== 'boolean') throw new TypeError('open-at-login must be boolean');
      app.setLoginItemSettings({ openAtLogin: enabled });
      return true;
    },
    quit: () => app.quit(),
    subscribeLifecycle
  });
}

module.exports = { createAppHost };
