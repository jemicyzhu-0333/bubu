'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const processPorts = require('node:child_process');
let uninjectedProcessCalls = 0;
for (const port of ['exec', 'execFile', 'spawn']) {
  test.mock.method(processPorts, port, () => {
    uninjectedProcessCalls += 1;
    throw new Error(`Uninjected reminder process port: ${port}`);
  });
}
test.after(() => assert.equal(uninjectedProcessCalls, 0, 'all reminder process calls must be injected'));
const fs = require('node:fs');
const path = require('node:path');
const { CHARACTERS } = require('../src/content/nudge-characters');
const { nudgePolicy } = require('../src/capabilities/attention');
const { createNudgeHost, systemPrefersReducedMotion } = require('../src/platform/electron/nudge-host');
const { createScreenHost } = require('../src/platform/electron/screen-host');
const { createShortcutHost } = require('../src/platform/electron/shortcuts');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * The reminder host with the OS replaced by fakes.
 *
 * Everything the host is allowed to reach — windows, notifications, displays,
 * global chords, the foreground-app probe and its own timers — arrives through
 * the constructor, so these tests exercise the real escalation and deferral
 * behaviour without Electron and without waiting in real time.
 */
function createNudgeHarness({ systemReducedMotion = false, presentCompanion = null, foreground = '"LSDisplayName"="Editor"' } = {}) {
  const notifications = [];
  const windows = [];
  const timers = new Map();
  const registeredShortcuts = new Map();
  let nextTimerId = 1;
  let now = 0;
  let focusedWindow = null;
  let cursorPoint = { x: 2400, y: 400 };

  const primary = {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 0, width: 1440, height: 900 }
  };
  const secondary = {
    id: 2,
    bounds: { x: 1920, y: 0, width: 1280, height: 900 },
    workArea: { x: 1920, y: 0, width: 1280, height: 900 }
  };

  function fakeSetTimeout(callback, delay = 0) {
    const id = nextTimerId++;
    timers.set(id, { id, callback, delay, dueAt: now + delay, cleared: false, ran: false });
    return id;
  }

  function fakeClearTimeout(id) {
    const timer = timers.get(id);
    if (timer) timer.cleared = true;
  }

  class FakeWebContents {
    constructor() {
      this.handlers = new Map();
      this.sent = [];
    }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    on(event, handler) {
      const handlers = this.handlers.get(event) || [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }
    emit(event, ...args) {
      for (const handler of this.handlers.get(event) || []) handler(...args);
    }
    send(...args) { this.sent.push(args); }
    isDestroyed() { return false; }
  }

  class FakeBrowserWindow {
    static getFocusedWindow() { return focusedWindow; }
    constructor(options) {
      this.options = { ...options };
      this.destroyed = false;
      this.visible = false;
      this.showInactiveCalls = 0;
      this.focusCalls = 0;
      this.ignoreMouseEventsCalls = [];
      this.setPositionCalls = [];
      this.webContents = new FakeWebContents();
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    close() { this.destroyed = true; this.visible = false; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; this.showInactiveCalls += 1; }
    focus() { focusedWindow = this; this.focusCalls += 1; }
    getBounds() {
      return {
        x: this.options.x,
        y: this.options.y,
        width: this.options.width,
        height: this.options.height
      };
    }
    setPosition(x, y, animate) {
      this.options.x = x;
      this.options.y = y;
      this.setPositionCalls.push({ x, y, animate });
    }
    setIgnoreMouseEvents(ignore, options) { this.ignoreMouseEventsCalls.push([ignore, options]); }
    setVisibleOnAllWorkspaces() {}
    loadFile(file) { this.loadedFile = file; queueMicrotask(() => this.webContents.emit('did-finish-load')); }
  }

  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.closed = false;
      this.shown = false;
      notifications.push(this);
    }
    on(event, handler) {
      const handlers = this.handlers.get(event) || [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }
    emit(event, ...args) {
      for (const handler of this.handlers.get(event) || []) handler(...args);
    }
    removeListener(event, handler) {
      this.handlers.set(event, (this.handlers.get(event) || []).filter(candidate => candidate !== handler));
    }
    show() { this.shown = true; this.emit('show'); }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    }
  }

  const globalShortcut = {
    register(accelerator, callback) {
      if (registeredShortcuts.has(accelerator)) return false;
      registeredShortcuts.set(accelerator, callback);
      return true;
    },
    isRegistered: accelerator => registeredShortcuts.has(accelerator),
    unregister: accelerator => registeredShortcuts.delete(accelerator),
    unregisterAll: () => registeredShortcuts.clear()
  };
  const screen = {
    getPrimaryDisplay: () => primary,
    getCursorScreenPoint: () => ({ ...cursorPoint }),
    getDisplayNearestPoint: point => point.x >= 1600 ? secondary : primary
  };

  const canonical = new Map();
  const host = createNudgeHost({
    platform: 'darwin',
    resolveRoutineRequest: ({ occurrenceId }) => canonical.get(occurrenceId) || null,
    presentCompanion,
    BrowserWindow: FakeBrowserWindow,
    Notification: FakeNotification,
    nativeTheme: {
      get shouldUseReducedMotion() { return systemReducedMotion; }
    },
    systemPreferences: {
      getAnimationSettings: () => ({ prefersReducedMotion: systemReducedMotion })
    },
    screenHost: createScreenHost({ screen }),
    shortcutHost: createShortcutHost({ globalShortcut }),
    preloadPath: '/app/preload-nudge.js',
    cornerPagePath: '/app/renderer/nudge-corner.html',
    fullscreenPagePath: '/app/renderer/nudge-fullscreen.html',
    exec: (_command, _options, callback) => callback(null, foreground),
    execFile: processPorts.execFile,
    setTimer: fakeSetTimeout,
    clearTimer: fakeClearTimeout
  });

  // Every routine fixture represents a loaded canonical occurrence. Tests for
  // missing IDs or stale authority use the lifecycle harness directly.
  const api = { ...host, startNudgeSequence(request) {
    if (request.type !== 'routine') return host.startNudgeSequence(request);
    const context = { routineId: 'fixture-routine', occurrenceId: 'fixture-routine:2026-10-07:09:00', ...request.context };
    const resolved = { ...request, context };
    canonical.set(context.occurrenceId, resolved);
    return host.startNudgeSequence(resolved);
  } };

  async function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.values()]
        .filter(timer => !timer.cleared && !timer.ran && timer.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      now = next.dueAt;
      next.ran = true;
      next.callback();
      for (let flush = 0; flush < 12; flush += 1) await Promise.resolve();
    }
    now = target;
    await Promise.resolve();
  }

  return {
    api,
    notifications,
    windows,
    timers,
    registeredShortcuts,
    advance,
    activeTimers: () => [...timers.values()].filter(timer => !timer.cleared && !timer.ran),
    forceTimer: id => timers.get(id).callback(),
    triggerShortcut(accelerator) {
      const callback = registeredShortcuts.get(accelerator);
      if (callback) callback();
      return Boolean(callback);
    },
    setFocusedBounds(bounds) {
      focusedWindow = bounds ? {
        isDestroyed: () => false,
        getBounds: () => ({ ...bounds })
      } : null;
    },
    setCursorPoint(point) { cursorPoint = { ...point }; },
    setSystemReducedMotion(value) { systemReducedMotion = Boolean(value); }
  };
}

