'use strict';

// ARCHITECTURE「AI 与 LLM」: the execution gate owns cancellation, not owner
// effects. A throwing scheduler must not retain a callback without a handle;
// successful scheduling returns a non-nullish handle (including zero).
function createTurnGuard(options = {}) {
  let sessionSignal;
  let budget;
  let schedule;
  let cancelSchedule;
  try {
    ({ sessionSignal, budget, schedule = setTimeout, cancelSchedule = clearTimeout } = options);
    if (!sessionSignal || typeof sessionSignal.aborted !== 'boolean'
        || typeof sessionSignal.addEventListener !== 'function'
        || typeof sessionSignal.removeEventListener !== 'function'
        || !budget || typeof budget.check !== 'function' || typeof budget.remainingMs !== 'function'
        || typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
      throw new Error('invalid-ports');
    }
  } catch (_) {
    throw setupFailure('ports', cleanupReport('not-acquired', 'not-acquired'));
  }
  const controller = new AbortController();
  let abortReason = null;
  let disposed = false;
  let cleanup = null;
  let timer;
  let timerState = 'not-acquired';
  let listenerState = 'not-acquired';
  function abort(reason) {
    if (!controller.signal.aborted) {
      abortReason = reason;
      controller.abort(reason);
    }
  }
  const onSessionAbort = () => abort('turn-canceled');
  function check() {
    if (disposed) throw new Error(abortReason || 'run-closed');
    if (!budget.check().ok) abort('turn-deadline');
    if (controller.signal.aborted) throw new Error(abortReason || 'turn-canceled');
  }
  async function wait(operation) {
    check();
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(new Error(abortReason || 'turn-canceled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), interrupted]);
      check();
      return result;
    } finally { controller.signal.removeEventListener('abort', onAbort); }
  }
  function dispose() {
    if (disposed) return cleanup;
    disposed = true;
    // abort dispatches synchronously. Reentrant disposal sees closed gates and
    // this bounded in-progress report, never another cancellation attempt.
    cleanup = cleanupReport(timerState, listenerState);
    abort('run-closed');
    if (timerState !== 'not-acquired' && timer !== undefined && timer !== null) {
      try { cancelSchedule(timer); timerState = 'released'; }
      catch (_) { timerState = 'unconfirmed'; }
    }
    if (listenerState !== 'not-acquired') {
      try { sessionSignal.removeEventListener('abort', onSessionAbort); listenerState = 'released'; }
      catch (_) { listenerState = 'unconfirmed'; }
    }
    cleanup = cleanupReport(timerState, listenerState);
    return cleanup;
  }
  let setupStage = 'listener';
  try {
    listenerState = 'unconfirmed';
    sessionSignal.addEventListener('abort', onSessionAbort, { once: true });
    if (sessionSignal.aborted) onSessionAbort();
    setupStage = 'clock';
    const remaining = budget.remainingMs();
    if (!Number.isFinite(remaining) || remaining < 0) throw new Error('invalid-clock');
    setupStage = 'schedule';
    timer = schedule(() => abort('turn-deadline'), remaining);
    timerState = 'unconfirmed';
    if (timer === undefined || timer === null) throw new Error('invalid-handle');
  } catch (_) {
    // Setup failures deliberately have a bounded category, without copying a
    // port's potentially private exception. Rollback never replaces it.
    throw setupFailure(setupStage, dispose());
  }
  return Object.freeze({ signal: controller.signal, check, wait, dispose });
}

function cleanupReport(timer, listener) {
  return Object.freeze({ ok: timer !== 'unconfirmed' && listener !== 'unconfirmed', timer, listener });
}

function setupFailure(setupStage, cleanup) {
  const error = new Error('run-setup-failed');
  error.setupStage = setupStage;
  error.cleanup = cleanup;
  return error;
}

module.exports = { createTurnGuard };
