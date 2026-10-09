'use strict';

const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const { projectSessionResumeAction } = require('../queries/session-resume-action');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RESUME_FOCUS_SESSION_WRITES = Object.freeze([
  'focusSession',
  'stats',
  'rewardLedger'
]);

function createResumeFocusSessionWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  present = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('resume-focus-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('resume-focus-session workflow requires wall and session clocks');
  }
  if ([synchronize, present, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('resume-focus-session workflow effects must be functions');
  }

  function execute({ sessionId, intent, expectedRevision } = {}) {
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: RESUME_FOCUS_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const action = projectSessionResumeAction({ session: state.focusSession, tasks: state.tasks, now: wallNow });
        if (!action) return { ok: false, reason: 'not-paused' };
        if (action.sessionId !== sessionId) return { ok: false, reason: 'session-changed' };
        if (action.intent !== intent) return { ok: false, reason: 'resume-intent-mismatch' };
        if (!action.enabled) return { ok: false, reason: action.reason };
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const returnOrdinal = Array.isArray(state.focusSession.activeSegments)
          ? state.focusSession.activeSegments.length
          : 0;
        const resumed = execution.focusSession.resumeSession(state.focusSession, sessionAt);
        if (!resumed.ok) return { ...resumed, sessionAt };
        if (resumed.completion) {
          return {
            ok: false,
            reason: 'session-completed',
            completion: resumed.completion,
            nextSession: resumed.session,
            session: resumed.session,
            sessionAt
          };
        }

        execution.sessionSettlement.replaceSession(state, resumed.session, sessionAt);
        const returned = progress.executionActivity.recordExecutionReturn(state, {
          sessionId: resumed.session.sessionId,
          checkpoint: `resume-${returnOrdinal}`,
          kind: resumed.session.status,
          at: sessionAt
        });
        return {
          ok: true,
          kind: resumed.session.status,
          returnRecorded: returned.recorded,
          sessionAt
        };
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
        response.session = execution.sessionProjection.projectSession(
          transaction.session,
          transaction.sessionAt === undefined ? wallNow : transaction.sessionAt
        );
      }
      return response;
    }

    const session = transaction.state.focusSession;
    const fact = Object.freeze({
      type: 'session-resumed',
      kind: transaction.kind,
      resumedAt: transaction.sessionAt,
      returnRecorded: transaction.returnRecorded,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return {
      ok: true,
      session: execution.sessionProjection.projectSession(session, transaction.sessionAt)
    };
  }

  return Object.freeze({ execute });
}

module.exports = { RESUME_FOCUS_SESSION_WRITES, createResumeFocusSessionWorkflow };
