'use strict';
// Post-commit reminder delivery must not reject a saved command or speak twice.
function createNudgeDelivery({ nudge, presentCompanion, reportError }) {
  return function deliver(options, { petMessage = null } = {}) {
    return Promise.resolve().then(() => nudge.startNudgeSequence(options)).then(result => {
      if (petMessage && result?.shown === true && !result.limitedToLevel && result.delivery !== 'companion') {
        presentCompanion(petMessage);
      }
      return result;
    }).catch(error => {
      try { reportError(error); } catch (_) {}
      return { shown: false, reason: 'nudge-failed' };
    });
  };
}
module.exports = { createNudgeDelivery };
