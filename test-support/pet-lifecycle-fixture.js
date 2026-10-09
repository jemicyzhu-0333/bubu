'use strict';

const { createPetRuntimeFixture } = require('./pet-runtime-fixture');
const { PET_CONTENT_PAYLOAD } = require('./pet-sync-fixture');

// Opt-in resource accounting. The legacy smoke/sync defaults remain unchanged.
function createLifecycleHarness(options = {}) {
  const targets = new Map(), media = new Map(), subscriptions = new Map();
  const timers = new Map(), frames = new Map(), observers = new Set();
  const callbacks = [], calls = [];
  let writes = 0, nextId = 0;
  const track = target => {
    if (!target || targets.has(target)) return target;
    const events = new Map(); targets.set(target, events);
    target.addEventListener = (type, fn) => {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(fn); callbacks.push(() => fn({ type, target, stopPropagation() {}, preventDefault() {} }));
    };
    target.removeEventListener = (type, fn) => events.get(type)?.delete(fn);
    target.dispatch = (type, event = {}) => {
      for (const fn of [...(events.get(type) || [])]) fn({ type, target, currentTarget: target, stopPropagation() {}, preventDefault() {}, ...event });
    };
    if (target.dataset) target.dataset = new Proxy(target.dataset, { set(obj, key, value) { writes++; obj[key] = value; return true; }, deleteProperty(obj, key) { writes++; return delete obj[key]; } });
    if (target.style) target.style = new Proxy(target.style, { set(obj, key, value) { writes++; obj[key] = value; return true; } });
    for (const key of ['textContent', 'innerHTML']) if (Object.hasOwn(target, key)) {
      let value = target[key];
      Object.defineProperty(target, key, { get: () => value, set(next) { writes++; value = next; } });
    }
    for (const method of ['setAttribute', 'removeAttribute', 'appendChild', 'append', 'replaceChildren', 'focus']) {
      if (!target[method]) continue;
      const original = target[method].bind(target);
      target[method] = (...args) => { writes++; return original(...args); };
    }
    for (const method of ['add', 'remove', 'toggle']) if (target.classList?.[method]) {
      const original = target.classList[method].bind(target.classList);
      target.classList[method] = (...args) => { writes++; return original(...args); };
    }
    return target;
  };
  const create = createPetRuntimeFixture({ contentPayload: options.content || PET_CONTENT_PAYLOAD, styleProperties: true });
  const h = create({ ...options, prepareEnvironment({ window, document, environment, elements }) {
    const resolve = document._resolve.bind(document), createElement = document.createElement.bind(document);
    document._resolve = key => track(resolve(key));
    document.createElement = tag => track(createElement(tag));
    for (const value of elements.values()) track(value);
    track(document.body); track(document.documentElement); track(document); track(window);
    document.defaultView = window;
    window.matchMedia = query => {
      if (!media.has(query)) media.set(query, track({ matches: query.includes('reduced-motion') }));
      return media.get(query);
    };
    window.MutationObserver = class {
      constructor(fn) { this.fn = fn; callbacks.push(fn); }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    };
    for (const [name, method] of Object.entries(window.focuspix)) {
      if (name.startsWith('onPet')) {
        const listeners = new Set(); subscriptions.set(name, listeners);
        window.focuspix[name] = fn => { listeners.add(fn); callbacks.push(() => fn({ message: 'late', baseState: 'hungry', open: true })); return () => listeners.delete(fn); };
      } else window.focuspix[name] = (...args) => { calls.push([name, ...args]); return method(...args); };
    }
    environment.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay, interval: false }); callbacks.push(fn); return id; };
    environment.setInterval = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay, interval: true }); callbacks.push(fn); return id; };
    environment.clearTimeout = environment.clearInterval = id => timers.delete(id);
    environment.requestAnimationFrame = fn => { const id = ++nextId; frames.set(id, fn); callbacks.push(() => fn(1000)); return id; };
    environment.cancelAnimationFrame = id => frames.delete(id);
  } });
  return Object.assign(h, {
    calls, callbacks, media, timers, frames, observers,
    writes: () => writes,
    listenerCount: () => [...targets.values()].reduce((count, events) => count + [...events.values()].reduce((n, set) => n + set.size, 0), 0),
    subscriptionCount: () => [...subscriptions.values()].reduce((n, set) => n + set.size, 0),
    emit(name, payload) { for (const fn of [...(subscriptions.get(name) || [])]) fn(payload); }
  });
}
module.exports = { createLifecycleHarness };
