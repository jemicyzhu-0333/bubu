'use strict';

// Update state is ephemeral; the installer cache belongs to the platform, never the profile.
function createDesktopUpdates({ transport, canInstall, prepareInstall = () => ({ release() {} }), onHandoffUnknown = () => {}, now, currentVersion, channel = null, unavailableReason = null }) {
  if (!transport || typeof canInstall !== 'function' || typeof now !== 'function') throw new TypeError('update ports required');
  let state = { phase: unavailableReason ? 'unavailable' : 'idle', reason: unavailableReason,
    currentVersion, channel, version: null, percent: 0, checkedAt: null };
  let pending = null, cancelDownload = null, disposed = false, epoch = 0, installationLease = null;
  const read = () => Object.freeze({ ...state });
  const stopFailures = transport.subscribeFailure?.(reason => {
    if (state.phase === 'installing') installationFailed({ code: reason });
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
    if (['downloaded', 'installing', 'handoff-unknown'].includes(state.phase)) return Promise.resolve({ ok: true, state: read() });
    return run(async () => {
      set({ phase: 'checking', reason: null, percent: 0, version: null });
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
      const ticket = ++epoch;
      let operation;
      set({ phase: 'downloading', reason: null, percent: 0 });
      try {
        operation = transport.download(percent => {
          if (!cancelled && ticket === epoch) set({ percent: Math.max(0, Math.min(100, Math.floor(Number(percent) || 0))) });
        });
        cancelDownload = () => {
          if (cancelled) return;
          cancelled = true; set({ phase: 'cancelling' }); operation.cancel();
        };
        await operation.promise;
        set({ phase: cancelled ? 'available' : 'downloaded', percent: cancelled ? 0 : 100 });
        return { ok: !cancelled, reason: cancelled ? 'cancelled' : null, state: read() };
      } catch (_) {
        set({ phase: cancelled ? 'available' : 'error', reason: cancelled ? null : 'download-failed', percent: 0 });
        return refused(cancelled ? 'cancelled' : 'download-failed');
      } finally { epoch += 1; cancelDownload = null; }
    });
  }
  function cancel() {
    if (!cancelDownload) return refused('not-downloading');
    cancelDownload();
    return { ok: true, state: read() };
  }
  function releaseInstallation(shuttingDown = false) {
    const lease = installationLease; installationLease = null;
    if (shuttingDown && lease?.dispose) lease.dispose(); else lease?.release();
  }
  function installationFailed(error) {
    if (disposed || state.phase !== 'installing') return;
    if (error?.code === 'handoff-unknown') {
      set({ phase: 'handoff-unknown', reason: 'handoff-unknown' });
      const unavailable = () => set({ reason: 'handoff-recovery-unavailable' });
      try { Promise.resolve(onHandoffUnknown()).catch(unavailable); } catch (_) { unavailable(); }
      return;
    }
    set({ phase: 'downloaded', reason: 'install-failed' }); releaseInstallation();
  }
  function install() {
    if (disposed || state.phase !== 'downloaded' || pending) return refused('not-ready');
    let permission;
    try { permission = canInstall(); } catch (_) { permission = { ok: false, reason: 'storage-unavailable' }; }
    if (!permission.ok) { set({ reason: permission.reason }); return refused(permission.reason); }
    try {
      installationLease = prepareInstall();
      permission = canInstall();
      if (installationLease?.isSafe?.() === false) throw new Error('update-hold-failed');
      if (!permission.ok) { releaseInstallation(); set({ reason: permission.reason }); return refused(permission.reason); }
      set({ phase: 'installing', reason: null });
      const operation = transport.install({ canHandoff: () => !disposed && state.phase === 'installing' && installationLease?.isSafe?.() !== false && canInstall().ok === true });
      if (operation && typeof operation.then === 'function') operation.catch(installationFailed);
      return { ok: state.phase === 'installing', reason: state.reason, state: read() };
    } catch (error) {
      if (state.phase === 'installing') installationFailed(error);
      else { set({ phase: 'downloaded', reason: 'install-failed' }); releaseInstallation(); }
      return refused(state.reason);
    }
  }
  function dispose() { disposed = true; epoch += 1; cancelDownload?.(); stopFailures?.(); transport.dispose?.(); releaseInstallation(true); }
  return Object.freeze({ read, check, download, cancel, install, dispose });
}
module.exports = { createDesktopUpdates };
