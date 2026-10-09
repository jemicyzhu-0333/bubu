'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopUpdates } = require('../src/capabilities/app-maintenance').desktopUpdates;
const { createApplicationUpdates } = require('../src/bootstrap/desktop-updates');
const { createUpdateTransport } = require('../src/platform/electron/update-transport');
const { updateReleaseConfig } = require('../scripts/update-release-config');
function fixture(overrides = {}) {
  let installs = 0, failure, cancelled = 0, gate = { ok: true };
  const transport = { check: async () => ({ available: true, version: '1.0.1' }),
    download: progress => { progress(43.7); return { promise: Promise.resolve(), cancel: () => cancelled++ }; },
    install: () => installs++, subscribeFailure: fn => { failure = fn; return () => { failure = null; }; },
    ...overrides };
  const api = createDesktopUpdates({ transport, canInstall: () => gate, now: () => 1234, currentVersion: '1.0.0' });
  return { api, installs: () => installs, cancelled: () => cancelled, fail: () => failure?.(), gate: value => { gate = value; } };
}
test('update download and installation are separate explicit actions with a fresh local gate', async () => {
  const f = fixture(); assert.equal(f.api.read().phase, 'idle');
  await f.api.check(); assert.equal(f.api.read().phase, 'available'); assert.equal(f.installs(), 0);
  await f.api.download(); assert.equal(f.api.read().phase, 'downloaded'); assert.equal(f.installs(), 0);
  f.gate({ ok: false, reason: 'active-session' }); assert.equal(f.api.install().reason, 'active-session');
  f.gate({ ok: true }); assert.equal(f.api.install().ok, true); assert.equal(f.installs(), 1);
  assert.equal(f.api.install().ok, false); assert.equal(f.installs(), 1);
  f.fail(); assert.equal(f.api.read().phase, 'downloaded'); assert.equal(f.api.read().reason, 'install-failed');
  f.api.dispose();
});
test('repeated checks coalesce and disposal blocks further network work', async () => {
  let resolve, calls = 0;
  const f = fixture({ check: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const a = f.api.check(), b = f.api.check(); assert.equal(a, b);
  await Promise.resolve(); assert.equal(calls, 1); resolve({ available: false }); await a;
  assert.equal(f.api.read().phase, 'current'); f.api.dispose();
  assert.equal((await f.api.check()).reason, 'closed'); assert.equal(calls, 1);
});
test('cancelled download ignores later progress and permits an explicit retry', async () => {
  let resolve, progress, cancels = 0;
  const f = fixture({ download: fn => { progress = fn; return { promise: new Promise(done => { resolve = done; }), cancel: () => cancels++ }; } });
  await f.api.check(); const pending = f.api.download(); await Promise.resolve(); progress(55);
  assert.equal(f.api.cancel().ok, true); progress(99); assert.equal(f.api.read().percent, 55);
  resolve(); assert.equal((await pending).reason, 'cancelled'); assert.equal(cancels, 1);
  assert.equal(f.api.read().phase, 'available'); assert.equal(f.api.read().percent, 0); f.api.dispose();
});
test('transport failures remain retryable and never become a saved installation', async () => {
  const f = fixture({ download: () => { throw new Error('offline'); } });
  await f.api.check(); assert.equal((await f.api.download()).reason, 'download-failed');
  assert.equal(f.api.install().ok, false); assert.equal(f.installs(), 0); f.api.dispose();
  const g = fixture({ check: async () => { throw new Error('offline'); } });
  assert.equal((await g.api.check()).reason, 'check-failed'); assert.equal(g.api.read().phase, 'error'); g.api.dispose();
});
test('development and unsupported builds never load updater or schedule a check', () => {
  for (const [app, platform, reason] of [[{ isPackaged: false }, 'darwin', 'development-build'], [{ isPackaged: true }, 'linux', 'unsupported-platform']]) {
    const config = createUpdateTransport({ app: { ...app, getVersion: () => '0.0.1-dev' }, platform, loadUpdater: () => assert.fail('must remain local') });
    assert.equal(config.unavailableReason, reason);
  }
  const api = createApplicationUpdates({ stateRepository: {}, appHost: { whenReady: () => assert.fail('must not schedule') },
    createTransport: () => ({ transport: {}, currentVersion: 'dev', unavailableReason: 'development-build' }) });
  assert.equal(api.read().phase, 'unavailable'); api.close();
});
test('install checks canonical session, pending landing and durable storage at action time', async () => {
  let state = {}, durable = true, installs = 0;
  const api = createApplicationUpdates({ stateRepository: { snapshot: () => state, get: () => ({}), authoritativeWrites: { verify: () => ({ ok: durable }) } },
    appHost: { whenReady: () => new Promise(() => {}) },
    createTransport: () => ({ currentVersion: '1.0.0', transport: { check: async () => ({ available: true, version: '1.0.1' }), download: () => ({ promise: Promise.resolve(), cancel() {} }), install: () => installs++ } }) });
  await api.check(); await api.download();
  state = { focusSession: { status: 'paused' } }; assert.equal(api.install().reason, 'active-session');
  state = { quickStartDecision: { status: 'pending' } }; assert.equal(api.install().reason, 'pending-landing');
  state = {}; durable = false; assert.equal(api.install().reason, 'storage-unavailable');
  durable = true; assert.equal(api.install().ok, true); assert.equal(installs, 1); api.close();
});

test('dispose before the queued operation starts makes zero transport calls', async () => {
  let checks = 0, downloads = 0;
  const a = fixture({ check: async () => { checks++; return { available: false }; } });
  const checking = a.api.check(); a.api.dispose();
  assert.equal((await checking).reason, 'closed'); assert.equal(checks, 0);
  const b = fixture({ download: () => { downloads++; return { promise: Promise.resolve(), cancel() {} }; } });
  await b.api.check(); const downloading = b.api.download(); b.api.dispose();
  assert.equal((await downloading).reason, 'closed'); assert.equal(downloads, 0);
});
