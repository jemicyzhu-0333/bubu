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
const { EventEmitter } = require('node:events');
const { createNudgeHost } = require('../src/platform/electron/nudge-host');

function harness(options = {}) {
  let time = 0;
  let nextId = 0;
  let canonical = routine();
  const timers = new Map();
  const notifications = [];
  const windows = [];
  const foreground = [];
  const errors = [];
  class Notification extends EventEmitter {
    static isSupported() { return options.supported !== false; }
    constructor(opts) { super(); this.options = opts; notifications.push(this); }
    show() {
      if (options.throwShow) throw new Error('synthetic show failure');
      if (options.autoShow !== false) this.emit('show');
    }
    close() { this.closed = true; this.emit('close'); }
  }
  class BrowserWindow extends EventEmitter {
    static getFocusedWindow() { return null; }
    constructor(opts) {
      super(); this.options = opts; this.visible = false; this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isDestroyed = () => false;
      this.sent = [];
      this.webContents.send = (...args) => {
        if (options.sendFails) throw new Error('synthetic send failure');
        this.sent.push(args);
        options.onSend?.(...args);
      };
      windows.push(this);
    }
    loadFile() { if (options.autoReady) queueMicrotask(() => this.webContents.emit('did-finish-load')); }
    isDestroyed() { return this.destroyed; }
    isVisible() { if (options.visibilityThrows) throw new Error('synthetic visibility failure'); return this.visible; }
    showInactive() { if (!options.invisible) this.visible = true; }
    show() { this.showInactive(); }
    focus() {}
    close() { this.destroyed = true; this.visible = false; }
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    getBounds() { return this.options; }
    setPosition() {}
  }
  const setTimer = (callback, delay) => {
    const id = ++nextId;
    timers.set(id, { callback, delay, at: time + delay });
    return id;
  };
  const api = createNudgeHost({
    BrowserWindow, Notification, nativeTheme: { shouldUseReducedMotion: true }, systemPreferences: {},
    screenHost: { primaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 900 } }) },
    shortcutHost: { claim: () => () => {} },
    preloadPath: '/synthetic/preload', cornerPagePath: '/synthetic/corner', fullscreenPagePath: '/synthetic/fullscreen',
    platform: options.platform || 'darwin',
    appPath: '/synthetic/app', resourcesPath: '/synthetic/resources', isPackaged: false, exists: () => true,
    execFile: (_file, _args, _options, callback) => {
      options.onProbe?.();
      if (options.holdForeground) foreground.push(callback);
      else callback(options.unknown ? new Error('unknown') : null, options.foreground ?? 'foreground-v1:Editor\n');
      return { kill() { options.onKill?.(); } };
    },
    exec: (_command, _options, callback) => {
      options.onProbe?.();
      if (options.holdForeground) foreground.push(callback);
      else callback(options.unknown ? new Error('unknown') : null, options.foreground ?? '"LSDisplayName"="Editor"');
      return { kill() { options.onKill?.(); } };
    },
    setTimer, clearTimer: id => timers.delete(id),
    resolveRoutineRequest: identity => canonical && identity.routineId === canonical.context.routineId
      && identity.occurrenceId === canonical.context.occurrenceId ? structuredClone(canonical) : null,
    onDeliveryError: error => errors.push(error),
    presentCompanion: options.presentCompanion || null
  });
  async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }
  async function advance(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
    }
    time = end; await flush();
  }
  return { api, timers, notifications, windows, foreground, errors, flush, advance,
    replace: next => { canonical = next; }, request: () => structuredClone(canonical) };
}
function routine(overrides = {}) {
  return { type: 'routine', message: 'initial title', maxLevel: 3, whitelist: ['zoom'], soundEnabled: true,
    context: { kind: 'routine', routineId: 'r', occurrenceId: 'r:2026-10-07:09:00' }, ...overrides };
}
function ordinary(overrides = {}) { return { type: 'rest', message: 'protected', priority: 100, maxLevel: 1, ...overrides }; }

