// A controller owns only these presentation resources. Disposal cancels them
// and invalidates callbacks already queued by the host, without shared globals.
function createPetLifecycle(environment) {
  let disposed = false;
  const removers = new Set(), timeouts = new Map(), intervals = new Map(), frames = new Map();
  const cancelFrame = environment.cancelAnimationFrame || (() => {});
  const clearTimer = environment.clearTimeout || globalThis.clearTimeout;
  const clearRepeat = environment.clearInterval || globalThis.clearInterval;

  function listen(target, type, callback, options) {
    if (disposed) return () => {};
    let active = true;
    const handler = (...args) => { if (!disposed && active) callback(...args); };
    const remove = () => {
      if (!active) return;
      active = false;
      target.removeEventListener(type, handler, options);
      removers.delete(remove);
    };
    target.addEventListener(type, handler, options);
    removers.add(remove);
    return remove;
  }
  function schedule(callback, delay, repeat) {
    if (disposed) return null;
    const timers = repeat ? intervals : timeouts;
    const ticket = {};
    const set = repeat ? environment.setInterval || globalThis.setInterval : environment.setTimeout || globalThis.setTimeout;
    const id = set(() => {
      if (disposed || timers.get(id) !== ticket) return;
      if (!repeat) timers.delete(id);
      callback();
    }, delay);
    timers.set(id, ticket);
    return id;
  }
  function clear(id, repeat) {
    const timers = repeat ? intervals : timeouts;
    if (timers.delete(id)) (repeat ? clearRepeat : clearTimer)(id);
  }
  function requestAnimationFrame(callback) {
    if (disposed) return null;
    const ticket = {};
    const id = environment.requestAnimationFrame(timestamp => {
      if (disposed || frames.get(id) !== ticket) return;
      frames.delete(id);
      callback(timestamp);
    });
    frames.set(id, ticket);
    return id;
  }
  function cancelAnimationFrame(id) {
    if (frames.delete(id)) cancelFrame(id);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const remove of [...removers]) remove();
    for (const id of [...timeouts.keys()]) clear(id, false);
    for (const id of [...intervals.keys()]) clear(id, true);
    for (const id of [...frames.keys()]) cancelAnimationFrame(id);
  }
  return Object.freeze({ listen, requestAnimationFrame, cancelAnimationFrame, dispose,
    setTimeout: (callback, delay) => schedule(callback, delay, false), clearTimeout: id => clear(id, false),
    setInterval: (callback, delay) => schedule(callback, delay, true), clearInterval: id => clear(id, true) });
}
export { createPetLifecycle };