function reminderOptions(message, priority, deferMinutes, maxLevel = 1) {
  return {
    type: 'rest',
    message,
    priority,
    maxLevel,
    character: 'cat',
    whitelist: [],
    actions: [
      { id: 'close', label: '关闭' },
      { id: 'later', label: `${deferMinutes} 分钟后提醒`, deferMinutes }
    ],
    context: { kind: priority === 100 ? 'work-end' : 'routine' }
  };
}

test('routine L1 uses one pet message and DND replaces escalation with quiet native L1', async () => {
  const messages=[];const h=createNudgeHarness({presentCompanion:text=>{messages.push(text);return true;}});
  const result=await h.api.startNudgeSequence({...reminderOptions('喝点水',0,5,2),type:'routine'});
  assert.equal(result.delivery,'companion');assert.deepEqual(messages,['喝点水']);assert.equal(h.notifications.length,0);
  await h.advance(60000);assert.ok(h.windows.length>0);
  h.api.setDND(true);await h.advance(200000);
  const quiet=await h.api.startNudgeSequence({...reminderOptions('再喝水',0,5),type:'routine'});
  assert.equal(quiet.shown,true);assert.equal(quiet.level,1);assert.equal(messages.length,1);
  assert.equal(h.notifications.at(-1).options.silent,true);
  assert.ok(h.windows.every(window=>window.destroyed));
});

