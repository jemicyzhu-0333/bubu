'use strict';

const { createPetRuntime } = require('../src/surfaces/pet/runtime.mjs');
const { createPetSurfaceClient } = require('../src/surfaces/pet/adapter/surface-client.mjs');
const { createRecordingContext } = require('./pet-recording-context');

// The two suites intentionally model different DOM/media surfaces. General DOM
// removal, interval cancellation and rAF cancellation remain no-ops here; this
// fixture is not evidence of complete runtime teardown (tracked separately).
function createPetRuntimeFixture({ contentPayload, styleProperties = false, liveReducedMotion = false }) {
  return options => createHarness(options, { contentPayload, styleProperties, liveReducedMotion });
}

// ---------- 最小 DOM ----------
function createElementStub(id, document, styleProperties) {
  const classes = new Set();
  const element = {
    id,
    tagName: 'DIV',
    width: 0,
    height: 0,
    textContent: '',
    innerHTML: '',
    style: styleProperties ? { setProperty(name, value) { this[name] = String(value); } } : {},
    dataset: {},
    children: [],
    attributes: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name); else classes.delete(name);
        return next;
      },
      contains: name => classes.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) { (this._handlers[type] ||= []).push(handler); },
    removeEventListener() {},
    dispatch(type, event = {}) { for (const handler of this._handlers[type] || []) handler(event); },
    focus() {},
    blur() {},
    contains() { return false; },
    closest() { return null; },
    matches() { return false; },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    querySelector(selector) { return document._resolve(`${id}::${selector}`); },
    querySelectorAll(selector) {
      // 命令菜单的键盘导航需要真实数量的菜单项。
      const count = selector.includes('command-item') ? 11 : 1;
      return Array.from({ length: count }, (_, index) => document._resolve(`${id}::${selector}::${index}`));
    },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
    releasePointerCapture() {},
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; },
    _handlers: {},
    _classes: classes
  };
  return element;
}

// FPS 无关性断言需要三次模拟走出完全相同的随机序列，所以给沙箱一个
// 可复现的 Math.random（mulberry32）。默认仍用真实 Math，不影响既有用例。
function createDeterministicMath(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(Object.create(Math), { random });
}

