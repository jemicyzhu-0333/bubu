'use strict';

const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const {
  SETTLE_FOCUS_SESSION_WRITES,
  settleFocusSessionDraft
} = require('./settle-focus-session');

const STOP_FOCUS_SESSION_WRITES = SETTLE_FOCUS_SESSION_WRITES;

function createStopFocusSessionWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  publishSettlement = () => {},
  clearNudge = () => {},
  clearTray = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('stop-focus-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('stop-focus-session workflow requires wall and session clocks');
  }
  const effects = [
    synchronize,
    publishSettlement,
    clearNudge,
    clearTray,
    present,
    publish,
    reportEffectError
  ];
  if (effects.some(effect => typeof effect !== 'function')) {
    throw new TypeError('stop-focus-session workflow effects must be functions');
  }

  function execute({ reason = 'stopped', sessionId, expectedRevision } = {}) {
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: STOP_FOCUS_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        // New defensive guard for a rendered offline-abandon action. Ordinary
        // stop/pause keep their existing contract; a stale abandon cannot stop a new round.
        if (sessionId !== undefined && execution.focusSession.isTimingSession(state.focusSession)
            && sessionId !== state.focusSession.sessionId) return { ok: false, reason: 'session-changed' };
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const stopped = execution.focusSession.stopSession(state.focusSession, sessionAt);
        if (!stopped.ok) return { ...stopped, sessionAt };

        const completion = reason === 'stopped'
          ? stopped.completion
          : { ...stopped.completion, reason };
        const settled = settleFocusSessionDraft(state, {
          nextSession: stopped.session,
          completion,
          settledAt: sessionAt
        });
        if (!settled.ok) {
          return { ...settled, session: state.focusSession, sessionAt };
        }
        return {
          ...settled,
          completion,
          requestedReason: reason,
          sessionAt
        };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.session) {
        response.session = execution.sessionProjection.projectSession(
          transaction.session,
          transaction.sessionAt === undefined ? wallNow : transaction.sessionAt
        );
      }
      return response;
    }

    const completion = Object.freeze({
      ...transaction.completion,
      activeSegments: Object.freeze(
        transaction.completion.activeSegments.map(segment => Object.freeze({ ...segment }))
      )
    });
    const fact = Object.freeze({
      type: 'session-stopped',
      requestedReason: transaction.requestedReason,
      settledAt: transaction.sessionAt,
      revision: transaction.revision,
      completion,
      session: transaction.state.focusSession,
      reward: transaction.reward,
      foodDrop: transaction.foodDrop,
      bond: transaction.bond,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publishSettlement, fact, reportEffectError);
    runPostCommitEffect(clearNudge, fact, reportEffectError);
    runPostCommitEffect(clearTray, fact, reportEffectError);
    runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return {
      ok: true,
      completion,
      session: execution.sessionProjection.projectSession(fact.session, transaction.sessionAt)
    };
  }

  return Object.freeze({ execute });
}

module.exports = { STOP_FOCUS_SESSION_WRITES, createStopFocusSessionWorkflow };