test('pet-unavailable, essential timing, and foreground whitelist retain native reminder actions', async () => {
  const unavailable=createNudgeHarness({presentCompanion:()=>false});
  await unavailable.api.startNudgeSequence({...reminderOptions('喝水',0,5),type:'routine'});
  assert.equal(unavailable.notifications.length,1);
  const messages=[];const essential=createNudgeHarness({presentCompanion:text=>{messages.push(text);return true;}});
  await essential.api.startNudgeSequence(reminderOptions('专注结束',100,5));
  assert.equal(essential.notifications.length,1);assert.equal(messages.length,0);
  await essential.api.startNudgeSequence({...reminderOptions('下班提醒',100,5),type:'routine'});
  assert.equal(essential.notifications.length,2);assert.equal(messages.length,0);
  const meeting=createNudgeHarness({presentCompanion:text=>{messages.push(text);return true;},foreground:'"LSDisplayName"="Zoom"'});
  const limited=await meeting.api.startNudgeSequence({...reminderOptions('喝水',0,5,3),type:'routine',whitelist:['zoom']});
  assert.equal(limited.limitedToLevel,1);assert.equal(meeting.notifications.length,1);assert.equal(messages.length,0);
  await meeting.advance(300000);assert.equal(meeting.windows.length,0);
});

test('periodic focus checks go to the pet while focus and break completion remain native', async () => {
  const messages=[];const h=createNudgeHarness({presentCompanion:text=>{messages.push(text);return true;}});
  await h.api.startNudgeSequence({...reminderOptions('专注一阵了',0,5),context:{kind:'focus-check'}});
  assert.deepEqual(messages,['专注一阵了']);assert.equal(h.notifications.length,0);
  await h.api.startNudgeSequence({...reminderOptions('结束',0,5),context:{kind:'focus-complete'}});
  assert.equal(h.notifications.length,1);
});

test('default reminder actions preserve choice and avoid pressure language', () => {
  for (const type of ['rest', 'focus']) {
    const actions = nudgePolicy.defaultActions(type);
    assert.equal(actions.length, 2);
    assert.ok(actions[0].primary);
    assert.ok(actions[1].deferMinutes > 0);
    for (const action of actions) {
      assert.doesNotMatch(action.label, /(再撑|马上|立即|必须|不许)/);
    }
  }
});

test('routine reminder policy is frozen, bounded and fail-soft', () => {
  assert.deepEqual(nudgePolicy.REMINDER_TYPES, ['focus', 'rest', 'routine']);
  assert.equal(Object.isFrozen(nudgePolicy.REMINDER_TYPES), true);

  const routine = nudgePolicy.normalizeReminderRequest({ type: 'routine', priority: 0 });
  assert.equal(routine.type, 'routine');
  assert.equal(routine.maxLevel, 2);
  assert.equal(routine.priority, 0, 'a live routine reminder remains ordinary priority');
  assert.deepEqual(routine.actions.map(action => action.label), [
    '已完成',
    '稍后（+15 分钟）',
    '今天跳过'
  ]);
  assert.equal(routine.actions[1].deferMinutes, 15);
  assert.equal(nudgePolicy.normalizeReminderRequest({ type: 'routine', maxLevel: 0 }).maxLevel, 1);
  assert.equal(nudgePolicy.normalizeReminderRequest({ type: 'routine', maxLevel: 4 }).maxLevel, 3);
  assert.equal(nudgePolicy.normalizeReminderRequest({ type: 'focus', maxLevel: 4 }).maxLevel, 4);
  assert.equal(nudgePolicy.normalizeReminderRequest({ type: 'rest', maxLevel: 4 }).maxLevel, 4);
  assert.equal(nudgePolicy.normalizeReminderRequest({ type: 'unknown' }).type, 'rest');
  assert.match(nudgePolicy.reminderTitle('routine'), /^⏰/);

  const state = { ...routine, instanceId: 1 };
  assert.equal(nudgePolicy.planDismissal(state, 'dismiss').ok, true);
  assert.equal(nudgePolicy.planDismissal(state, 'acknowledge').ok, true);
  assert.equal(nudgePolicy.planDismissal(state, 'not-offered').ok, false);
  assert.equal(nudgePolicy.deferralPriority('routine', routine.priority), 100);
  assert.equal(nudgePolicy.deferralPriority('rest', 0), 0);
});

