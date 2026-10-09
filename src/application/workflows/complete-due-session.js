'use strict';

const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const {
  SETTLE_FOCUS_SESSION_WRITES,
  settleFocusSessionDraft
} = require('./settle-focus-session');

const COMPLETE_DUE_SESSION_WRITES = SETTLE_FOCUS_SESSION_WRITES;

function createCompleteDueSessionWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  publishSettlement = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('complete-due-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('complete-due-session workflow requires wall and session clocks');
  }
  const effects = [synchronize, publishSettlement, present, publish, reportEffectError];
  if (effects.some(effect => typeof effect !== 'function')) {
    throw new TypeError('complete-due-session workflow effects must be functions');
  }

  function execute({ expectedRevision } = {}) {
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: COMPLETE_DUE_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const due = execution.focusSession.completeIfDue(state.focusSession, sessionAt);
        if (!due.completed) {
          return {
            ok: true,
            completed: false,
            session: due.session,
            sessionAt
          };
        }

        const settled = settleFocusSessionDraft(state, {
          nextSession: due.session,
          completion: due.completion,
          settledAt: sessionAt
        });
        if (!settled.ok) {
          return { ...settled, session: state.focusSession, sessionAt };
        }
        return {
          ...settled,
          completed: true,
          completion: due.completion,
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
    if (!transaction.completed) {
      return {
        ok: true,
        completed: false,
        session: execution.sessionProjection.projectSession(
          transaction.session,
          transaction.sessionAt
        )
      };
    }

    const completion = Object.freeze({
      ...transaction.completion,
      activeSegments: Object.freeze(
        transaction.completion.activeSegments.map(segment => Object.freeze({ ...segment }))
      )
    });
    const fact = Object.freeze({
      type: 'due-session-completed',
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
    runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return {
      ok: true,
      completed: true,
      completion,
      session: execution.sessionProjection.projectSession(fact.session, transaction.sessionAt)
    };
  }

  return Object.freeze({ execute });
}

module.exports = { COMPLETE_DUE_SESSION_WRITES, createCompleteDueSessionWorkflow };
