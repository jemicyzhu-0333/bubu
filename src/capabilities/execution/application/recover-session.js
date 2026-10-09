'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { projectSession } = require('../contract/session-projection');
const {
  recoverSession,
  pauseForOfflineConfirmation
} = require('../domain/session-recovery');
const { replaceSession } = require('../domain/session-settlement');

const RECOVER_SESSION_WRITES = Object.freeze(['focusSession']);

function createRecoverSessionCommand({
  unitOfWork,
  clock,
  synchronize = () => {},
  notifyDue = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('recover-session command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('recover-session command requires a wall clock');
  }
  if ([synchronize, notifyDue, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('recover-session command effects must be functions');
  }

  function execute({ expectedRevision } = {}) {
    // Process absence cannot be measured by the monotonic runtime clock. Read
    // wall time once, then hold a due session for explicit user confirmation.
    const recoveredAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECOVER_SESSION_WRITES,
      expectedRevision,
      context: { now: recoveredAt },
      transition: state => {
        const recovery = recoverSession(state.focusSession, { now: recoveredAt });
        if (recovery.action !== 'completed') {
          replaceSession(state, recovery.session, recoveredAt);
          return { ok: true, action: recovery.action, recoveredAt };
        }

        const held = pauseForOfflineConfirmation(state.focusSession, recoveredAt);
        if (!held.ok) return { ...held, recoveredAt };
        replaceSession(state, held.session, recoveredAt);
        return {
          ok: true,
          action: 'awaiting-confirmation',
          recoveredAt,
          completion: held.completion
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };

    const session = transaction.state.focusSession;
    const fact = Object.freeze({
      type: 'session-recovered',
      action: transaction.action,
      recoveredAt,
      committed: transaction.committed,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    if (transaction.action === 'awaiting-confirmation') {
      runPostCommitEffect(notifyDue, fact, reportEffectError);
    }

    const response = {
      ok: true,
      action: transaction.action,
      session: projectSession(session, recoveredAt)
    };
    if (transaction.completion) response.completion = transaction.completion;
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RECOVER_SESSION_WRITES, createRecoverSessionCommand };
