'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { projectQuickStartAction } = require('../queries/quick-start-action');

const START_FOCUS_SESSION_WRITES = Object.freeze([
  'focusSession',
  'quickStartDecision',
  'nowTaskId',
  'stats',
  'tasks'
]);

function createStartFocusSessionWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  idFactory,
  synchronize = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('start-focus-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('start-focus-session workflow requires wall and session clocks');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('start-focus-session workflow requires an id factory');
  }
  if ([synchronize, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('start-focus-session workflow effects must be functions');
  }

  function execute({ taskId = null, minutes, quick = false, nextAction, taskVersion, expectedRevision } = {}) {
    const parsed = execution.quickStartInput.readClarification({ nextAction, taskVersion });
    if (!parsed.ok || (parsed.clarification && quick !== true)) {
      return { ok: false, reason: 'invalid-quick-start-clarification' };
    }
    const clarification = parsed.clarification;
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: START_FOCUS_SESSION_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const sessionAt = sessionClock.now(state.focusSession, wallNow);
        const authorized = execution.sessionStart.authorizeStart(state);
        if (!authorized.ok) return { ...authorized, session: state.focusSession, sessionAt };

        const entry = work.sessionEntry.prepareTask(state, {
          taskId,
          now: wallNow,
          requireNextAction: quick === true && !clarification
        });
        if (!entry.ok) return { ...entry, session: state.focusSession, sessionAt };

        const action = clarification ? projectQuickStartAction({ taskId, tasks: state.tasks, startState: state, now: wallNow }) : null;
        if (clarification && action.taskVersion !== clarification.taskVersion) return { ok: false, reason: 'task-changed' };
        if (clarification && action.intent !== 'clarify-and-start') return { ok: false, reason: 'next-action-already-set' };

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

        if (clarification) {
          if (!action.enabled) return { ok: false, reason: action.reason };
          const clarified = work.taskClarification.clarifyTask(state, {
            taskId, nextAction: clarification.nextAction, blocker: entry.task.blocker, now: wallNow
          }, { createId: idFactory });
          if (!clarified.ok) return clarified;
          const ready = work.sessionEntry.prepareTask(state, { taskId, now: wallNow, requireNextAction: true });
          if (!ready.ok) return ready;
        }

        const input = { taskId: entry.task ? entry.task.id : null, now: sessionAt };
        const startOptions = { idFactory: () => idFactory('session') };
        const started = quick === true
          ? execution.focusSession.startQuickStart(state.focusSession, input, startOptions)
          : execution.focusSession.startFocus(state.focusSession, {
              ...input,
              minutes: execution.sessionDuration.normalizeFocusMinutes(
                minutes,
                state.settings && state.settings.pomodoroMinutes
              )
            }, startOptions);
        if (!started.ok) return { ...started, sessionAt };
        if (started.recoveredCompletion) {
          throw new Error('session became due after the start preflight');
        }

        execution.sessionSettlement.replaceSession(state, started.session, sessionAt);
        state.quickStartDecision = null;
        if (entry.task) {
          state.nowTaskId = execution.nowSelection.selectTask(entry.task.id).nowTaskId;
        }
        progress.executionActivity.recordSessionLaunch(state, { at: wallNow });
        return {
          ok: true,
          quick: quick === true,
          clarified: Boolean(clarification),
          taskId: input.taskId,
          sessionAt
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
      type: 'focus-session-started',
      taskId: transaction.taskId,
      quick: transaction.quick,
      clarified: transaction.clarified,
      startedAt: transaction.sessionAt,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return {
      ok: true,
      session: execution.sessionProjection.projectSession(session, transaction.sessionAt)
    };
  }

  return Object.freeze({ execute });
}

module.exports = { START_FOCUS_SESSION_WRITES, createStartFocusSessionWorkflow };
