'use strict';
const { createUpdateTransport } = require('../platform/electron/update-transport');
const { createDesktopUpdates } = require('../capabilities/app-maintenance').desktopUpdates;

function createApplicationUpdates({ stateRepository, appHost, requestScope, sessions, updateAdmission, lifecycle, createTransport = createUpdateTransport,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now() }) {
  const configuration = createTransport();
  const updates = createDesktopUpdates({ ...configuration, now, onHandoffUnknown: () => appHost.showUpdateHandoffUnknown?.(), prepareInstall: () => {
    if (!updateAdmission) return { release() {} };
    const holds = [];
    const release = () => { for (const hold of holds.splice(0)) { try { hold.release(); } catch (_) {} } };
    try {
      holds.push(updateAdmission.acquire());
      holds.push(sessions.holdForRestart());
      holds.push(lifecycle.holdTimers());
      holds.push(appHost.holdForUpdate());
      return { release, isSafe: () => holds.every(hold => !hold.isSafe || hold.isSafe()), dispose() {
        // Process teardown must not reopen admission, resume timers, or trigger
        // retention writes before sessions/storage have finished disposing.
        for (const hold of holds.splice(0)) { try { hold.dispose?.(); } catch (_) {} }
      } };
    } catch (error) { release(); throw error; }
  }, canInstall: () => {
    if (updateAdmission?.canRestart() === false) return { ok: false, reason: 'pending-operation' };
    const state = stateRepository.snapshot();
    if (state.focusSession?.status && state.focusSession.status !== 'idle') return { ok: false, reason: 'active-session' };
    if (state.focusLandingPrompt?.status === 'pending' || state.quickStartDecision?.status === 'pending') return { ok: false, reason: 'pending-landing' };
    if (requestScope && requestScope.canRestart?.() !== true) return { ok: false, reason: 'active-provider-request' };
    if (sessions && sessions.canRestart?.() !== true) return { ok: false, reason: 'unsaved-conversation' };
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