test('routine reminders never preview the level-4 covering surface', async () => {
  const harness = createNudgeHarness();
  const result = await harness.api.showLevel({
    type: 'routine', level: 4, character: 'cat', message: 'routine preview'
  });
  assert.equal(result.level, 3);
  assert.equal(harness.windows.filter(window => !window.destroyed).length, 4);
});

test('reduced-motion detection supports Electron 44 and an injectable nativeTheme signal', () => {
  assert.equal(systemPrefersReducedMotion({
    theme: { shouldUseReducedMotion: true },
    preferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) }
  }), true);
  assert.equal(systemPrefersReducedMotion({
    theme: {},
    preferences: { getAnimationSettings: () => ({ prefersReducedMotion: true }) }
  }), true);
  // 系统偏好只能收紧动效,不能推翻用户显式选择的 full。
  assert.equal(nudgePolicy.shouldReduceNudgeMotion('full', true), false);
  assert.equal(nudgePolicy.shouldReduceNudgeMotion('reduced', false), true);
});

test('built-in character lines are autonomy-supportive', () => {
  const lines = Object.values(CHARACTERS)
    .flatMap(character => Object.values(character.lines).flat());
  const coerciveOrShaming = /(警告|快枯了|在看着你|继续加油|立即执行|Get up\.|save the day)/i;

  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.equal(typeof line, 'string');
    assert.ok(line.trim());
    assert.doesNotMatch(line, coerciveOrShaming);
  }
});

// 动作与感官档案要真的走到 renderer,所以这里盯的是两端的契约,而不是 host 内部实现。
test('the reminder surfaces receive real actions and live sensory updates', () => {
  const corner = read('src/renderer/nudge-corner.html');
  const preload = read('src/preload-nudge.js');
  assert.match(corner, /Array\.isArray\(data\.actions\)/);
  assert.match(corner, /dismissNudge\(action\.id \|\| 'dismiss'\)/);
  assert.match(preload, /ipcRenderer\.on\('nudge:focus-controls'/);
  assert.match(preload, /ipcRenderer\.on\('nudge:sensory-profile'/);
  assert.match(corner, /window\.bubu\.onNudgeFocus/);
  assert.match(corner, /window\.bubu\.onNudgeSensoryProfile\(applyNudgeSensoryProfile\)/);
  assert.match(read('src/renderer/nudge-fullscreen.html'), /window\.bubu\.onNudgeSensoryProfile\(applyNudgeSensoryProfile\)/);
  assert.match(read('src/main.js'), /updateSensory: settings => nudge\.updateSensoryProfile\(settings\)/);
  assert.match(corner, /if \(e\.key !== 'Tab'\) return/);
});

test('work-end reminders are raised at the protected priority', () => {
  assert.match(read('src/bootstrap/work-boundary-reminder.js'), /context: \{ kind: 'work-end', dayKey: boundaryDay \},\s*priority: 100/);
  assert.match(read('src/main.js'), /createWorkBoundaryReminder\(\{[\s\S]*?startNudgeSequence:/);
  assert.equal(nudgePolicy.PROTECTED_DEFERRED_PRIORITY <= 100, true);
});

test('closing an L1-only notification releases its priority guard', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('work-end', 100, 5, 1));
  harness.notifications.at(-1).close();

  const routine = await api.startNudgeSequence(reminderOptions('routine', 0, 2, 1));
  assert.equal(routine.shown, true);
  assert.equal(harness.notifications.at(-1).options.body, 'routine');
});

test('a reminder accepts only an action it actually offered and only from its current window', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;
  const handled = [];
  api.setActionHandler(action => handled.push(action.actionId));
  await api.startNudgeSequence(reminderOptions('guarded', 0, 2, 2));

  const forged = api.dismissCurrentNudge('accept-focus');
  assert.equal(forged.handled, false);
  assert.equal(forged.reason, 'action-not-offered');
  assert.deepEqual(handled, []);

  await harness.advance(60 * 1000);
  const currentWindow = harness.windows.find(window => !window.destroyed);
  const staleSender = {};
  assert.equal(api.dismissCurrentNudge('close', staleSender).handled, false);
  assert.equal(api.dismissCurrentNudge('close', currentWindow.webContents).handled, true);
  assert.deepEqual(handled, ['close']);
});

test('deferred reminders coexist by instance and a routine close cannot cancel work-end', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('work-end', 100, 5));
  assert.equal(api.dismissCurrentNudge('later').deferMinutes, 5);

  await api.startNudgeSequence(reminderOptions('routine', 0, 2));
  assert.equal(api.dismissCurrentNudge('later').deferMinutes, 2);
  assert.deepEqual(
    harness.activeTimers().map(timer => timer.delay).sort((a, b) => a - b),
    [2 * 60 * 1000, 5 * 60 * 1000]
  );

  await harness.advance(2 * 60 * 1000);
  assert.equal(harness.notifications.at(-1).options.body, 'routine');
  assert.equal(api.dismissCurrentNudge('close').handled, true);
  assert.deepEqual(harness.activeTimers().map(timer => timer.dueAt), [5 * 60 * 1000]);

  await harness.advance(3 * 60 * 1000);
  assert.equal(harness.notifications.at(-1).options.body, 'work-end');

  const blocked = await api.startNudgeSequence(reminderOptions('lower-priority', 0, 2));
  assert.deepEqual({ shown: blocked.shown, reason: blocked.reason }, {
    shown: false,
    reason: 'higher-priority-active'
  });
});