test('native receipt requires show; timeout, failure and unsupported release the priority guard', async () => {
  for (const mode of ['timeout', 'failed', 'unsupported', 'throw']) {
    const h = harness({ autoShow: false, supported: mode !== 'unsupported', throwShow: mode === 'throw' });
    let settled = false;
    const pending = h.api.startNudgeSequence(ordinary()).then(value => { settled = true; return value; });
    await h.flush();
    if (mode === 'timeout') { assert.equal(settled, false); await h.advance(3000); }
    if (mode === 'failed') h.notifications[0].emit('failed', {}, 'synthetic failure');
    assert.equal((await pending).shown, false, mode);
    const next = h.api.startNudgeSequence({ type: 'rest', maxLevel: 1 });
    await h.flush();
    if (h.notifications.at(-1)) h.notifications.at(-1).emit('show');
    const result = await next;
    assert.notEqual(result.reason, 'higher-priority-active');
    h.api.dispose();
  }
});

test('actual show is level one; supersede/dispose settle and late events cannot resurrect', async () => {
  const h = harness({ autoShow: false });
  const old = h.api.startNudgeSequence(routine()); await h.flush();
  const first = h.notifications[0];
  const current = h.api.startNudgeSequence(routine()); await h.flush();
  assert.equal((await old).shown, false);
  first.emit('show');
  h.notifications[1].emit('show');
  assert.equal((await current).level, 1);
  const closing = h.api.startNudgeSequence(routine()); await h.flush();
  h.api.dispose();
  assert.equal((await closing).shown, false);
  h.notifications.at(-1).emit('show');
  assert.equal(h.timers.size, 0);
});

test('unknown foreground only permits native L1, even when L1 delivery fails', async () => {
  const h = harness({ unknown: true });
  const result = await h.api.startNudgeSequence(routine());
  assert.equal(result.level, 1);
  await h.advance(240000);
  assert.equal(h.windows.length, 0);
  const failed = harness({ unknown: true, supported: false });
  assert.equal((await failed.api.startNudgeSequence(routine())).shown, false);
  await failed.advance(240000);
  assert.equal(failed.windows.length, 0);
});

test('canonical changes at foreground and delivery boundaries reject stale routines', async () => {
  const probe = harness({ holdForeground: true });
  const pending = probe.api.startNudgeSequence(routine()); await probe.flush();
  probe.replace(null); probe.foreground[0](null, '"LSDisplayName"="Editor"');
  assert.equal((await pending).shown, false);
  assert.equal(probe.notifications.length, 0);
  const delivery = harness({ autoShow: false });
  const shown = delivery.api.startNudgeSequence(routine()); await delivery.flush();
  delivery.replace(routine({ message: 'edited while waiting' }));
  delivery.notifications[0].emit('show');
  assert.equal((await shown).shown, false);
});

test('routine DND is quiet L1, cancels escalation, preserves instance and deferral', async () => {
  const messages = [];
  const h = harness({ presentCompanion: text => { messages.push(text); return true; } });
  h.api.setDND(true);
  const shown = await h.api.startNudgeSequence(routine());
  assert.equal(shown.shown, true); assert.equal(shown.level, 1);
  assert.equal(h.notifications[0].options.silent, true); assert.equal(messages.length, 0);
  assert.equal(h.notifications[0].options.actions.length, 2);
  assert.equal(h.api.dismissCurrentNudge('defer-15').handled, true);
  h.replace(routine({ message: 'latest title' }));
  h.api.setDND(true);
  await h.advance(900000);
  assert.equal(h.notifications.at(-1).options.body, 'latest title');
  assert.equal(h.notifications.at(-1).options.silent, true);
  assert.equal(h.windows.length, 0);
  assert.equal((await h.api.startNudgeSequence(ordinary())).reason, 'dnd');
});

test('DND during foreground or pending receipt replaces delivery without losing the waiting generation', async () => {
  for (const holdForeground of [true, false]) {
    const h = harness({ holdForeground, autoShow: false });
    const pending = h.api.startNudgeSequence(routine()); await h.flush();
    h.api.setDND(true); await h.flush();
    h.notifications.at(-1).emit('show');
    assert.equal((await pending).shown, true);
    if (holdForeground) h.foreground[0](null, '"LSDisplayName"="Editor"');
    await h.advance(240000);
    assert.equal(h.windows.length, 0);
    assert.equal(h.notifications.at(-1).options.silent, true);
  }
});

