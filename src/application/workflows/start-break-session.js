'use strict';

const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { recordSessionGrowth } = require('./record-session-growth');

const START_BREAK_SESSION_WRITES = Object.freeze([
  'focusSession', 'xp', 'level', 'rewardLedger', 'pet', 'companion', 'unlockedSkins'
]);

function createStartBreakSessionWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  idFactory,
  synchronize = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('start-break-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('start-break-session workflow requires wall and session clocks');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('start-break-session workflow requires an id factory');
  }
  if ([synchronize, present, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('start-break-session workflow effects must be functions');
  }

  function execute({
    taskId = null,
    minutes,
    userInitiated = false,
    present: shouldPresent = true,
    expectedRevision
  } = {}) {
    if (typeof userInitiated !== 'boolean') return { ok: false, reason: 'invalid-rest-choice' };
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: START_BREAK_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const authorized = execution.sessionStart.authorizeBreakStart(state);
        if (!authorized.ok) return { ...authorized, session: state.focusSession, sessionAt };

        const due = execution.focusSession.completeIfDue(state.focusSession, sessionAt);
        if (due.completed) {
          return {
            ok: false,
            reason: 'previous-session-completed',
            completion: due.completion,
            nextSession: due.session,
            session: due.session,
            sessionAt
          };
        }

        const started = execution.focusSession.startBreak(state.focusSession, {
          taskId,
          minutes,
          now: sessionAt
        }, { idFactory: () => idFactory('session') });
        if (!started.ok) return { ...started, sessionAt };
        if (started.recoveredCompletion) {
          throw new Error('session became due after the break-start preflight');
        }

        execution.sessionSettlement.replaceSession(state, started.session, sessionAt);
        return {
          ok: true, sessionAt, shouldPresent: shouldPresent !== false,
          ...recordSessionGrowth(state, {
            sessionId: started.session.sessionId, taskId: started.session.taskId,
            progressMade: false, closing: userInitiated, now: wallNow, kind: 'break'
          })
        };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.duplicate !== undefined) response.duplicate = transaction.duplicate;
      if (transaction.completion) response.completion = transaction.completion;
      if (transaction.nextSession) response.nextSession = transaction.nextSession;
      if (transaction.reason === 'previous-session-completed') {
        response.settledAt = transaction.sessionAt;
      }
      if (transaction.session) {
        response.session = execution.sessionProjection.projectSession(
          transaction.session,
          transaction.sessionAt === undefined ? wallNow : transaction.sessionAt
        );
      }
      return response;
    }

    const session = transaction.state.focusSession;
    const fact = Object.freeze({
      type: 'break-session-started',
      taskId: session.taskId,
      startedAt: transaction.sessionAt,
      revision: transaction.revision,
      session,
      reward: transaction.reward,
      bond: transaction.bond,
      ticketsGranted: transaction.ticketsGranted,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    if (transaction.shouldPresent) runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return { ok: true, session: execution.sessionProjection.projectSession(session, transaction.sessionAt) };
  }

  return Object.freeze({ execute });
}

module.exports = { START_BREAK_SESSION_WRITES, createStartBreakSessionWorkflow };
