'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateAdmission, createDesktopUpdates } = require('../src/capabilities/app-maintenance').desktopUpdates;
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');
const { createIpcRegistrar } = require('../src/application/ipc/registrar');
const { createLifecycleRegistry } = require('../src/bootstrap/lifecycle');
const { holdUpdateWindows } = require('../src/platform/electron/update-window-hold');
const { createMacUpdateHandoff } = require('../src/platform/electron/mac-update-handoff');
function windowFixture({ enabled = true, focused = false, visible = true } = {}) {
  let focusCalls = 0, input = 'unsaved fixture draft';
  return { isDestroyed: () => false, isEnabled: () => enabled, setEnabled: value => { enabled = value; },
    isFocused: () => focused, isVisible: () => visible, focus: () => { focusCalls++; },
    focusCalls: () => focusCalls, input: () => input, type: text => { if (enabled) input = text; } };
}
test('installation lease refuses new IPC/UoW/provider work without mutating facts, and reopening is process-local', async () => {
  const admission = createUpdateAdmission(); let state = { count: 1 }, revision = 1, transitioned = 0;
  const repository = admission.protectRepository({ snapshot: () => structuredClone(state), revision: () => revision,
    commit: value => { state = value; revision++; return value; }, update: fn => fn(state) });
  const uow = createUnitOfWork({ repository });
  const requests = createProviderRequestScope({ canBegin: () => !admission.isBlocked() });
  const handlers = new Map();
  const register = createIpcRegistrar({ ipcHost: { handle: (name, fn) => handlers.set(name, fn) }, senderPage: () => 'popover',
    allowedPagesFor: () => ['popover'], validatePayload: (_name, value) => value,
    canInvoke: name => !admission.isBlocked() || name === 'updates:get' });
  register('task:start', () => { transitioned++; }); register('updates:get', () => ({ phase: 'installing' }));
  const lease = admission.acquire();
  assert.equal(uow.run({ writes: ['count'], transition: draft => { transitioned++; draft.count++; } }).reason, 'application-updating');
  assert.throws(() => repository.commit({ count: 9 }), /updating/);
  assert.throws(() => requests.begin(), /aborted/);
  assert.equal((await handlers.get('task:start')({}, {})).reason, 'application-updating');
  assert.equal((await handlers.get('updates:get')({}, {})).phase, 'installing');
  assert.equal(transitioned, 0); assert.equal(state.count, 1);
  lease.release(); lease.release(); const request = requests.begin(); request.release();
  assert.equal(uow.run({ writes: ['count'], transition: draft => { draft.count++; } }).ok, true);
  assert.equal(createUpdateAdmission().isBlocked(), false);
});
test('scheduled work waits during native handoff and each deferred timeout resumes at most once', () => {
  const intervals = [], timeouts = []; let runs = 0;
  const lifecycle = createLifecycleRegistry({ setInterval: fn => (intervals.push(fn), fn), clearInterval() {},
    setTimeout: fn => (timeouts.push(fn), fn), clearTimeout() {} });
  lifecycle.interval('poll', () => runs++, 5); lifecycle.timeout('planned', () => runs += 10, 5);
  const hold = lifecycle.holdTimers(); intervals[0](); timeouts[0](); assert.equal(runs, 0);
  hold.release(); hold.release(); assert.equal(runs, 10); intervals[0](); assert.equal(runs, 11);
  lifecycle.dispose();
});
test('public window hold preserves visible drafts, blocks more input and restores only original enabled/focus state', () => {
  const app = new EventEmitter(), focused = windowFixture({ focused: true }), hidden = windowFixture({ visible: false, enabled: false });
  const hold = holdUpdateWindows({ app, BrowserWindow: { getAllWindows: () => [focused, hidden] } });
  focused.type('must not replace draft'); assert.equal(focused.input(), 'unsaved fixture draft'); assert.equal(focused.isVisible(), true);
  const added = windowFixture(); app.emit('browser-window-created', {}, added); assert.equal(added.isEnabled(), false);
  hold.release(); hold.release(); assert.equal(focused.isEnabled(), true); assert.equal(hidden.isEnabled(), false);
  assert.equal(focused.focusCalls(), 1); assert.equal(hidden.focusCalls(), 0); assert.equal(added.focusCalls(), 0);
  assert.equal(app.listenerCount('browser-window-created'), 0);
});
async function runtimeFixture({ nativeFailure = false } = {}) {
  const native = new EventEmitter(); let checked = 0, quit = 0, unknown = 0;
  native.checkForUpdates = () => { checked++; if (nativeFailure) native.emit('error', new Error('uncertain native result')); };
  native.quitAndInstall = () => { quit++; };
  const admission = createUpdateAdmission();
  let failure;
  const handoff = createMacUpdateHandoff(native, () => failure?.('handoff-unknown'));
  const api = createDesktopUpdates({ currentVersion: '0.0.1-dev.1', now: () => 1, canInstall: () => ({ ok: true }),
    prepareInstall: () => admission.acquire(), onHandoffUnknown: () => { unknown++; }, transport: {
      check: async () => ({ available: true, version: '0.0.1-dev.2' }), download: () => ({ promise: Promise.resolve(), cancel() {} }),
      subscribeFailure: listener => { failure = listener; }, install: ({ canHandoff }) => handoff.install(canHandoff), dispose: handoff.close
    } });
  await api.check(); await api.download();
  return { api, native, admission, checked: () => checked, quit: () => quit, unknown: () => unknown };
}
test('delayed native download keeps admission closed until the approved final handoff', async () => {
  const h = await runtimeFixture(); assert.equal(h.api.install().ok, true); assert.equal(h.checked(), 1);
  assert.equal(h.quit(), 0); assert.equal(h.admission.isBlocked(), true); assert.equal(h.api.install().ok, false);
  h.native.emit('update-downloaded'); await Promise.resolve(); assert.equal(h.quit(), 1);
  assert.equal(h.admission.isBlocked(), true); h.api.dispose(); assert.equal(h.admission.isBlocked(), false);
});
test('ambiguous native failure retains the lease, is visible, and a late success does not silently quit', async () => {
  const h = await runtimeFixture({ nativeFailure: true }); h.api.install(); await Promise.resolve();
  assert.equal(h.api.read().phase, 'handoff-unknown'); assert.equal(h.unknown(), 1); assert.equal(h.admission.isBlocked(), true);
  h.native.emit('update-downloaded'); assert.equal(h.quit(), 0); assert.equal(h.api.cancel().ok, false); assert.equal(h.api.install().ok, false);
  h.api.dispose();
});
test('known pre-handoff failure releases its lease and preserves retryability', async () => {
  const admission = createUpdateAdmission();
  const api = createDesktopUpdates({ currentVersion: '0.0.1-dev.1', now: () => 1, canInstall: () => ({ ok: true }), prepareInstall: () => admission.acquire(), transport: {
    check: async () => ({ available: true, version: '0.0.1-dev.2' }), download: () => ({ promise: Promise.resolve(), cancel() {} }),
    install: () => { throw new Error('before native handoff'); }
  } });
  await api.check(); await api.download(); assert.equal(api.install().reason, 'install-failed'); assert.equal(admission.isBlocked(), false);
  assert.equal(api.read().phase, 'downloaded'); api.dispose();
});