test('deferred canonical cancellation and protected interruption retain exactly one owner', async () => {
  const h = harness();
  await h.api.startNudgeSequence(routine()); h.api.dismissCurrentNudge('defer-15');
  await h.api.startNudgeSequence(ordinary());
  await h.advance(900000);
  assert.equal(h.notifications.length, 2);
  h.api.dismissCurrentNudge('dismiss');
  h.replace(routine({ message: 'latest after protected' }));
  await h.advance(30000);
  assert.equal(h.notifications.at(-1).options.body, 'latest after protected');
  h.api.dismissCurrentNudge('defer-15');
  h.replace(null); h.api.reconcileRoutineReminders();
  await h.advance(900000);
  assert.equal(h.notifications.length, 3);
});

test('window receipt waits for ready, successful init send and visible; stale ready does not show', async () => {
  for (const failure of ['not-ready', 'send', 'invisible', 'none']) {
    const h = harness({ sendFails: failure === 'send', invisible: failure === 'invisible' });
    let settled = false;
    const pending = h.api.showLevel({ type: 'rest', level: 2 }).then(value => { settled = true; return value; });
    await h.flush(); assert.equal(settled, false);
    if (failure !== 'not-ready') h.windows[0].webContents.emit('did-finish-load');
    await h.advance(3000);
    assert.equal((await pending).shown, failure === 'none', failure);
    h.api.dispose();
  }
  const stale = harness();
  await stale.api.startNudgeSequence(routine()); await stale.advance(60000);
  stale.replace(null);
  stale.windows[0].webContents.emit('did-finish-load');
  assert.equal(stale.windows[0].visible, false);
});

test('routine action rechecks canonical identity and keeps rejected actions retryable', async () => {
  const h = harness(); let accepted = false; const actions = [];
  h.api.setActionHandler(action => { actions.push(action); return { ok: accepted }; });
  await h.api.startNudgeSequence(routine());
  assert.equal(h.api.dismissCurrentNudge('complete-routine').handled, false);
  accepted = true;
  assert.equal(h.api.dismissCurrentNudge('complete-routine').handled, true);
  assert.equal(actions[0].instanceId, actions[1].instanceId);
  await h.api.startNudgeSequence(routine()); h.replace(null);
  assert.equal(h.api.dismissCurrentNudge('complete-routine').handled, false);
  assert.equal(actions.length, 2);
});

test('DND replacement during a deferred foreground await releases replay ownership for later actions', async () => {
  const h = harness({ holdForeground: true });
  const first = h.api.startNudgeSequence(routine());
  h.foreground[0](null, '"LSDisplayName"="Editor"'); await first;
  assert.equal(h.api.dismissCurrentNudge('defer-15').handled, true);
  await h.advance(900000);
  assert.equal(h.foreground.length, 2);
  h.api.setDND(true); await h.flush();
  assert.equal(h.notifications.at(-1).options.silent, true);
  assert.equal(h.api.dismissCurrentNudge('defer-15').handled, true);
  await h.advance(900000);
  assert.equal(h.notifications.length, 3);
});

test('clearing a replay during foreground lookup prevents late callback and retry resurrection', async () => {
  const h = harness({ holdForeground: true });
  const first = h.api.startNudgeSequence(routine());
  h.foreground[0](null, '"LSDisplayName"="Editor"'); await first;
  h.api.dismissCurrentNudge('defer-15'); await h.advance(900000);
  const late = h.foreground[1];
  await h.api.clearNudge({ deferredPolicy: 'all' });
  late(null, '"LSDisplayName"="Editor"'); await h.flush(); await h.advance(900000);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.timers.size, 0);
});

test('DND keeps the active routine instance while taking down windows and pending escalation', async () => {
  const h = harness({ autoReady: true }); const actions = [];
  h.api.setActionHandler(action => { actions.push(action); return { ok: false, reason: 'retry' }; });
  await h.api.startNudgeSequence(routine());
  h.api.dismissCurrentNudge('complete-routine');
  await h.advance(60000); assert.equal(h.windows[0].visible, true);
  h.api.setDND(true); await h.flush();
  h.api.dismissCurrentNudge('complete-routine');
  assert.equal(actions[0].instanceId, actions[1].instanceId);
  assert.equal(h.windows[0].destroyed, true);
  await h.advance(240000); assert.equal(h.windows.length, 1);
});

