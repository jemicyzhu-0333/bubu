'use strict';
const { defaultStoragePath } = require('../../core/runtime-profile');
const { holdUpdateWindows } = require('./update-window-hold');
const { configureNativeBranding } = require('./native-branding');

const APP_EVENTS = Object.freeze({
  onSecondInstance: 'second-instance',
  onBeforeQuit: 'before-quit',
  onWillQuit: 'will-quit'
});

function createAppHost({ app = require('electron').app } = {}) {
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
    acquireSingleInstanceLock: () => app.requestSingleInstanceLock() === true,
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
    showUpdateHandoffUnknown: async () => {
      const result = await require('electron').dialog.showMessageBox({ type: 'warning', title: '更新仍需确认',
        message: '更新已交给系统，尚不能确认是否完成。',
        detail: '输入和新操作已暂停，当前窗口中的输入保留。退出后再次打开可能会应用刚才确认的更新；请核对设置中显示的实际版本。也可以继续查看当前状态，稍后从菜单退出。',
        buttons: ['继续等待', '退出小步'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response === 1) app.quit();
    },
    holdForUpdate: () => holdUpdateWindows({ app, BrowserWindow: require('electron').BrowserWindow }),
    quit: () => app.quit(),
    subscribeLifecycle
  });
}

module.exports = { createAppHost };
