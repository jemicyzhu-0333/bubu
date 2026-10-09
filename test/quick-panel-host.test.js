'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShortcutHost } = require('../src/platform/electron/shortcuts');
const { createScreenHost } = require('../src/platform/electron/screen-host');
const { resolveFocusDisplay, focusLanding } = require('../src/platform/electron/focus-display');
const { createQuickPanelHost, acceleratorLabel, BUILT_IN_CANDIDATES } = require('../src/platform/electron/quick-panel-host');
const { borrowPetForQuickPanel } = require('../src/platform/electron/quick-panel-pet-cue');

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 860 } };
const SECONDARY = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 800 }, workArea: { x: 1920, y: 0, width: 1280, height: 760 } };

// A fake globalShortcut backing store, so the real shortcut adapter's claim()
// semantics (refuse a held chord, release on unregister) are exercised, and a
// chord "held by another app" is modelled by pre-registering it.
function makeShortcutEnv({ held = [] } = {}) {
  const registered = new Map(held.map(accelerator => [accelerator, () => {}]));
  let unregisterAllCount = 0;
  const globalShortcut = {
    register(accelerator, handler) {
      if (registered.has(accelerator)) return false;
      registered.set(accelerator, handler);
      return true;
    },
    isRegistered: accelerator => registered.has(accelerator),
    unregister: accelerator => registered.delete(accelerator),
    unregisterAll: () => { unregisterAllCount += 1; registered.clear(); }
  };
  return {
    registered,
    shortcutHost: createShortcutHost({ globalShortcut }),
    unregisterAllCount: () => unregisterAllCount,
    trigger(accelerator) { const handler = registered.get(accelerator); if (handler) handler(); return Boolean(handler); }
  };
}

function makeScreenHost({ cursor = { x: 100, y: 100 }, throwCursor = false } = {}) {
  return createScreenHost({
    screen: {
      getPrimaryDisplay: () => PRIMARY,
      getCursorScreenPoint: () => { if (throwCursor) throw new Error('no cursor'); return { ...cursor }; },
      getDisplayNearestPoint: point => (point.x >= 1600 ? SECONDARY : PRIMARY)
    }
  });
}

function makeHost(overrides = {}) {
  const env = makeShortcutEnv(overrides.shortcut || {});
  const logs = [];
  const shown = [];
  const host = createQuickPanelHost({
    shortcutHost: env.shortcutHost,
    screenHost: overrides.screenHost || makeScreenHost(),
    BrowserWindow: overrides.BrowserWindow || { getFocusedWindow: () => null },
    ownsSender: overrides.ownsSender,
    isPanelVisible: overrides.isPanelVisible || (() => false),
    showPanel: display => shown.push(display),
    hidePanel: () => shown.push('hidden'),
    cuePet: overrides.cuePet || (() => {}),
    logger: record => logs.push(record),
    candidates: overrides.candidates
  });
  return { host, env, logs, shown };
}

// ── B2: the binding ladder ────────────────────────────────────────────────────

test('claim binds the configured accelerator when it is free', () => {
  const { host } = makeHost();
  const result = host.claim('Alt+Shift+Space');
  assert.equal(result.ok, true);
  assert.equal(result.accelerator, 'Alt+Shift+Space');
  assert.equal(result.usedFallback, false);
  const described = host.describeShortcut();
  assert.equal(described.accelerator, 'Alt+Shift+Space');
  assert.equal(described.registered, true);
  assert.equal(described.usedFallback, false);
});

test('a taken accelerator falls to a built-in candidate automatically, with no user prompt', () => {
  // The user's configured chord is held by another app.
  const { host, logs } = makeHost({ shortcut: { held: ['Alt+Shift+Space'] } });
  const result = host.claim('Alt+Shift+Space');
  assert.equal(result.ok, true);
  assert.equal(result.usedFallback, true);
  assert.notEqual(result.accelerator, 'Alt+Shift+Space');
  assert.equal(BUILT_IN_CANDIDATES.includes(result.accelerator), true);
  // describeShortcut reports the combo that WORKS, keeping the configured one on file.
  const described = host.describeShortcut();
  assert.equal(described.accelerator, result.accelerator);
  assert.equal(described.configured, 'Alt+Shift+Space');
  assert.equal(described.usedFallback, true);
  assert.equal(logs.some(record => record.event === 'fallback-bound'), true);
});

test('when every rung is taken the panel degrades to menu-bar only, logged once, never an error', () => {
  const { host, logs } = makeHost({ shortcut: { held: [...BUILT_IN_CANDIDATES] } });
  let result;
  assert.doesNotThrow(() => { result = host.claim('Alt+Shift+Space'); });
  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
  assert.equal(host.describeShortcut().registered, false);
  const notices = logs.filter(record => record.event === 'no-accelerator');
  assert.equal(notices.length, 1); // said once, not on a loop
});