test('canonical authority is required for ordinary routine requests and payload cannot claim preview', async () => {
  const h = harness();
  for (const context of [{}, { routineId: 'r' }, { occurrenceId: 'r:2026-10-07:09:00' }]) {
    assert.equal((await h.api.startNudgeSequence(routine({ context, preview: true }))).shown, false);
  }
  const result = await h.api.startNudgeSequence(routine({ message: 'forged title', maxLevel: 1 }));
  assert.equal(result.shown, true);
  assert.equal(h.notifications[0].options.body, 'initial title');
});

test('canonical loss before escalation and late ready never shows an obsolete corner', async () => {
  const h = harness();
  await h.api.startNudgeSequence(routine()); h.replace(null);
  await h.advance(60000); assert.equal(h.windows.length, 0);
  const ready = harness();
  await ready.api.startNudgeSequence(routine()); await ready.advance(60000);
  ready.replace(routine({ message: 'new title' }));
  ready.windows[0].webContents.emit('did-finish-load');
  assert.equal(ready.windows[0].visible, false);
  assert.equal(ready.windows[0].destroyed, true);
});

test('foreground lookup is bounded and reset cancels it; late answer cannot add escalation', async () => {
  const h = harness({ holdForeground: true });
  const pending = h.api.startNudgeSequence(routine());
  await h.advance(3000);
  const result = await pending;
  assert.equal(result.reason, 'foreground-unknown');
  h.foreground[0](null, '"LSDisplayName"="Editor"'); await h.advance(240000);
  assert.equal(h.windows.length, 0);
  const canceled = h.api.startNudgeSequence(routine()); await h.flush();
  h.api.dispose();
  assert.equal((await canceled).shown, false);
  assert.equal(h.timers.size, 0);
});

test('DND changing inside window initialization cannot reveal the superseded high-level surface', async () => {
  let h;
  h = harness({ onSend: channel => { if (channel === 'nudge:init') h.api.setDND(true); } });
  await h.api.startNudgeSequence(routine()); await h.advance(60000);
  h.windows[0].webContents.emit('did-finish-load');
  await h.flush();
  assert.equal(h.windows[0].visible, false);
  assert.equal(h.notifications.at(-1).options.silent, true);
});

test('visibility probe exceptions fail the window receipt without throwing into the ready event', async () => {
  const h = harness({ visibilityThrows: true });
  const pending = h.api.showLevel({ type: 'rest', level: 2 });
  assert.doesNotThrow(() => h.windows[0].webContents.emit('did-finish-load'));
  assert.equal((await pending).shown, false);
  assert.equal(h.timers.size, 0);
});

test('unsupported foreground platforms never invoke the macOS process port and stay at L1', async () => {
  const h = harness({ platform: 'linux', holdForeground: true });
  const result = await h.api.startNudgeSequence(routine());
  assert.equal(result.reason, 'foreground-unknown');
  assert.equal(h.foreground.length, 0);
  await h.advance(240000);
  assert.equal(h.windows.length, 0);
});


test('nonempty malformed foreground output remains unknown and cannot authorize escalation', async () => {
  for (const foreground of ['lsappinfo: unable to determine front application', 'Editor', 'LSDisplayName=Editor']) {
    const h = harness({ foreground });
    const result = await h.api.startNudgeSequence(routine());
    assert.equal(result.reason, 'foreground-unknown', foreground);
    assert.equal(result.level, 1);
    await h.advance(240000);
    assert.equal(h.windows.length, 0, foreground);
  }
});