test('DND closes non-routine surfaces and cancels non-routine deferrals', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('work-end', 100, 5));
  api.dismissCurrentNudge('later');
  await api.startNudgeSequence(reminderOptions('routine', 0, 2));
  api.dismissCurrentNudge('later');

  await api.startNudgeSequence(reminderOptions('visible', 0, 10, 2));
  await harness.advance(60 * 1000);
  assert.ok(harness.windows.some(window => !window.destroyed));
  assert.ok(harness.notifications.some(notification => !notification.closed));

  const countBeforeDND = harness.notifications.length;
  api.setDND(true);
  assert.ok(harness.windows.every(window => window.destroyed));
  assert.ok(harness.notifications.every(notification => notification.closed));
  assert.equal(harness.activeTimers().length, 0);

  await harness.advance(10 * 60 * 1000);
  assert.equal(harness.notifications.length, countBeforeDND);
  const silenced = await api.startNudgeSequence(reminderOptions('silenced', 0, 2));
  assert.deepEqual({ shown: silenced.shown, reason: silenced.reason }, {
    shown: false,
    reason: 'dnd'
  });
});

test('ordinary clear removes routine deferrals but preserves priority-100 work-end', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('work-end', 100, 5));
  api.dismissCurrentNudge('later');
  await api.startNudgeSequence(reminderOptions('routine', 0, 2));
  api.dismissCurrentNudge('later');

  await api.clearNudge();
  assert.deepEqual(harness.activeTimers().map(timer => timer.delay), [5 * 60 * 1000]);

  const notificationCount = harness.notifications.length;
  await harness.advance(2 * 60 * 1000);
  assert.equal(harness.notifications.length, notificationCount, 'routine deferral is removed');
  await harness.advance(3 * 60 * 1000);
  assert.equal(harness.notifications.at(-1).options.body, 'work-end');
});

test('a user-deferred routine survives ordinary clear without becoming a priority-100 live reminder', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;
  const routine = {
    type: 'routine',
    message: 'routine dose',
    priority: 0,
    maxLevel: 4,
    character: 'cat',
    whitelist: []
  };

  assert.equal((await api.startNudgeSequence(routine)).shown, true);
  assert.equal((await api.startNudgeSequence(reminderOptions('ordinary replacement', 0, 2))).shown, true,
    'a live routine must not block another ordinary reminder');

  await api.startNudgeSequence(routine);
  assert.equal(api.dismissCurrentNudge('defer-15').deferMinutes, 15);
  await api.clearNudge();
  assert.deepEqual(harness.activeTimers().map(timer => timer.delay), [15 * 60 * 1000]);

  await harness.advance(15 * 60 * 1000);
  assert.equal(harness.notifications.at(-1).options.body, 'routine dose');
  const afterReplay = await api.startNudgeSequence(reminderOptions('after replay', 0, 2));
  assert.equal(afterReplay.shown, true, 'replay must retain the routine request priority of zero');
  assert.equal(harness.notifications.at(-1).options.body, 'after replay');
});

