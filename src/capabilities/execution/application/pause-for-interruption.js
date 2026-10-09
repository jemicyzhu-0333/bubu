'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { projectSession } = require('../contract/session-projection');
const { pauseForOfflineConfirmation } = require('../domain/session-recovery');
const { replaceSession } = require('../domain/session-settlement');

const PAUSE_FOR_INTERRUPTION_WRITES = Object.freeze(['focusSession']);

function createPauseForInterruptionCommand({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  clearNudge = () => {},
  clearTray = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('pause-for-interruption command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('pause-for-interruption command requires wall and session clocks');
  }
  if ([synchronize, clearNudge, clearTray, present, publish, reportEffectError]
    .some(effect => typeof effect !== 'function')) {
    throw new TypeError('pause-for-interruption command effects must be functions');
  }

  function execute({ publish: shouldPublish = true, expectedRevision } = {}) {
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: PAUSE_FOR_INTERRUPTION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const pausedAt = sessionClock.now(state.focusSession, wallNow);
        const paused = pauseForOfflineConfirmation(state.focusSession, pausedAt);
        if (!paused.ok) return { ...paused, pausedAt };
        replaceSession(state, paused.session, pausedAt);
        return {
          ok: true,
          pausedAt,
          due: paused.due === true,
          completion: paused.completion
        };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.session) {
        response.session = projectSession(transaction.session, transaction.pausedAt ?? wallNow);
      }
      return response;
    }

    const session = transaction.state.focusSession;
    const fact = Object.freeze({
      type: 'session-paused-for-interruption',
      pausedAt: transaction.pausedAt,
      due: transaction.due,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(clearNudge, fact, reportEffectError);
    runPostCommitEffect(clearTray, fact, reportEffectError);
    runPostCommitEffect(present, fact, reportEffectError);
    if (shouldPublish !== false) runPostCommitEffect(publish, fact, reportEffectError);

    const response = { ok: true, session: projectSession(session, transaction.pausedAt) };
    if (transaction.due) response.due = true;
    if (transaction.completion) response.completion = transaction.completion;
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = {
  PAUSE_FOR_INTERRUPTION_WRITES,
  createPauseForInterruptionCommand
};
