'use strict';

function readClarification({ nextAction, taskVersion } = {}) {
  if (nextAction === undefined && taskVersion === undefined) return { ok: true, clarification: null };
  if (typeof nextAction !== 'string' || !nextAction.trim() || nextAction.trim().length > 200
      || typeof taskVersion !== 'string' || !/^[a-f0-9]{64}$/.test(taskVersion)) {
    return { ok: false, reason: 'invalid-quick-start-clarification' };
  }
  return { ok: true, clarification: { nextAction: nextAction.trim(), taskVersion } };
}

module.exports = { readClarification };