test('explicit all-deferred clear is reserved for global shutdown semantics', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('work-end', 100, 5));
  api.dismissCurrentNudge('later');
  await api.startNudgeSequence(reminderOptions('routine', 0, 2));
  api.dismissCurrentNudge('later');
  await api.clearNudge({ deferredPolicy: 'all' });

  assert.equal(harness.activeTimers().length, 0);
  const notificationCount = harness.notifications.length;
  await harness.advance(10 * 60 * 1000);
  assert.equal(harness.notifications.length, notificationCount);
});

test('disposing the nudge host releases visible and deferred resources', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('deferred', 100, 5));
  api.dismissCurrentNudge('later');
  await api.startNudgeSequence(reminderOptions('visible', 0, 10, 2));
  await harness.advance(60 * 1000);

  api.dispose();

  assert.ok(harness.windows.every(window => window.destroyed));
  assert.ok(harness.notifications.every(notification => notification.closed));
  assert.equal(harness.activeTimers().length, 0);
});

test('L2, L3 and L4 use the focused or cursor display instead of the primary display', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;
  harness.setFocusedBounds({ x: 2100, y: 100, width: 700, height: 600 });

  let start = harness.windows.length;
  await api.showLevel({ type: 'rest', level: 2, character: 'cat', message: 'L2' });
  let created = harness.windows.slice(start);
  assert.equal(created.length, 1);
  assert.ok(created.every(window => window.options.x >= 1920));

  start = harness.windows.length;
  await api.showLevel({ type: 'rest', level: 3, character: 'cat', message: 'L3' });
  created = harness.windows.slice(start);
  assert.equal(created.length, 4);
  assert.ok(created.every(window => window.options.x >= 1920));

  harness.setFocusedBounds(null);
  harness.setCursorPoint({ x: 2500, y: 300 });
  start = harness.windows.length;
  await api.showLevel({ type: 'rest', level: 4, character: 'cat', message: 'L4' });
  created = harness.windows.slice(start);
  assert.equal(created.length, 1);
  assert.equal(created[0].options.x, 1920);
  assert.equal(created[0].options.width, 1280);
});

test('L2 and L3 remain passive until the user explicitly invokes their temporary keyboard bridge', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  for (const [level, expectedCount] of [[2, 1], [3, 4]]) {
    const start = harness.windows.length;
    await api.showLevel({
      type: 'rest', level, character: 'cat', message: `L${level}`,
      stimulationMode: 'balanced', motionMode: 'balanced'
    });
    const created = harness.windows.slice(start);
    assert.equal(created.length, expectedCount);
    assert.ok(created.every(window => window.options.focusable === true));

    for (const window of created) window.webContents.emit('did-finish-load');
    assert.ok(created.every(window => window.showInactiveCalls === 1));
    assert.ok(created.every(window => window.focusCalls === 0), 'reveal must not steal focus');
    assert.equal(harness.registeredShortcuts.has('Alt+Shift+N'), true);
    const initPayload = created[0].webContents.sent.find(([channel]) => channel === 'nudge:init')[1];
    assert.equal(initPayload.keyboardShortcut, '⌥⇧N');

    assert.equal(harness.triggerShortcut('Alt+Shift+N'), true);
    assert.equal(created[0].focusCalls, 1, 'focus moves only after the explicit shortcut');
    const [ignoreMouse, mouseOptions] = created[0].ignoreMouseEventsCalls.at(-1);
    assert.equal(ignoreMouse, false);
    assert.equal(mouseOptions.forward, true);
    assert.ok(created[0].webContents.sent.some(([channel]) => channel === 'nudge:focus-controls'));

    assert.equal(api.dismissCurrentNudge('dismiss', created[0].webContents).handled, true);
    assert.equal(harness.registeredShortcuts.has('Alt+Shift+N'), false, 'shortcut is scoped to the visible corner reminder');
  }
});

