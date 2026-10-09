'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverSurfaceClient } = require('../src/surfaces/popover/adapter/surface-client.mjs');
const { createPopoverProjectionStore } = require('../src/surfaces/popover/state/projection-store.mjs');
const { createPopoverTodayFeature } = require('../src/surfaces/popover/features/today.mjs');
const { createPopoverWorkFeature } = require('../src/surfaces/popover/features/work.mjs');
const { createPopoverSettingsFeature } = require('../src/surfaces/popover/features/settings.mjs');
const { createPopoverShellFeature } = require('../src/surfaces/popover/features/shell.mjs');
const { createPopoverFocusTimer } = require('../src/surfaces/popover/features/focus-timer.mjs');
const { createPopoverAppChrome } = require('../src/surfaces/popover/features/app-chrome.mjs');
const { createPopoverEnergyStrip } = require('../src/surfaces/popover/features/energy-strip.mjs');
const { createPopoverSettingsDrawer } = require('../src/surfaces/popover/features/settings-drawer.mjs');
const { popoverSessionView } = require('../src/surfaces/popover/state/session-view.mjs');
const { createPopoverModalPrimitive } = require('../src/surfaces/popover/ui/modal.mjs');
const { applyStateDelta } = require('../src/core/state-channel.mjs');

function createBridge() {
  const listeners = new Set();
  let unsubscribeCount = 0;
  const state = { revision: 1, tasks: [], settings: { dnd: false } };
  const bridge = new Proxy({
      getState: async () => structuredClone(state),
      onStateDiff: callback => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
          unsubscribeCount += 1;
        };
      },
      updateSettings: async patch => ({ ok: true, patch }),
      hidePopover: () => undefined
  }, {
    get(target, key) {
      return Object.prototype.hasOwnProperty.call(target, key) ? target[key] : () => undefined;
    }
  });
  return {
    bridge,
    emit(message) {
      for (const listener of [...listeners]) listener(message);
    },
    listenerCount: () => listeners.size,
    unsubscribeCount: () => unsubscribeCount
  };
}

test('popover surface client exposes only the reviewed scoped bridge methods', async () => {
  const fixture = createBridge();
  const client = createPopoverSurfaceClient(fixture.bridge);
  assert.equal(Object.isFrozen(client), true);
  assert.equal(typeof client.getState, 'function');
  assert.equal(typeof client.updateSettings, 'function');
  assert.deepEqual(await client.updateSettings({ dnd: true }), { ok: true, patch: { dnd: true } });
  assert.throws(
    () => createPopoverSurfaceClient({ getState() {}, onStateDiff() {}, onPopoverHidden() {} }),
    /missing addTask/
  );
});