test('rebind switches to a new free accelerator and updates the reported binding', () => {
  const { host } = makeHost({ candidates: [] }); // single-rung ladders
  assert.equal(host.claim('F19').accelerator, 'F19');
  const result = host.rebind('Command+Alt+K');
  assert.equal(result.ok, true);
  assert.equal(result.accelerator, 'Command+Alt+K');
  assert.equal(host.describeShortcut().accelerator, 'Command+Alt+K');
});

test('rebind keeps a working hotkey when the target is unavailable', () => {
  const env = makeShortcutEnv({ held: ['Control+Shift+Space'] });
  const logs = [];
  const host = createQuickPanelHost({
    shortcutHost: env.shortcutHost,
    screenHost: makeScreenHost(),
    BrowserWindow: { getFocusedWindow: () => null },
    showPanel: () => {},
    hidePanel: () => {},
    logger: record => logs.push(record),
    candidates: [] // single-rung ladders, so a taken target has no fallback
  });
  assert.equal(host.claim('F19').accelerator, 'F19');
  const result = host.rebind('Control+Shift+Space'); // held by "another app"
  assert.equal(result.ok, true);
  assert.equal(result.accelerator, 'F19'); // rolled back
  assert.equal(result.rolledBack, true);
  assert.equal(host.describeShortcut().accelerator, 'F19');
});

test('dispose releases only our own chord and never calls unregisterAll', () => {
  const { host, env } = makeHost();
  host.claim('Alt+Shift+Space');
  assert.equal(env.registered.has('Alt+Shift+Space'), true);
  host.dispose();
  assert.equal(env.registered.has('Alt+Shift+Space'), false); // released
  assert.equal(env.unregisterAllCount(), 0); // other hosts' chords untouched
});

test('setEnabled(false) releases the chord; re-enabling re-runs the ladder', () => {
  const { host, env } = makeHost();
  host.claim('Alt+Shift+Space');
  host.setEnabled(false);
  assert.equal(env.registered.has('Alt+Shift+Space'), false);
  assert.equal(host.describeShortcut().registered, false);
  const result = host.setEnabled(true);
  assert.equal(result.ok, true);
  assert.equal(host.describeShortcut().registered, true);
});

test('the hotkey handler toggles the panel and releases its temporary pet cue on close', () => {
  const shown = [];
  const env = makeShortcutEnv();
  let visible = false;
  let cueReleased = 0;
  const host = createQuickPanelHost({
    shortcutHost: env.shortcutHost,
    screenHost: makeScreenHost(),
    BrowserWindow: { getFocusedWindow: () => null },
    isPanelVisible: () => visible,
    showPanel: display => { shown.push(display); visible = true; },
    hidePanel: () => { shown.push('hidden'); visible = false; },
    cuePet: () => () => { cueReleased += 1; }
  });
  host.claim('Alt+Shift+Space');
  env.trigger('Alt+Shift+Space'); // press once → open
  env.trigger('Alt+Shift+Space'); // press again → close (toggle)
  assert.equal(shown.length, 2);
  assert.equal(shown[1], 'hidden');
  assert.equal(cueReleased, 1);
});

test('portal visit departs before moving, returns after close and respects a user drag', () => {
  const calls = [];
  let bounds = { x: 100, y: 100, width: 220, height: 220 };
  const petWindow = {
    isAlive: () => true,
    isVisible: () => true,
    getBounds: () => ({ ...bounds }),
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; calls.push(['position', x, y]); },
    send: (channel, payload) => calls.push(['send', channel, payload])
  };
  const timers = new Map(); let timerId = 0;
  const schedule = fn => { timers.set(++timerId, fn); return timerId; };
  const cancel = id => timers.delete(id);
  const tick = () => { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); };
  const panelBounds = { x: 2300, y: 180, width: 500, height: 360 };
  const restore = borrowPetForQuickPanel({
    petWindow,
    screenHost: makeScreenHost(),
    display: SECONDARY,
    panelBounds, schedule, cancel,
    now: () => 123
  });
  assert.equal(typeof restore, 'function');
  assert.equal(calls[0][2].cue.id, 'system.notebook-depart');
  assert.equal(bounds.x, 100);
  tick(); tick();
  assert.equal(bounds.x, 2770);
  assert.equal(calls.at(-1)[2].cue.id, 'system.notebook-ready');
  restore.feedback('saved');
  assert.equal(calls.at(-1)[2].cue.id, 'system.notebook-saved');
  restore();
  tick(); tick();
  assert.deepEqual(bounds, { x: 100, y: 100, width: 220, height: 220 });

  const restoreAfterDrag = borrowPetForQuickPanel({
    petWindow,
    screenHost: makeScreenHost(),
    display: SECONDARY,
    panelBounds, schedule, cancel,
    now: () => 456
  });
  tick(); tick();
  bounds = { ...bounds, x: 2500 };
  restoreAfterDrag();
  tick();
  assert.equal(bounds.x, 2500, 'a newer user drag must win over the borrowed position');
});