test('an already admitted asynchronous IPC handler blocks the installation lease until settlement', async () => {
  const admission = createUpdateAdmission(), handlers = new Map(); let finish;
  const register = createIpcRegistrar({ ipcHost: { handle: (name, fn) => handlers.set(name, fn) }, senderPage: () => 'popover',
    allowedPagesFor: () => ['popover'], validatePayload: (_name, value) => value,
    canInvoke: () => !admission.isBlocked(), beginInvoke: () => admission.beginOperation() });
  register('credential:change', () => new Promise(resolve => { finish = resolve; }));
  const operation = handlers.get('credential:change')({}, {});
  assert.equal(admission.canRestart(), false); assert.throws(admission.acquire, /pending-operation/);
  finish({ ok: true }); await operation; assert.equal(admission.canRestart(), true);
  const lease = admission.acquire(); assert.equal((await handlers.get('credential:change')({}, {})).reason, 'application-updating'); lease.release();
});
test('silent native staging reaches a bounded unknown state, without pretending cancellation or releasing data protection', async () => {
  const native = new EventEmitter(), timers = []; let unknown = 0, quit = 0;
  native.checkForUpdates = () => {}; native.quitAndInstall = () => { quit++; };
  const handoff = createMacUpdateHandoff(native, () => { unknown++; }, {
    setTimer: (fn, ms) => { const item = { fn, ms }; timers.push(item); return item; }, clearTimer: timer => { if (timer) timer.cleared = true; } });
  const pending = handoff.install(() => true); assert.equal(timers[0].ms, 120_000);
  timers[0].fn(); await assert.rejects(pending, /handoff-unknown/);
  assert.equal(unknown, 1); assert.equal(handoff.hasHandedOff(), true);
  native.emit('update-downloaded'); assert.equal(quit, 0); assert.equal(timers[0].cleared, true); handoff.close();
});