test('replacing a pending corner receipt releases its timeout without closing the native action retry', async () => {
  const h = harness();
  const request = routine({ maxLevel: 2 });
  h.replace(request);
  let accepted = false;
  h.api.setActionHandler(() => ({ ok: accepted, reason: 'retry' }));
  await h.api.startNudgeSequence(request);
  await h.advance(60000);
  const cornerTimeout = [...h.timers.values()].find(timer => timer.delay === 3000);
  assert.ok(cornerTimeout);
  const original = h.notifications[0];
  original.emit('action', {}, 0);
  original.close();
  const retry = h.notifications[1];
  assert.ok(retry);
  assert.equal(h.windows[0].destroyed, true);
  await h.advance(3000);
  cornerTimeout.callback();
  assert.notEqual(retry.closed, true);
  assert.equal(h.timers.size, 0);
  accepted = true;
  assert.equal(h.api.dismissCurrentNudge('complete-routine').handled, true);
});

for (const platform of ['win32', 'darwin']) {
  const safe = platform === 'win32' ? 'foreground-v1:Editor\n' : '"LSDisplayName"="Editor"';
  const meeting = platform === 'win32' ? 'foreground-v1:POWERPNT\n' : '"LSDisplayName"="PowerPoint"';

  test(`${platform}: known safe foreground can reach L2/L3/L4; each timer and ready boundary resamples`, async () => {
    let probes = 0;
    const h = harness({ platform, foreground: safe, autoReady: true, onProbe: () => { probes += 1; } });
    await h.api.startNudgeSequence(ordinary({ maxLevel: 4, whitelist: ['powerpoint'] }));
    assert.equal(probes, 1);
    await h.advance(60000);
    assert.equal(h.windows.filter(window => window.visible).length, 1); assert.equal(probes, 3);
    await h.advance(90000);
    assert.equal(h.windows.filter(window => window.visible).length, 4); assert.equal(probes, 5);
    await h.advance(60000);
    assert.equal(h.windows.filter(window => window.visible).length, 1); assert.equal(probes, 7);
    assert.equal(h.windows.at(-1).sent[0][0], 'nudge:init');
    h.api.dispose(); assert.equal(h.timers.size, 0);
  });

  test(`${platform}: safe to meeting/unknown before each covering level latches L1, without surprise replay`, async () => {
    for (const [at, expectedPrevious] of [[60000, 0], [150000, 1], [210000, 5]]) {
      for (const foreground of [meeting, 'malformed']) {
        const options = { platform, foreground: safe, autoReady: true };
        const h = harness(options);
        await h.api.startNudgeSequence(ordinary({ maxLevel: 4, whitelist: ['powerpoint'] }));
        await h.advance(at - 1);
        assert.equal(h.windows.length, expectedPrevious);
        options.foreground = foreground;
        await h.advance(1);
        assert.equal(h.windows.length, expectedPrevious);
        assert.equal(h.windows.filter(window => window.visible).length, 0);
        options.foreground = safe;
        await h.advance(300000);
        assert.equal(h.windows.length, expectedPrevious);
        h.api.dispose(); assert.equal(h.timers.size, 0);
      }
    }
  });

  test(`${platform}: initial meeting to safe stays L1; failed native notification never becomes a window`, async () => {
    for (const supported of [true, false]) {
      const options = { platform, foreground: meeting, supported };
      const h = harness(options);
      const result = await h.api.startNudgeSequence(ordinary({ maxLevel: 4, whitelist: ['powerpoint'] }));
      assert.equal(result.shown, supported);
      if (supported) assert.equal(result.reason, 'foreground-whitelist');
      options.foreground = safe;
      await h.advance(300000); assert.equal(h.windows.length, 0); h.api.dispose();
    }
  });

  test(`${platform}: delayed ready rechecks foreground and unsafe downgrade closes old corners/fullscreen`, async () => {
    for (const at of [60000, 150000, 210000]) {
      const options = { platform, foreground: safe, autoReady: true };
      const h = harness(options);
      await h.api.startNudgeSequence(ordinary({ maxLevel: 4, whitelist: ['powerpoint'] }));
      await h.advance(at - 1); options.autoReady = false; await h.advance(1);
      const pending = h.windows.filter(window => !window.destroyed);
      assert.ok(pending.length > 0); assert.ok(pending.every(window => !window.visible));
      options.foreground = meeting;
      for (const window of pending) window.webContents.emit('did-finish-load');
      await h.flush();
      assert.ok(h.windows.every(window => !window.visible));
      assert.ok(pending.every(window => window.destroyed));
      options.foreground = safe;
      await h.advance(300000);
      assert.ok(h.windows.every(window => !window.visible)); h.api.dispose();
    }
  });

  test(`${platform}: a later corner ready obtains a new answer rather than reusing its siblings' completed check`, async () => {
    const options = { platform, foreground: safe, autoReady: true };
    const h = harness(options);
    await h.api.startNudgeSequence(ordinary({ maxLevel: 3, whitelist: ['powerpoint'] }));
    await h.advance(149999); options.autoReady = false; await h.advance(1);
    const corners = h.windows.filter(window => !window.destroyed);
    corners[0].webContents.emit('did-finish-load'); await h.flush(); assert.equal(corners[0].visible, true);
    options.foreground = meeting;
    corners[1].webContents.emit('did-finish-load'); await h.flush();
    assert.ok(corners.every(window => !window.visible)); h.api.dispose();
  });
}

