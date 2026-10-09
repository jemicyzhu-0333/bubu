'use strict';

// Update state is ephemeral; the installer cache belongs to the platform, never the profile.
function createDesktopUpdates({ transport, canInstall, now, currentVersion, unavailableReason = null }) {
  if (!transport || typeof canInstall !== 'function' || typeof now !== 'function') throw new TypeError('update ports required');
  let state = { phase: unavailableReason ? 'unavailable' : 'idle', reason: unavailableReason,
    currentVersion, version: null, percent: 0, checkedAt: null };
  let pending = null, cancelDownload = null, disposed = false;
  const read = () => Object.freeze({ ...state });
  const stopFailures = transport.subscribeFailure?.(() => {
    if (state.phase === 'installing') set({ phase: 'downloaded', reason: 'install-failed' });
  });
  const refused = reason => ({ ok: false, reason, state: read() });
  function set(patch) { if (!disposed) state = { ...state, ...patch }; }
  function run(work) {
    if (disposed) return Promise.resolve(refused('closed'));
    if (unavailableReason) return Promise.resolve(refused(unavailableReason));
    if (pending) return pending;
    pending = Promise.resolve().then(() => disposed ? refused('closed') : work()).finally(() => { pending = null; });
    return pending;
  }
  function check() {
    if (['downloaded', 'installing'].includes(state.phase)) return Promise.resolve({ ok: true, state: read() });
    return run(async () => {
      set({ phase: 'checking', reason: null, percent: 0 });
      try {
        const result = await transport.check();
        set({ phase: result.available ? 'available' : 'current', version: result.available ? result.version : null,
          checkedAt: now(), reason: null });
        return { ok: true, state: read() };
      } catch (_) {
        set({ phase: 'error', reason: 'check-failed' });
        return refused('check-failed');
      }
    });
  }
  function download() {
    if (pending) return pending;
    if (!['available', 'error'].includes(state.phase) || !state.version) return Promise.resolve(refused('no-update'));
    return run(async () => {
      let cancelled = false;
      let operation;
      set({ phase: 'downloading', reason: null, percent: 0 });
      try {
        operation = transport.download(percent => {
          if (!cancelled) set({ percent: Math.max(0, Math.min(100, Math.floor(Number(percent) || 0))) });
        });
        cancelDownload = () => { cancelled = true; operation.cancel(); set({ phase: 'cancelling' }); };
        await operation.promise;
        set({ phase: cancelled ? 'available' : 'downloaded', percent: cancelled ? 0 : 100 });
        return { ok: !cancelled, reason: cancelled ? 'cancelled' : null, state: read() };
      } catch (_) {
        set({ phase: cancelled ? 'available' : 'error', reason: cancelled ? null : 'download-failed', percent: 0 });
        return refused(cancelled ? 'cancelled' : 'download-failed');
      } finally { cancelDownload = null; }
    });
  }
  function cancel() {
    if (!cancelDownload) return refused('not-downloading');
    cancelDownload();
    return { ok: true, state: read() };
  }
  function install() {
    if (disposed || state.phase !== 'downloaded' || pending) return refused('not-ready');
    let permission;
    try { permission = canInstall(); } catch (_) { permission = { ok: false, reason: 'storage-unavailable' }; }
    if (!permission.ok) { set({ reason: permission.reason }); return refused(permission.reason); }
    set({ phase: 'installing', reason: null });
    try { transport.install(); return { ok: state.phase === 'installing', reason: state.reason, state: read() }; }
    catch (_) { set({ phase: 'downloaded', reason: 'install-failed' }); return refused('install-failed'); }
  }
  function dispose() { disposed = true; cancelDownload?.(); stopFailures?.(); transport.dispose?.(); }
  return Object.freeze({ read, check, download, cancel, install, dispose });
}
module.exports = { createDesktopUpdates };