test('failed hold of a new window makes final handoff unsafe without an uncaught event error', () => {
  const app = new EventEmitter(), first = windowFixture(), broken = windowFixture();
  const hold = holdUpdateWindows({ app, BrowserWindow: { getAllWindows: () => [first] } });
  broken.setEnabled = () => { throw new Error('native input failure'); };
  assert.doesNotThrow(() => app.emit('browser-window-created', {}, broken));
  assert.equal(hold.isSafe(), false);
  assert.throws(hold.release, /native input failure/); assert.equal(first.isEnabled(), true);
});
test('disposing pending native staging settles the observer without claiming native cancellation', async () => {
  const native = new EventEmitter(); let quits = 0;
  native.checkForUpdates = () => {}; native.quitAndInstall = () => { quits++; };
  const handoff = createMacUpdateHandoff(native);
  const pending = handoff.install(() => true); handoff.close();
  await assert.rejects(pending, { code: 'handoff-unknown' });
  assert.equal(handoff.hasHandedOff(), true); native.emit('update-downloaded'); assert.equal(quits, 0);
});

test('process teardown keeps admission and session holds until stores dispose; known failure is the only reopen path', async () => {
  const { createApplicationUpdates } = require('../src/bootstrap/desktop-updates');
  const admission = createUpdateAdmission(); let sessionHeld = false, retentionWrites = 0, windowRestores = 0, windowCleanups = 0;
  const lifecycle = createLifecycleRegistry();
  const api = createApplicationUpdates({ updateAdmission: admission, lifecycle,
    stateRepository: { snapshot: () => ({}), authoritativeWrites: { verify: () => ({ ok: true }) } },
    sessions: { canRestart: () => true, holdForRestart: () => { sessionHeld = true; return { release() { sessionHeld = false; retentionWrites++; } }; } },
    appHost: { whenReady: () => new Promise(() => {}), holdForUpdate: () => ({ release() { windowRestores++; }, dispose() { windowCleanups++; } }) },
    createTransport: () => ({ currentVersion: '0.0.1-dev.1', transport: {
      check: async () => ({ available: true, version: '0.0.1-dev.2' }), download: () => ({ promise: Promise.resolve(), cancel() {} }), install() {}, dispose() {}
    } }) });
  await api.check(); await api.download(); assert.equal(api.install().ok, true);
  lifecycle.dispose(); api.close();
  assert.equal(admission.isBlocked(), true); assert.equal(sessionHeld, true);
  assert.equal(retentionWrites, 0); assert.equal(windowRestores, 0); assert.equal(windowCleanups, 1);
  assert.equal(createUpdateAdmission().isBlocked(), false);
});