test('Windows escalation aborts on DND, identity changes, supersession, clear and dispose; late answers cannot reveal', async () => {
  for (const boundary of ['timer', 'ready']) {
    for (const change of ['dnd', 'identity', 'settings', 'supersede', 'clear', 'dispose', 'action-retry']) {
      let killed = 0;
      const options = { platform: 'win32', autoReady: boundary !== 'ready', onKill: () => { killed += 1; } };
      const h = harness(options);
      await h.api.startNudgeSequence(routine());
      await h.advance(59999);
      if (boundary === 'timer') options.holdForeground = true;
      await h.advance(1);
      if (boundary === 'ready') {
        options.holdForeground = true;
        h.windows[0].webContents.emit('did-finish-load');
      }
      const late = h.foreground.at(-1); assert.equal(typeof late, 'function');
      if (change === 'dnd') { h.api.setDND(true); h.api.setDND(false); }
      if (change === 'identity') { h.replace(null); h.api.reconcileRoutineReminders(); }
      if (change === 'settings') { h.replace(routine({ message: 'changed' })); h.api.reconcileRoutineReminders(); }
      if (change === 'supersede') {
        options.holdForeground = false;
        await h.api.startNudgeSequence(ordinary());
      }
      if (change === 'clear') await h.api.clearNudge({ deferredPolicy: 'all' });
      if (change === 'dispose') h.api.dispose();
      if (change === 'action-retry') {
        h.api.setActionHandler(() => ({ ok: false }));
        const original = h.notifications[0]; original.emit('action', {}, 0); original.close();
      }
      late(null, 'foreground-v1:Editor\n'); late(null, 'foreground-v1:Editor\n');
      await h.flush(); await h.advance(300000);
      assert.ok(h.windows.every(window => !window.visible), `${boundary}/${change}`);
      assert.equal(killed, 1, `${boundary}/${change}`);
      h.api.dispose(); assert.equal(h.timers.size, 0);
    }
  }
});

test('Windows timeout and malformed/unknown at ready never cover work, including failed downgrade L1', async () => {
  for (const failure of ['timeout', 'error', 'malformed']) {
    const options = { platform: 'win32', autoReady: false };
    const h = harness(options);
    await h.api.startNudgeSequence(routine()); await h.advance(60000);
    options.supported = false;
    if (failure === 'timeout') options.holdForeground = true;
    if (failure === 'error') options.unknown = true;
    if (failure === 'malformed') options.foreground = 'foreground-v1:Editor\nforeground-v1:Zoom';
    h.windows[0].webContents.emit('did-finish-load');
    await h.advance(3000);
    for (const callback of h.foreground) callback(null, 'foreground-v1:Editor');
    await h.advance(300000); assert.ok(h.windows.every(window => !window.visible)); assert.equal(h.timers.size, 0);
  }
});