test('projection store applies deltas, reloads gaps, and unsubscribes on dispose', async () => {
  const fixture = createBridge();
  const client = createPopoverSurfaceClient(fixture.bridge);
  const store = createPopoverProjectionStore({ client, stateChannel: { applyStateDelta } });
  const changes = [];
  store.subscribe(change => changes.push(change));

  await store.start();
  assert.equal(store.getState().revision, 1);
  assert.equal(fixture.listenerCount(), 1);

  fixture.emit({
    revision: 2,
    dirty: { settings: true },
    delta: { settings: { dnd: true } }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().settings.dnd, true);
  assert.equal(changes.at(-1).dirty.settings, true);

  fixture.emit({ revision: 4, dirty: { tasks: true }, delta: { tasks: [{ id: 'bad-gap' }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getState().revision, 2);
  assert.deepEqual(changes.at(-1).dirty, { settings: true });

  store.dispose();
  store.dispose();
  assert.equal(fixture.listenerCount(), 0);
  assert.equal(fixture.unsubscribeCount(), 1);
  fixture.emit({ revision: 2, dirty: { settings: true }, delta: { settings: { dnd: false } } });
  assert.equal(changes.length, 2);
});

test('delayed startup and gap snapshots never replace newer immutable projections', async () => {
  let receive;
  const requests = [];
  const store = createPopoverProjectionStore({
    client: {
      getState: () => new Promise(resolve => requests.push(resolve)),
      onStateDiff: listener => { receive = listener; return () => {}; }
    },
    stateChannel: { applyStateDelta }
  });
  const starting = store.start();
  const firstDiff = receive({ revision: 3, dirty: { all: true }, delta: { tasks: [{ id: 'fresh' }] } });
  requests[1]({ revision: 2, tasks: [], settings: {} });
  await firstDiff;
  requests[0]({ revision: 1, tasks: [{ id: 'stale' }] });
  await starting;
  assert.equal(store.getState().revision, 3);
  assert.equal(store.getState().tasks[0].id, 'fresh');
  assert.throws(() => { store.getState().tasks[0].id = 'mutated'; }, TypeError);
  const gap = receive({ revision: 5, dirty: { tasks: true }, delta: {} });
  requests[2]({ revision: 5, tasks: [{ id: 'snapshot' }] });
  await gap;
  assert.equal(store.getState().tasks[0].id, 'snapshot');
  store.dispose();
});

function createFeatureStore() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(dirty) {
      for (const listener of [...listeners]) listener({ state: {}, dirty });
    },
    listenerCount: () => listeners.size
  };
}

function createEventTarget() {
  const listeners = new Map();
  let registrations = 0;
  return {
    dataset: {},
    addEventListener(type, listener) {
      registrations += 1;
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    activeListenerCount() {
      return [...listeners.values()].reduce((total, group) => total + group.size, 0);
    },
    registrationCount: () => registrations,
    async emit(type) {
      for (const listener of listeners.get(type) || []) await listener({ target: this });
    }
  };
}

function createDomDependencies() {
  const targets = new Map();
  const select = selector => {
    if (!targets.has(selector)) targets.set(selector, createEventTarget());
    return targets.get(selector);
  };
  // 真实的 document 是事件目标（visibilitychange 等）；把它也登记进 targets，
  // 这样“挂两次不重复登记、销毁时全部摘掉”的检查同样覆盖它。
  const documentTarget = select('document');
  documentTarget.querySelector = select;
  documentTarget.querySelectorAll = () => [];
  documentTarget.documentElement = { dataset: {}, style: { setProperty() {} } };
  return {
    targets,
    document: documentTarget,
    $: select,
    $$: selector => [select(selector)]
  };
}

function createSurfaceDependencies() {
  const dom = createDomDependencies();
  const state = { settings: { dnd: false, soundEnabled: false } };
  return {
    ...dom,
    getState: () => state,
    getSession: () => ({ status: 'idle', running: false, paused: false, taskId: null }),
    pad2: value => String(value).padStart(2, '0'),
    setStatusLine: () => undefined,
    sessionDuration: {},
    surfaceClient: {},
    focusActionMessage: () => '',
    currentTask: () => null,
    escapeHTML: value => value,
    syncPressedButtons: () => undefined,
    nextRovingIndex: () => null,
    onTabShown: () => undefined,
    fallbackReasonText: () => '',
    motionReduced: () => false,
    clearDecorativeMotion: () => undefined,
    renderExpiryPreview: () => undefined,
    activeLandingPrompt: () => null,
    rememberLandingReturnFocus: () => undefined,
    renderLanding: () => undefined
  };
}

function createRendererMap(names) {
  return Object.fromEntries(names.map(name => [name, () => undefined]));
}

const FACTORY_CASES = [
  {
    name: 'today',
    create: createPopoverTodayFeature,
    args: { renderers: createRendererMap([
      'renderHeader', 'renderPomoStructure', 'renderPomoTick',
      'renderNowCard', 'renderNowTaskDetail', 'renderLanding'
    ]) },
    missing: ['renderers']
  },
  {
    name: 'work',
    create: createPopoverWorkFeature,
    args: { renderers: createRendererMap(['renderTaskList', 'renderArchivedTasks', 'renderImpulseList']) },
    missing: ['renderers']
  },
  {
    name: 'settings',
    create: createPopoverSettingsFeature,
    args: { renderers: createRendererMap([
      'renderSettings', 'renderShortcutSetting', 'renderStrategyRoute', 'renderReviewCards',
      'renderDurationPicker', 'renderMigrationNotices'
    ]) },
    missing: ['renderers']
  },
  {
    name: 'shell',
    create: createPopoverShellFeature,
    args: { renderers: createRendererMap(['applyTheme', 'renderEnergy', 'renderDND']) },
    missing: ['renderers']
  },
  {
    name: 'focus-timer',
    create: createPopoverFocusTimer,
    eventTarget: '#btnStopFocus',
    expectedCommand: ['stopPomodoro'],
    timers: 1,
    args: createSurfaceDependencies(),
    missing: [
      'document', '$', '$$', 'getState', 'getSession', 'pad2', 'setStatusLine',
      'sessionDuration', 'surfaceClient', 'focusActionMessage', 'currentTask'
    ]
  },
  {
    name: 'app-chrome',
    create: createPopoverAppChrome,
    eventTarget: '#dndPill',
    expectedCommand: ['updateSettings', { dnd: true }],
    timers: 0,
    args: createSurfaceDependencies(),
    missing: [
      'document', '$', '$$', 'getState', 'getSession', 'surfaceClient', 'escapeHTML',
      'nextRovingIndex', 'onTabShown'
    ]
  },
  {
    // The energy strip moved out of the chrome because the same curve is painted a second
    // time above the day timeline (F6 section 11b). It is listed here without an
    // eventTarget on purpose: its only control reports a check-in stamped with
    // Date.now(), which has no stable expectedCommand — the dedicated feature test
    // covers the click.
    name: 'energy-strip',
    create: createPopoverEnergyStrip,
    timers: 0,
    args: createSurfaceDependencies(),
    missing: ['$', '$$', 'getState', 'surfaceClient', 'escapeHTML', 'syncPressedButtons']
  },
  {
    name: 'settings-drawer',
    create: createPopoverSettingsDrawer,
    eventTarget: '[data-toggle="soundEnabled"]',
    expectedCommand: ['updateSettings', { soundEnabled: true }],
    timers: 0,
    args: createSurfaceDependencies(),
    missing: [
      'document', '$', '$$', 'getState', 'surfaceClient', 'sessionDuration', 'syncPressedButtons',
      'fallbackReasonText', 'motionReduced', 'clearDecorativeMotion', 'renderExpiryPreview',
      'activeLandingPrompt', 'rememberLandingReturnFocus', 'renderLanding'
    ]
  }
];

test('popover factories expose frozen APIs and reject every missing injected dependency', () => {
  for (const entry of FACTORY_CASES) {
    const feature = entry.create(entry.args);
    assert.equal(Object.isFrozen(feature), true, `${entry.name} API must be frozen`);
    assert.equal(typeof feature.mount, 'function', `${entry.name} must expose mount()`);
    assert.equal(typeof feature.dispose, 'function', `${entry.name} must expose dispose()`);
    assert.throws(() => entry.create(), TypeError, entry.name);

    for (const dependency of entry.missing) {
      const args = { ...entry.args, [dependency]: undefined };
      assert.throws(
        () => entry.create(args),
        TypeError,
        `${entry.name} must reject missing ${dependency}`
      );
    }
    for (const name of Object.keys(entry.args.renderers || {})) {
      assert.throws(() => entry.create({
        renderers: { ...entry.args.renderers, [name]: undefined }
      }), TypeError, `${entry.name} must reject missing renderer ${name}`);
    }
    feature.dispose();
  }
});

test('popover projection features mount once, select their dirty slices, and dispose cleanly', () => {
  const store = createFeatureStore();
  const calls = [];
  const renderer = name => () => calls.push(name);
  const today = createPopoverTodayFeature({
    renderers: {
      renderHeader: renderer('header'),
      renderPomoStructure: renderer('pomo'),
      renderPomoTick: renderer('tick'),
      renderNowCard: renderer('now'),
      renderNowTaskDetail: renderer('detail'),
      renderLanding: renderer('landing')
    }
  });
  const work = createPopoverWorkFeature({
    renderers: {
      renderTaskList: renderer('tasks'),
      renderArchivedTasks: renderer('archive'),
      renderImpulseList: renderer('impulses')
    }
  });
  const settings = createPopoverSettingsFeature({
    renderers: {
      renderSettings: renderer('settings'),
      renderShortcutSetting: renderer('shortcut'),
      renderStrategyRoute: renderer('strategy'),
      renderReviewCards: renderer('reviews'),
      renderDurationPicker: renderer('duration'),
      renderMigrationNotices: renderer('notices')
    }
  });
  const shell = createPopoverShellFeature({
    renderers: {
      applyTheme: renderer('theme'),
      renderEnergy: renderer('energy'),
      renderDND: renderer('dnd')
    }
  });

  for (const feature of [today, work, settings, shell]) {
    assert.throws(() => feature.mount(), TypeError);
    feature.mount(store);
    feature.mount(store);
  }
  assert.equal(store.listenerCount(), 4);

  store.emit({ tasks: true });
  assert.deepEqual(calls, [
    'header', 'pomo', 'tick', 'now', 'detail', 'landing', 'tasks', 'archive',
    'theme', 'energy', 'dnd'
  ]);

  for (const feature of [today, work, settings, shell]) {
    feature.dispose();
    feature.dispose();
  }
  assert.equal(store.listenerCount(), 0);
  store.emit({ all: true });
  assert.equal(calls.length, 11, 'disposed features must not receive later projections');
});

test('DOM popover features mount once and dispose their listeners and timers', async context => {
  const timers = new Map();
  let nextTimerId = 0;
  const schedule = context.mock.method(globalThis, 'setInterval', (callback, delay) => {
    const timerId = ++nextTimerId;
    timers.set(timerId, { callback, delay });
    return timerId;
  });
  context.mock.method(globalThis, 'clearInterval', timerId => {
    assert.ok(timers.delete(timerId), 'only an active timer may be cleared');
  });
  for (const entry of FACTORY_CASES.filter(entry => entry.eventTarget)) {
    const args = createSurfaceDependencies();
    const commands = [];
    args.surfaceClient = {
      stopPomodoro: () => commands.push(['stopPomodoro']),
      updateSettings: patch => commands.push(['updateSettings', patch])
    };
    const feature = entry.create(args);
    try {
      feature.mount();
      const registrations = [...args.targets.values()].map(target => target.registrationCount());
      const timerRegistrations = schedule.mock.callCount();
      assert.ok(registrations.length > 0, `${entry.name} must bind controls`);
      assert.equal(timers.size, entry.timers, entry.name);
      if (entry.timers) assert.equal([...timers.values()][0].delay, 500);
      feature.mount();
      assert.deepEqual([...args.targets.values()].map(target => target.registrationCount()), registrations);
      assert.equal(schedule.mock.callCount(), timerRegistrations, `${entry.name} scheduled twice`);
      await args.$(entry.eventTarget).emit('click');
      assert.deepEqual(commands, [entry.expectedCommand]);
    } finally {
      feature.dispose();
    }
    feature.dispose();
    assert.equal(timers.size, 0, `${entry.name} leaked a timer`);
    for (const [selector, target] of args.targets) {
      assert.equal(target.activeListenerCount(), 0, `${entry.name} leaked listeners on ${selector}`);
    }
    await args.$(entry.eventTarget).emit('click');
    assert.deepEqual(commands, [entry.expectedCommand], `${entry.name} handled a click after disposal`);
  }
});

test('popover session view keeps lifecycle identity while overlaying monotonic timing projection', () => {
  assert.deepEqual(popoverSessionView(null), {
    status: 'idle', running: false, paused: false, taskId: null
  });
  assert.deepEqual(popoverSessionView({
    focusSession: {
      sessionId: 'session-1', status: 'paused', kind: 'break', taskId: 'task-1', elapsedMs: 900
    },
    pomodoro: { remainingMs: 1200, mode: 'focus', running: true }
  }), {
    sessionId: 'session-1', status: 'paused', kind: 'break', taskId: 'task-1', elapsedMs: 900,
    remainingMs: 1200, mode: 'break', running: false, paused: true
  });
  assert.deepEqual(popoverSessionView({ pomodoro: { running: true, mode: 'focus', remainingMs: 500 } }), {
    running: true, mode: 'focus', remainingMs: 500, status: 'focus', paused: false
  });
  for (const [status, kind, pausedFrom, mode, running, paused] of [
    ['focus', undefined, undefined, 'focus', true, false],
    ['quick-start', undefined, undefined, 'quick-start', true, false],
    ['break', undefined, undefined, 'break', true, false],
    ['paused', undefined, 'quick-start', 'quick-start', false, true],
    ['paused', 'focus', 'break', 'focus', false, true],
    ['idle', undefined, undefined, 'focus', false, false]
  ]) {
    const state = Object.freeze({
      focusSession: Object.freeze({ status, kind, pausedFrom, sessionId: 'session-1', remainingMs: 900 }),
      pomodoro: Object.freeze({ remainingMs: 500, status: 'break', mode: 'break', running: true, paused: true })
    });
    const before = structuredClone(state);
    const view = popoverSessionView(state);
    assert.deepEqual(view, {
      status, kind, pausedFrom, sessionId: 'session-1', remainingMs: 500, mode, running, paused
    });
    assert.deepEqual(state, before, 'session view must not mutate its projection input');
  }
});

test('modal primitive excludes hidden controls and wraps the tab ring', () => {
  const primitive = createPopoverModalPrimitive({
    $: () => null,
    $$: () => []
  });
  const hidden = { closest: selector => selector === 'details:not([open])' ? { querySelector: () => null } : null };
  assert.equal(primitive.insideCollapsedDetails(hidden), true);
  assert.equal(primitive.insideCollapsedDetails({ closest: () => null }), false);
});
