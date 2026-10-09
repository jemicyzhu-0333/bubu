'use strict';

// Runtime request identity only; it neither grants data access nor owns state.
function createProviderRequestScope({ canBegin = () => true } = {}) {
  let epoch = Symbol('provider-requests'), closed = false;
  const active = new Set();
  function begin({ checkCurrent = () => true } = {}) {
    const identity = epoch, controller = new AbortController();
    let released = false;
    function assertCurrent() {
      let current = false;
      if (!closed && canBegin() && !released && identity === epoch && !controller.signal.aborted) {
        try { current = checkCurrent() === true; } catch (_) { /* Fail closed. */ }
      }
      if (!current) {
        controller.abort();
        throw new Error('provider-request-aborted');
      }
    }
    function release() { released = true; active.delete(controller); }
    assertCurrent();
    active.add(controller);
    return Object.freeze({ signal: controller.signal, assertCurrent, release });
  }
  function invalidate() {
    epoch = Symbol('provider-requests');
    const previous = [...active];
    active.clear();
    for (const controller of previous) controller.abort();
  }
  function close() { closed = true; invalidate(); }
  return Object.freeze({ begin, invalidate, close, canRestart: () => !closed && active.size === 0 });
}
module.exports = { createProviderRequestScope };