test('Windows explicit deferral rechecks current foreground; canceling its owner during replay blocks late callbacks', async () => {
  const options = { platform: 'win32', foreground: 'foreground-v1:Zoom' };
  const h = harness(options);
  await h.api.startNudgeSequence(routine()); h.api.dismissCurrentNudge('defer-15');
  options.foreground = 'foreground-v1:Editor'; options.autoReady = true;
  await h.advance(900000); await h.advance(60000); assert.ok(h.windows.some(window => window.visible));
  h.api.dismissCurrentNudge('defer-15'); options.holdForeground = true;
  await h.advance(900000); const late = h.foreground.at(-1);
  await h.api.clearNudge({ deferredPolicy: 'all' });
  late(null, 'foreground-v1:Editor'); await h.advance(900000);
  assert.ok(h.windows.every(window => !window.visible)); assert.equal(h.timers.size, 0);
});

test('sensitive foreground queries are canceled on disposal and never start after disposal', async () => {
  let killed = 0;
  const h = harness({ platform: 'win32', holdForeground: true, onKill: () => { killed += 1; } });
  const pending = h.api.isSensitiveForeground(['zoom']); h.api.dispose();
  assert.equal(await pending, true); assert.equal(killed, 1);
  h.foreground[0](null, 'foreground-v1:Editor');
  assert.equal(await h.api.isSensitiveForeground([]), true); assert.equal(h.foreground.length, 1); assert.equal(h.timers.size, 0);
});

test('the outer escalation continuation revalidates after a successful approval and queued microtask invalidation', async () => {
  for (const change of ['clear', 'dispose', 'dnd', 'dnd-cycle', 'supersede', 'identity', 'settings']) {
    const options = { platform: 'win32' };
    const h = harness(options);
    await h.api.startNudgeSequence(routine());
    options.holdForeground = true;
    await h.advance(60000);
    h.foreground.at(-1)(null, 'foreground-v1:Editor');
    // The probe continuation approves first; cancellation is already queued
    // before the outer escalation timer resumes from its own await.
    queueMicrotask(() => {
      if (change === 'clear') void h.api.clearNudge({ deferredPolicy: 'all' });
      if (change === 'dispose') h.api.dispose();
      if (change === 'dnd' || change === 'dnd-cycle') h.api.setDND(true);
      if (change === 'dnd-cycle') h.api.setDND(false);
      if (change === 'identity') h.replace(null);
      if (change === 'settings') h.replace(routine({ message: 'changed after approval' }));
      if (change === 'supersede') {
        options.holdForeground = false;
        void h.api.startNudgeSequence(ordinary());
      }
    });
    await h.flush(); await h.advance(3000);
    assert.equal(h.windows.length, 0, change);
    if (change === 'dnd' || change === 'supersede') assert.notEqual(h.notifications.at(-1).closed, true, change);
    h.api.dispose(); assert.equal(h.timers.size, 0, change);
  }
});

test('a completed safe companion L1 is not duplicated when a later foreground check latches escalation off', async () => {
  let companion = 0;
  const options = { platform: 'win32', presentCompanion: () => { companion += 1; return true; } };
  const h = harness(options);
  const result = await h.api.startNudgeSequence(routine());
  assert.equal(result.delivery, 'companion'); assert.equal(companion, 1); assert.equal(h.notifications.length, 0);
  options.foreground = 'foreground-v1:Zoom'; await h.advance(60000);
  options.foreground = 'foreground-v1:Editor'; await h.advance(300000);
  assert.equal(companion, 1); assert.equal(h.notifications.length, 0); assert.equal(h.windows.length, 0);
  h.api.dispose(); assert.equal(h.timers.size, 0);
});

test('native reminder chrome uses the acknowledged locale but preserves a user-authored routine title', async t => {
  const { setNativeLocale } = require('../src/platform/electron/interface-copy');
  setNativeLocale('en'); t.after(() => setNativeLocale('zh-CN'));
  const h = harness(); t.after(() => h.api.dispose());
  h.replace(routine({ message: '关闭 {count} 是我的日常标题', maxLevel: 1 }));
  await h.api.startNudgeSequence(h.request());
  const shown = h.notifications[0].options;
  assert.match(shown.title, /Routine reminder/);
  assert.equal(shown.body, '关闭 {count} 是我的日常标题');
  assert.equal(shown.closeButtonText, 'Close');
  assert.deepEqual(shown.actions.map(action => action.text), ['Completed', 'Later (+15 min)']);
});