function createHarness({ devicePixelRatio = 2, deterministicRandom = false, initialState = {}, bridgeOverrides = {}, prepareEnvironment, autoStart = true } = {},
  { contentPayload, styleProperties, liveReducedMotion }) {
  const elements = new Map();
  const contexts = [];
  // 记录 createElement 次数：身体/脸 sprite 每次缓存未命中都会新建一块画布，
  // 因此它是“缓存是否随位姿增长”的可观察信号。
  const created = { count: 0 };

  const document = {
    hidden: false,
    activeElement: null,
    _handlers: {},
    _resolve(key) {
      if (!elements.has(key)) elements.set(key, createElementStub(key, document, styleProperties));
      return elements.get(key);
    },
    querySelector(selector) { return document._resolve(selector); },
    querySelectorAll(selector) { return document._resolve('document').querySelectorAll(selector); },
    getElementById(id) { return document._resolve(`#${id}`); },
    createElement(tag) {
      created.count++;
      const element = createElementStub(`created:${tag}:${elements.size}`, document, styleProperties);
      element.tagName = tag.toUpperCase();
      element.getContext = () => {
        const context = createRecordingContext(`sprite:${element.id}`);
        context.canvas = element;
        element._context = context;
        return context;
      };
      return element;
    },
    addEventListener(type, handler) { (this._handlers[type] ||= []).push(handler); },
    removeEventListener() {},
    dispatch(type, event = {}) { for (const handler of this._handlers[type] || []) handler(event); },
    body: null,
    documentElement: null
  };
  document.body = createElementStub('body', document, styleProperties);
  document.documentElement = createElementStub('html', document, styleProperties);
  document.documentElement.style.setProperty = () => {};

  for (const id of ['#petCanvas', '#sceneCanvas', '#overlayCanvas']) {
    const element = document._resolve(id);
    element.tagName = 'CANVAS';
    const context = createRecordingContext(id);
    context.canvas = element;
    contexts.push({ id, context });
    element.getContext = () => context;
  }

  const timers = { rafCallbacks: [], intervals: [], timeouts: new Map(), nextTimeoutId: 0 };
  const windowHandlers = {};
  const motionListeners = new Set();
  const motionMedia = { matches: false,
    addEventListener: (_type, callback) => motionListeners.add(callback),
    removeEventListener: (_type, callback) => motionListeners.delete(callback) };
  const inertMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const window = {
    devicePixelRatio,
    matchMedia: query => liveReducedMotion && query === '(prefers-reduced-motion: reduce)' ? motionMedia : inertMedia(),
    ...(liveReducedMotion ? { setReducedMotion(value) {
      motionMedia.matches = value;
      for (const callback of motionListeners) callback({ matches: value });
    } } : {}),
    addEventListener(type, handler) { (windowHandlers[type] ||= []).push(handler); },
    removeEventListener() {},
    dispatch(type, event = {}) { for (const handler of windowHandlers[type] || []) handler(event); }
  };

  const bridge = { handlers: {} };
  const noop = () => Promise.resolve(null);
  window.bubu = {
    onPetViewport: handler => { bridge.handlers.viewport = handler; },
    onPetSync: handler => { bridge.handlers.sync = handler; },
    onPetDock: handler => { bridge.handlers.dock = handler; },
    onPetPeek: handler => { bridge.handlers.peek = handler; },
    onPetCue: handler => { bridge.handlers.cue = handler; },
    onPetFeedState: handler => { bridge.handlers.feed = handler; },
    onPetGaze: handler => { bridge.handlers.gaze = handler; },
    onPetDevtools: handler => { bridge.handlers.devtools = handler; },
    // 与 main.js 的 pet:getContent / pet:getState 负载一致，否则 init() 里的 try
    // 会静默吐掉异常，测试就变成“什么都没渲染但全绿”。
    pet_getContent: () => Promise.resolve(contentPayload),
    pet_getState: () => Promise.resolve({
      skin: 'pink',
      theme: { primary: '#f7768e', accent: '#e0af68' },
      state: 'idle',
      work: { start: 10, end: 21 },
      stimulationMode: 'high',
      motionMode: 'full',
      dnd: false,
      energy: { level: 60 },
      streak: 3,
      satiation: 60,
      ...initialState
    }),
    pet_getBounds: () => Promise.resolve({ x: 0, y: 0, width: 220, height: 220 }),
    pet_getFeedState: () => Promise.resolve({ satiation: 65, foodInventory: {}, foodTickets: 6, totalFeeds: 0, basicMeal: { remaining: 3, eligible: false } }),
    pet_getContextualLine: () => Promise.resolve('测试台词'),
    pet_setMenuOpen: noop,
    pet_setPosition: noop,
    pet_savePosition: noop,
    pet_dragStart: noop,
    pet_dragEnd: noop,
    pet_setState: noop,
    pet_updateRuntime: noop,
    pet_ackCue: noop,
    pet_feed: noop,
    pet_interaction: noop,
    pet_startFocus: noop,
    pet_openImpulse: noop,
    pet_openPanel: noop,
    pet_toggleDnd: noop,
    pet_hide: noop,
    ...bridgeOverrides
  };

  // 可控墙钟。业务时间（cue 的 issuedAt/expiresAt、深夜状态等）仍读 Date；动作
  // 相位只读 rAF 驱动的 animNow，下面另有系统校时跳变的回归用例。
  // 本地时间下午两点，而不是一个固定的 UTC 时刻：1_700_000_000_000 在 UTC 是 22:13，会触发深夜犯困表情，
  // 让眼神测试只在东八区通过。需要深夜的用例自己 setHours。
  const clockState = { now: new Date(2023, 10, 14, 14, 0, 0).getTime() };
  class HarnessDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clockState.now);
      else super(...args);
    }
    static now() { return clockState.now; }
  }
  HarnessDate.UTC = Date.UTC;
  HarnessDate.parse = Date.parse;

  const sandbox = {
    window,
    document,
    console,
    Math: deterministicRandom ? createDeterministicMath(0xF0C5) : Math,
    Date: HarnessDate,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    RangeError,
    isNaN,
    parseInt,
    parseFloat,
    performance: { now: () => 0 },
    setTimeout: (fn, delay = 0) => {
      const id = ++timers.nextTimeoutId;
      timers.timeouts.set(id, { fn, delay });
      return id;
    },
    clearTimeout: id => { timers.timeouts.delete(id); },
    setInterval: (fn) => { timers.intervals.push(fn); return timers.intervals.length; },
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { timers.rafCallbacks.push(fn); return timers.rafCallbacks.length; },
    cancelAnimationFrame: () => {}
  };
  sandbox.globalThis = sandbox;

  prepareEnvironment?.({ window, document, environment: sandbox, bridge, elements });
  const runtime = createPetRuntime({ environment: sandbox, clients: createPetSurfaceClient(window.bubu) });
  if (autoStart) runtime.start();

  const petContext = contexts.find(item => item.id === '#petCanvas').context;

  let clock = 0;
  // stepMs 推进业务时钟，用于扫过动作的整个相位。
  function frame(steps = 1, stepMs = 0) {
    for (let index = 0; index < steps; index++) {
      clock += 1000;   // 远超任何 fps 门限，确保每次都真的绘制
      clockState.now += stepMs;
      const callbacks = timers.rafCallbacks.splice(0, timers.rafCallbacks.length);
      for (const callback of callbacks) callback(clock);
    }
  }

  // 按真实帧间隔同步推进 rAF 时钟与业务时钟，用于模拟指定刷新率。
  function frameBy(stepMs, steps = 1) {
    for (let index = 0; index < steps; index++) {
      clock += stepMs;
      clockState.now += stepMs;
      const callbacks = timers.rafCallbacks.splice(0, timers.rafCallbacks.length);
      for (const callback of callbacks) callback(clock);
    }
  }

  function fireTimeoutByDelay(delay) {
    const found = [...timers.timeouts].find(([, entry]) => entry.delay === delay);
    if (!found) return false;
    const [id, entry] = found;
    timers.timeouts.delete(id);
    entry.fn();
    return true;
  }

  return {
    window, document, bridge, runtime, environment: sandbox, petContext, contexts, frame, frameBy, timers, clockState, created,
    fireTimeoutByDelay
  };
}

module.exports = { createPetRuntimeFixture };
