'use strict';

const { createTurnBudget } = require('./run-budget');
const { createTurnGuard } = require('./collaboration-turn-guard');

// ARCHITECTURE「AI 与 LLM」: one execution budget, no authorization, session,
// disclosure, fallback, lease or persistence ownership. assertCurrent is a
// trusted synchronous owner assertion. It may call check(), which never calls
// it back. Callers fence owner effects with assertOpen before their own checks.
function createRunExecution(options = {}) {
  let now;
  let limits;
  let signal;
  let schedule;
  let cancelSchedule;
  let assertCurrent;
  try { ({ now, limits, signal, schedule, cancelSchedule, assertCurrent } = options); }
  catch (_) { throw setupFailure('ports'); }
  if (typeof assertCurrent !== 'function') throw setupFailure('freshness');
  let budget;
  try { budget = createTurnBudget({ now, limits }); }
  catch (_) { throw setupFailure('budget'); }
  const guard = createTurnGuard({ sessionSignal: signal, budget, schedule, cancelSchedule });
  const operations = new Set();
  let disposed = false;

  function assertRunOpen() {
    if (guard.signal.aborted) throw new Error(guard.signal.reason);
    if (disposed) throw new Error('run-closed');
  }
  function check() {
    if (disposed) assertRunOpen();
    guard.check();
  }
  function consume(kind) {
    const result = budget.consume(kind);
    if (!result.ok) throw new Error(result.reason);
  }
  function consumeRead() {
    assertRunOpen();
    consume('read');
  }
  async function wait(operation) {
    assertRunOpen();
    let open = true;
    function close() { open = false; operations.delete(close); }
    function assertOpen() {
      assertRunOpen();
      if (!open) throw new Error('operation-closed');
    }
    const controls = Object.freeze({
      signal: guard.signal,
      assertOpen,
      isOpen: () => open && !disposed && !guard.signal.aborted,
      beforeProviderAttempt() {
        assertOpen();
        const result = assertCurrent();
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).then(() => {}, () => {});
          throw new Error('run-freshness-async');
        }
        assertOpen();
        consume('provider');
      }
    });
    operations.add(close);
    try {
      return await guard.wait(() => {
        assertOpen();
        let result;
        try { result = operation(controls); }
        catch (error) { close(); throw error; }
        // Close at the first observed settlement, before guard.wait resumes.
        // A producer's earlier queued microtask is not yet observable here.
        return Promise.resolve(result).then(value => { close(); return value; },
          error => { close(); throw error; });
      });
    } finally { close(); }
  }
  function dispose() {
    disposed = true;
    for (const close of operations) close();
    return guard.dispose();
  }
  return Object.freeze({ signal: guard.signal, limits: budget.limits, check,
    consumeRead, wait, counts: budget.counts, usage: budget.usage, budgetStatus: budget.check, dispose });
}

function setupFailure(setupStage) {
  const error = new Error('run-setup-failed');
  error.setupStage = setupStage;
  error.cleanup = Object.freeze({ ok: true, timer: 'not-acquired', listener: 'not-acquired' });
  return error;
}

module.exports = { createRunExecution };
