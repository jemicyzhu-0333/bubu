'use strict';

const POWER_EVENTS = Object.freeze({
  onSuspend: 'suspend',
  onLock: 'lock-screen',
  onUnlock: 'unlock-screen',
  onResume: 'resume'
});

function createPowerHost({ powerMonitor = require('electron').powerMonitor } = {}) {
  if (!powerMonitor || typeof powerMonitor.on !== 'function') {
    throw new TypeError('Electron powerMonitor must support event subscriptions');
  }
  const removeListener = typeof powerMonitor.off === 'function'
    ? (eventName, listener) => powerMonitor.off(eventName, listener)
    : typeof powerMonitor.removeListener === 'function'
      ? (eventName, listener) => powerMonitor.removeListener(eventName, listener)
      : null;
  if (!removeListener) {
    throw new TypeError('Electron powerMonitor must support event removal');
  }

  let activeDisposer = null;

  function subscribe(handlers) {
    if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
      throw new TypeError('power handlers must be an object');
    }
    const names = Object.keys(handlers);
    const expected = Object.keys(POWER_EVENTS);
    if (names.length !== expected.length
        || names.some(name => !Object.prototype.hasOwnProperty.call(POWER_EVENTS, name))
        || expected.some(name => typeof handlers[name] !== 'function')) {
      throw new TypeError('power handlers must define only suspend, lock, unlock and resume callbacks');
    }

    if (activeDisposer) activeDisposer();
    const registered = [];
    try {
      for (const [handlerName, eventName] of Object.entries(POWER_EVENTS)) {
        const listener = handlers[handlerName];
        powerMonitor.on(eventName, listener);
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
      if (activeDisposer === dispose) activeDisposer = null;
      return true;
    };
    activeDisposer = dispose;
    return dispose;
  }

  return Object.freeze({
    subscribe,
    systemIdleSeconds: () => {
      const seconds = powerMonitor.getSystemIdleTime();
      if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('invalid system idle time');
      return seconds;
    }
  });
}

module.exports = { createPowerHost };
