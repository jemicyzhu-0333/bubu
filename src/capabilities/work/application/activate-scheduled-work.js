'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { activateDueSchedules } = require('../domain/schedule-activation');

const ACTIVATE_SCHEDULED_WORK_WRITES = Object.freeze(['tasks']);

function createActivateScheduledWorkCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('activate-scheduled-work command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('activate-scheduled-work command requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('activate-scheduled-work command effects must be functions');
  }

  // The work-boundary watcher checks several rules against one instant, so it
  // passes that instant in rather than letting each command read its own clock
  // and disagree about which minute the tick belonged to.
  function execute({ now: requestedNow, expectedRevision } = {}) {
    const activatedAt = requestedNow === undefined ? clock.now() : requestedNow;
    if (!Number.isFinite(activatedAt) || activatedAt < 0) {
      throw new TypeError('activate-scheduled-work requires a valid time');
    }
    const transaction = unitOfWork.run({
      writes: ACTIVATE_SCHEDULED_WORK_WRITES,
      expectedRevision,
      context: { now: activatedAt },
      transition: state => activateDueSchedules(state, activatedAt)
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'scheduled-work-activated',
        activatedTaskIds: Object.freeze([...transaction.activatedTaskIds]),
        activatedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, activatedCount: transaction.activatedTaskIds.length };
  }

  return Object.freeze({ execute });
}

module.exports = { ACTIVATE_SCHEDULED_WORK_WRITES, createActivateScheduledWorkCommand };
