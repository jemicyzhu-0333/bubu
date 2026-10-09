'use strict';

function createLifecycleRegistry(options = {}) {
  const timers = {
    setInterval: options.setInterval || setInterval,
    clearInterval: options.clearInterval || clearInterval,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout
  };
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const resources = new Map();
  const registrationOrder = [];
  let disposed = false;

  function report(error, name) {
    try {
      onError(error, { name });
    } catch (_) {
      // Cleanup must continue even when the diagnostic sink itself fails.
    }
  }

  function releaseEntry(entry) {
    if (!entry || !entry.active) return false;
    entry.active = false;
    if (resources.get(entry.name) === entry) resources.delete(entry.name);
    const orderIndex = registrationOrder.indexOf(entry);
    if (orderIndex >= 0) registrationOrder.splice(orderIndex, 1);
    return true;
  }

  function disposeEntry(entry) {
    if (!releaseEntry(entry)) return null;
    try {
      entry.dispose();
      return null;
    } catch (error) {
      report(error, entry.name);
      return error;
    }
  }

  function validateName(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('lifecycle resource name must be a non-empty string');
    }
  }

  function replaceNamedResource(name) {
    validateName(name);
    const previous = resources.get(name);
    if (previous) disposeEntry(previous);
  }

  function addEntry(name, disposer, { replacing = true } = {}) {
    validateName(name);
    if (typeof disposer !== 'function') {
      throw new TypeError(`lifecycle disposer for ${name} must be a function`);
    }
    if (replacing) replaceNamedResource(name);

    const entry = { name, dispose: disposer, active: true };
    registrationOrder.push(entry);
    if (disposed) {
      disposeEntry(entry);
    } else {
      resources.set(name, entry);
    }
    return entry;
  }

  function register(name, disposer) {
    const entry = addEntry(name, disposer);
    return () => {
      if (!entry.active) return false;
      return disposeEntry(entry) === null;
    };
  }

  function interval(name, callback, delay, ...args) {
    if (typeof callback !== 'function') throw new TypeError('interval callback must be a function');
    replaceNamedResource(name);
    if (disposed) return null;
    const timer = timers.setInterval(callback, delay, ...args);
    addEntry(name, () => timers.clearInterval(timer), { replacing: false });
    return timer;
  }

  function timeout(name, callback, delay, ...args) {
    if (typeof callback !== 'function') throw new TypeError('timeout callback must be a function');
    replaceNamedResource(name);
    if (disposed) return null;
    let entry = null;
    const timer = timers.setTimeout((...callbackArgs) => {
      if (!releaseEntry(entry)) return;
      callback(...callbackArgs);
    }, delay, ...args);
    entry = addEntry(name, () => timers.clearTimeout(timer), { replacing: false });
    return timer;
  }

  function listen(name, target, eventName, listener) {
    if (!target || typeof listener !== 'function') {
      throw new TypeError(`listener resource ${name} requires a target and callback`);
    }

    validateName(name);
    let add;
    let remove;
    if (typeof target.on === 'function') {
      if (typeof target.off === 'function') remove = () => target.off(eventName, listener);
      else if (typeof target.removeListener === 'function') remove = () => target.removeListener(eventName, listener);
      add = () => target.on(eventName, listener);
    } else if (typeof target.addEventListener === 'function') {
      if (typeof target.removeEventListener === 'function') {
        remove = () => target.removeEventListener(eventName, listener);
        add = () => target.addEventListener(eventName, listener);
      }
    }
    if (!add || !remove) throw new TypeError(`listener target for ${name} has no supported removal API`);
    replaceNamedResource(name);
    if (disposed) return listener;
    add();
    addEntry(name, remove, { replacing: false });
    return listener;
  }

  function clear(name) {
    const entry = resources.get(name);
    if (!entry) return false;
    return disposeEntry(entry) === null;
  }

  function dispose() {
    if (disposed) return [];
    disposed = true;
    const errors = [];
    for (const entry of [...registrationOrder].reverse()) {
      const error = disposeEntry(entry);
      if (error) errors.push(error);
    }
    return errors;
  }

  return Object.freeze({
    register,
    interval,
    timeout,
    listen,
    clear,
    dispose,
    get disposed() { return disposed; },
    get size() { return resources.size; }
  });
}

module.exports = { createLifecycleRegistry };
