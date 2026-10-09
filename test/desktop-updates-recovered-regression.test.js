'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDesktopUpdates } = require('../src/capabilities/app-maintenance').desktopUpdates;
function fixture(extra = {}) {
  let downloads = 0, installs = 0, finish, fail, progress;
  const transport = {
    check: async () => ({ available: true, version: '1.1.0' }),
    download: callback => { downloads += 1; progress = callback; return {
      promise: new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
      cancel: () => fail(new Error('cancelled'))
    }; },
    install: () => { installs += 1; }, ...extra.transport
  };
  const updates = createDesktopUpdates({ transport, canInstall: () => ({ ok: true }), now: () => 100,
    currentVersion: '1.0.0', ...extra, transport });
  return { updates, downloads: () => downloads, installs: () => installs,
    finish: () => finish(), fail: () => fail(new Error('private URL must not escape')), progress: value => progress(value) };
}
test('check and download are separate; duplicate clicks share one operation; install requires a verified download', async () => {
  const h = fixture();
  assert.equal(h.updates.install().reason, 'not-ready');
  const first = h.updates.check(); assert.equal(h.updates.check(), first); await first;
  assert.equal(h.downloads(), 0);
  const download = h.updates.download(); assert.equal(h.updates.download(), download);
  await Promise.resolve(); h.progress(27.8);
  assert.equal(h.updates.read().percent, 27);
  h.finish(); await download;
  assert.equal(h.updates.read().phase, 'downloaded');
  assert.equal(h.updates.install().ok, true); assert.equal(h.installs(), 1);
  assert.equal(h.updates.install().ok, false);
});
test('cancel retains the offered version and retries use a new download without parallel writes', async () => {
  const h = fixture(); await h.updates.check();
  const downloading = h.updates.download(); await Promise.resolve();
  assert.equal(h.updates.cancel().ok, true);
  assert.equal((await downloading).reason, 'cancelled');
  assert.equal(h.updates.read().phase, 'available');
  const retry = h.updates.download(); await Promise.resolve(); h.finish(); await retry;
  assert.equal(h.downloads(), 2); assert.equal(h.updates.read().phase, 'downloaded');
});
test('download error is bounded, leaves the current app usable and can retry', async () => {
  const h = fixture(); await h.updates.check();
  const pending = h.updates.download(); await Promise.resolve(); h.fail();
  assert.equal((await pending).reason, 'download-failed');
  assert.equal(h.updates.read().version, '1.1.0');
  assert.doesNotMatch(JSON.stringify(h.updates.read()), /private URL/);
  assert.equal(h.updates.install().ok, false);
});
test('active session and unverifiable storage block install until the condition clears', async () => {
  let permission = { ok: false, reason: 'active-session' };
  const h = fixture({ canInstall: () => permission }); await h.updates.check();
  const pending = h.updates.download(); await Promise.resolve(); h.finish(); await pending;
  assert.equal(h.updates.install().reason, 'active-session'); assert.equal(h.installs(), 0);
  permission = { ok: false, reason: 'storage-unavailable' };
  assert.equal(h.updates.install().reason, 'storage-unavailable');
  permission = { ok: true }; assert.equal(h.updates.install().ok, true);
});
test('development builds never contact a provider; late check results cannot revive a disposed runtime', async () => {
  const h = fixture({ unavailableReason: 'development-build', transport: { check: () => assert.fail('network') } });
  assert.equal((await h.updates.check()).reason, 'development-build');
  let resolve;
  const live = fixture({ transport: { check: () => new Promise(done => { resolve = done; }) } });
  const pending = live.updates.check(); await Promise.resolve(); live.updates.dispose();
  const before = live.updates.read(); resolve({ available: true, version: '1.1.0' }); await pending;
  assert.deepEqual(live.updates.read(), before); assert.equal(live.updates.install().ok, false);
});
test('synchronous adapter failures and installation error events become retryable states', async () => {
  const broken = fixture({ transport: { download: () => { throw new Error('disk'); } } });
  await broken.updates.check(); assert.equal((await broken.updates.download()).reason, 'download-failed');
  let failure;
  const h = fixture({ transport: { subscribeFailure: fn => { failure = fn; }, install: () => failure() } });
  await h.updates.check(); const pending = h.updates.download(); await Promise.resolve(); h.finish(); await pending;
  assert.equal(h.updates.install().ok, false); assert.equal(h.updates.read().reason, 'install-failed');
});