test('L3 convergence follows OS reduced motion unless full motion is explicit', async () => {
  const reduced = createNudgeHarness({ systemReducedMotion: true });
  await reduced.api.showLevel({
    type: 'rest', level: 3, character: 'cat', message: 'reduced by OS',
    stimulationMode: 'balanced', motionMode: 'balanced'
  });
  const reducedWindows = reduced.windows.filter(window => !window.destroyed);
  await reduced.advance(3_000);
  assert.ok(reducedWindows.every(window => window.setPositionCalls.length === 0));

  const explicitFull = createNudgeHarness({ systemReducedMotion: true });
  await explicitFull.api.showLevel({
    type: 'rest', level: 3, character: 'cat', message: 'explicit full',
    stimulationMode: 'balanced', motionMode: 'full'
  });
  const fullWindows = explicitFull.windows.filter(window => !window.destroyed);
  await explicitFull.advance(3_000);
  assert.ok(fullWindows.every(window => (
    window.setPositionCalls.length === 1 && window.setPositionCalls[0].animate === true
  )));

  const changedDuringLeadIn = createNudgeHarness();
  await changedDuringLeadIn.api.showLevel({
    type: 'rest', level: 3, character: 'cat', message: 'OS changes before movement',
    stimulationMode: 'balanced', motionMode: 'balanced'
  });
  const changedWindows = changedDuringLeadIn.windows.filter(window => !window.destroyed);
  changedDuringLeadIn.setSystemReducedMotion(true);
  await changedDuringLeadIn.advance(3_000);
  assert.ok(changedWindows.every(window => window.setPositionCalls.length === 0));
});

test('visible and escalating nudges adopt sensory setting changes without stale motion', async () => {
  const reduced = createNudgeHarness();
  await reduced.api.showLevel({
    type: 'rest', level: 3, character: 'cat', message: 'switch to reduced',
    stimulationMode: 'balanced', motionMode: 'balanced'
  });
  const reducedWindows = reduced.windows.filter(window => !window.destroyed);
  for (const window of reducedWindows) window.webContents.emit('did-finish-load');
  assert.equal(reduced.api.updateSensoryProfile({ motionMode: 'reduced' }), true);
  assert.ok(reducedWindows.every(window => window.webContents.sent.some(([channel, payload]) => (
    channel === 'nudge:sensory-profile' && payload.motionMode === 'reduced'
  ))));
  await reduced.advance(3_000);
  assert.ok(reducedWindows.every(window => (
    window.setPositionCalls.every(call => call.animate !== true)
  )));

  const low = createNudgeHarness();
  await low.api.showLevel({
    type: 'rest', level: 3, character: 'cat', message: 'switch to low stimulation',
    stimulationMode: 'balanced', motionMode: 'balanced'
  });
  const lowWindows = low.windows.filter(window => !window.destroyed);
  assert.equal(lowWindows.length, 4);
  assert.equal(low.api.updateSensoryProfile({ stimulationMode: 'low' }), true);
  assert.equal(lowWindows.filter(window => !window.destroyed).length, 1);
  await low.advance(3_000);
  assert.ok(lowWindows.every(window => (
    window.setPositionCalls.every(call => call.animate !== true)
  )));

  const escalating = createNudgeHarness();
  await escalating.api.startNudgeSequence(reminderOptions('later L3', 0, 2, 3));
  escalating.api.updateSensoryProfile({ stimulationMode: 'low' });
  await escalating.advance(150_000);
  assert.equal(escalating.windows.filter(window => !window.destroyed).length, 1,
    'a later L3 escalation must use the live low-stimulation profile');
});

test('a stale escalation timer cannot mutate a newer nudge generation', async () => {
  const harness = createNudgeHarness();
  const { api } = harness;

  await api.startNudgeSequence(reminderOptions('old', 0, 2, 2));
  const staleTimer = harness.activeTimers().find(timer => timer.delay === 60 * 1000);
  assert.ok(staleTimer);
  await api.startNudgeSequence(reminderOptions('new', 0, 2, 1));
  assert.equal(staleTimer.cleared, true);

  harness.forceTimer(staleTimer.id);
  assert.equal(harness.windows.length, 0);
  assert.equal(harness.notifications.at(-1).options.body, 'new');
});
