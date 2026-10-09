'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { projectSession } = require('../contract/session-projection');
const { replaceSession } = require('../domain/session-settlement');
const { pauseSession } = require('../domain/session-transitions');

const PAUSE_SESSION_WRITES = Object.freeze(['focusSession']);

function createPauseSessionCommand({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  clearNudge = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('pause-session command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('pause-session command requires wall and session clocks');
  }
  if ([synchronize, clearNudge, present, publish, reportEffectError]
    .some(effect => typeof effect !== 'function')) {
    throw new TypeError('pause-session command effects must be functions');
  }

  function execute({ expectedRevision } = {}) {
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: PAUSE_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const paused = pauseSession(state.focusSession, sessionAt);
        if (!paused.ok) return { ...paused, sessionAt };
        if (paused.completion) {
          return {
            ok: false,
            reason: 'session-completed',
            completion: paused.completion,
            nextSession: paused.session,
            session: paused.session,
            sessionAt
          };
        }

        replaceSession(state, paused.session, sessionAt);
        return { ok: true, sessionAt };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.completion) response.completion = transaction.completion;
      if (transaction.nextSession) response.nextSession = transaction.nextSession;
      if (transaction.reason === 'session-completed') {
        response.settledAt = transaction.sessionAt;
      }
      if (transaction.session) {
        response.session = projectSession(
          transaction.session,
          transaction.sessionAt === undefined ? wallNow : transaction.sessionAt
        );
      }
      return response;
    }

    const session = transaction.state.focusSession;
    const fact = Object.freeze({
      type: 'session-paused',
      pausedAt: transaction.sessionAt,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(clearNudge, fact, reportEffectError);
    runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return { ok: true, session: projectSession(session, transaction.sessionAt) };
  }

  return Object.freeze({ execute });
}

module.exports = { PAUSE_SESSION_WRITES, createPauseSessionCommand };