test('acceleratorLabel renders macOS glyphs', () => {
  assert.equal(acceleratorLabel('Alt+Shift+Space'), '⌥⇧Space');
  assert.equal(acceleratorLabel('CommandOrControl+Alt+.'), '⌘⌥.');
});

test('rapid reopen restores the original home and system reduced motion never moves the pet', () => {
  let bounds = { x: 100, y: 100, width: 220, height: 220 };
  const home = { ...bounds }; let motion = false;
  const petWindow = { isAlive: () => true, isVisible: () => true, getBounds: () => ({ ...bounds }),
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; }, send() {} };
  const timers = new Map(); let sequence = 0;
  const options = { petWindow, display: SECONDARY, panelBounds: { x: 2300, y: 100, width: 500, height: 300 },
    readRuntime: () => ({ prefersReducedMotion: motion }), schedule: fn => { timers.set(++sequence, fn); return sequence; }, cancel: id => timers.delete(id) };
  const tick = () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); };
  const first = borrowPetForQuickPanel(options); tick(); tick(); first();
  const reopened = borrowPetForQuickPanel(options); reopened(); tick(); tick();
  assert.deepEqual(bounds, home);
  motion = true;
  const quiet = borrowPetForQuickPanel(options); tick(); quiet(); tick();
  assert.deepEqual(bounds, home); assert.equal(timers.size, 0);
});

// ── B3: permission-free focus display + landing ───────────────────────────────

test('resolveFocusDisplay uses an external focused window centre', () => {
  const external = { isDestroyed: () => false, webContents: {}, getBounds: () => ({ x: 2000, y: 100, width: 400, height: 300 }) };
  const display = resolveFocusDisplay({
    screenHost: makeScreenHost(),
    ownsSender: () => false, // external window is not ours
    BrowserWindow: { getFocusedWindow: () => external }
  });
  assert.equal(display.id, SECONDARY.id); // centre x ~2200 → secondary
});

test('resolveFocusDisplay skips our own focused window and falls to the cursor', () => {
  const ours = { isDestroyed: () => false, webContents: { id: 9 }, getBounds: () => ({ x: 2000, y: 100, width: 400, height: 300 }) };
  const display = resolveFocusDisplay({
    screenHost: makeScreenHost({ cursor: { x: 50, y: 50 } }),
    ownsSender: sender => sender && sender.id === 9, // this window is ours
    BrowserWindow: { getFocusedWindow: () => ours }
  });
  assert.equal(display.id, PRIMARY.id); // fell through to the cursor's screen
});

test('resolveFocusDisplay falls to the cursor when nothing is focused', () => {
  const display = resolveFocusDisplay({
    screenHost: makeScreenHost({ cursor: { x: 2000, y: 10 } }),
    ownsSender: () => false,
    BrowserWindow: { getFocusedWindow: () => null }
  });
  assert.equal(display.id, SECONDARY.id);
});

test('resolveFocusDisplay falls to the primary display when the cursor query fails', () => {
  const display = resolveFocusDisplay({
    screenHost: makeScreenHost({ throwCursor: true }),
    ownsSender: () => false,
    BrowserWindow: { getFocusedWindow: () => null }
  });
  assert.equal(display.id, PRIMARY.id);
});

test('focusLanding centres horizontally and sits a quarter down the work area', () => {
  const landing = focusLanding(PRIMARY.workArea, { width: 440, height: 300 });
  assert.equal(landing.x, Math.round((1440 - 440) / 2));
  assert.equal(landing.y, Math.round(860 * 0.25));
});

test('the host resolves its panel display and landing through focus-display', () => {
  const { host } = makeHost({ screenHost: makeScreenHost({ cursor: { x: 2000, y: 10 } }) });
  const display = host.panelDisplay();
  assert.equal(display.id, SECONDARY.id);
  const landing = host.landingFor(display, { width: 440, height: 300 });
  assert.equal(landing.x, Math.round(SECONDARY.workArea.x + (SECONDARY.workArea.width - 440) / 2));
});
