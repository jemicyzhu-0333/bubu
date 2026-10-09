'use strict';

const DELIVERY_TIMEOUT_MS = 3000;

// Each presentation gets one bounded delivery witness. Construction and show() calls
// are not evidence; only an accepted native event or visible initialized window is.
function createNudgeReceipt({ setTimer, clearTimer, accept, onFailure }) {
  let settled = false;
  let finish;
  let timer = null;
  const promise = new Promise(resolve => { finish = resolve; });
  function settle(value) {
    if (settled) return false;
    const accepted = value.shown ? accept(value) : value;
    settled = true;
    if (timer !== null) clearTimer(timer);
    finish(accepted);
    if (!accepted.shown) onFailure(accepted.reason);
    return true;
  }
  timer = setTimer(() => settle({ shown: false, reason: 'delivery-timeout' }), DELIVERY_TIMEOUT_MS);
  return Object.freeze({ promise, settle, isSettled: () => settled });
}

module.exports = { createNudgeReceipt };
