'use strict';
const { createUpdateTransport } = require('../platform/electron/update-transport');
const { createDesktopUpdates } = require('../capabilities/app-maintenance').desktopUpdates;

function createApplicationUpdates({ stateRepository, appHost, createTransport = createUpdateTransport,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() }) {
  const configuration = createTransport();
  const updates = createDesktopUpdates({ ...configuration, now, canInstall: () => {
    const state = stateRepository.snapshot();
    if (state.focusSession?.status && state.focusSession.status !== 'idle') return { ok: false, reason: 'active-session' };
    if (state.focusLandingPrompt?.status === 'pending' || state.quickStartDecision?.status === 'pending') return { ok: false, reason: 'pending-landing' };
    const verified = stateRepository.authoritativeWrites?.verify?.();
    return verified?.ok === true ? { ok: true } : { ok: false, reason: 'storage-unavailable' };
  } });
  let timer = null, closed = false;
  async function poll() {
    if (closed) return;
    try { if (stateRepository.get('settings')?.autoCheckUpdates !== false) await updates.check(); }
    catch (_) { /* A failed profile read must not become an unhandled background rejection. */ }
    finally { if (!closed) timer = setTimer(poll, 6 * 60 * 60_000); }
  }
  if (!configuration.unavailableReason) appHost.whenReady().then(() => {
    if (!closed) timer = setTimer(poll, 60_000);
  });
  return Object.freeze({ ...updates, close() { closed = true; clearTimer(timer); updates.dispose(); } });
}
module.exports = { createApplicationUpdates };
