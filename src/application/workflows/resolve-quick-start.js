'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const { recordSessionGrowth } = require('./record-session-growth');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RESOLVE_QUICK_START_WRITES = Object.freeze([
  'focusSession',
  'quickStartDecision',
  'nowTaskId',
  'tasks',
  'stats',
  'rewardLedger', 'xp', 'level', 'pet', 'companion', 'unlockedSkins'
]);

function createResolveQuickStartWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  idFactory,
  renewExpiry,
  synchronize = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('resolve-quick-start workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('resolve-quick-start workflow requires wall and session clocks');
  }
  if (typeof idFactory !== 'function' || typeof renewExpiry !== 'function') {
    throw new TypeError('resolve-quick-start workflow requires identity and expiry policies');
  }
  if ([synchronize, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('resolve-quick-start workflow effects must be functions');
  }

  function execute(input = {}) {
    const { sessionId, action, landingNote = null, progressMade } = input;
    if (typeof progressMade !== 'boolean') return { ok: false, reason: 'invalid-progress-choice' };
    const resolvedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RESOLVE_QUICK_START_WRITES,
      expectedRevision: input && typeof input === 'object' ? input.expectedRevision : undefined,
      context: { now: resolvedAt },
      transition: state => {
        const resolution = execution.quickStartDecision.prepareResolution(state, {
          sessionId,
          action,
          resolvedAt
        });
        if (!resolution.ok) return resolution;

        // A requested landing note must remain lossless. Validate its target
        // before allocating a replacement session, then apply it only inside
        // the same isolated draft as the rest of the decision.
        if (landingNote) {
          const target = work.taskState.findTask(state, resolution.decision.taskId);
          const blocked = work.taskState.taskWriteBlockReason(target);
          if (blocked) return { ok: false, reason: blocked, action: resolution.action };
        }

        if (resolution.action === 'done') {
          if (landingNote) {
            const landing = work.taskClarification.applyLandingNote(state, {
              taskId: resolution.decision.taskId,
              landingNote,
              now: resolvedAt
            }, { createId: idFactory });
            if (!landing.ok) return { ...landing, action: resolution.action };
          }
          const returned = progress.executionActivity.recordExecutionReturn(state, {
            sessionId: resolution.decision.sessionId,
            checkpoint: 'landing',
            kind: execution.focusSession.STATUS.QUICK_START,
            at: resolvedAt
          });
          const applied = execution.quickStartDecision.applyResolution(state, resolution);
          if (!applied.ok) return applied;
          return {
            ok: true,
            action: resolution.action,
            taskId: resolution.decision.taskId,
            landingSaved: Boolean(landingNote),
            returnRecorded: returned.recorded,
            sessionStarted: false,
            renewed: false,
            originalSessionId: resolution.decision.sessionId,
            ...recordSessionGrowth(state, {
              sessionId: resolution.decision.sessionId, taskId: resolution.decision.taskId,
              progressMade, closing: true, now: resolvedAt, kind: 'quick-start'
            })
          };
        }

        const authorized = execution.sessionStart.authorizeStart(state, {
          quickStartDecisionSessionId: resolution.decision.sessionId
        });
        if (!authorized.ok) {
          return {
            ...authorized,
            action: resolution.action,
            session: state.focusSession
          };
        }

        const taskId = resolution.decision.taskId;
        const currentTask = work.taskState.findTask(state, taskId);
        const needsRenewal = currentTask
          && currentTask.expiresAt
          && work.availability.taskStartBlockReason(currentTask, resolvedAt) === 'task-expired';
        const entry = work.sessionEntry.prepareTask(state, {
          taskId,
          now: resolvedAt,
          renewedExpiry: needsRenewal
            ? renewExpiry(resolvedAt, state.settings)
            : undefined
        });
        if (!entry.ok) {
          return {
            ...entry,
            action: resolution.action,
            session: state.focusSession
          };
        }

        const minutes = resolution.action === 'extend-8'
          ? 8
          : execution.sessionDuration.normalizeFocusMinutes(
              state.settings && state.settings.lastChosenFocusMinutes,
              state.settings && state.settings.pomodoroMinutes
            );
        const startedAt = sessionClock.now(resolvedAt);
        const started = execution.focusSession.startFocus(state.focusSession, {
          taskId,
          minutes,
          now: startedAt,
          sessionId: idFactory('session')
        });
        if (!started.ok || started.recoveredCompletion) {
          return {
            ok: false,
            reason: started.recoveredCompletion ? 'previous-session-completed' : started.reason,
            action: resolution.action,
            session: state.focusSession,
            completion: started.recoveredCompletion || undefined
          };
        }

        if (landingNote) {
          const landing = work.taskClarification.applyLandingNote(state, {
            taskId,
            landingNote,
            now: resolvedAt
          }, { createId: idFactory });
          if (!landing.ok) return { ...landing, action: resolution.action };
        }
        execution.sessionSettlement.replaceSession(state, started.session, startedAt);
        if (taskId) state.nowTaskId = execution.nowSelection.selectTask(taskId).nowTaskId;
        const returned = progress.executionActivity.recordExecutionReturn(state, {
          sessionId: resolution.decision.sessionId,
          checkpoint: 'landing',
          kind: execution.focusSession.STATUS.QUICK_START,
          at: resolvedAt
        });
        progress.executionActivity.recordSessionLaunch(state, { at: resolvedAt });
        const applied = execution.quickStartDecision.applyResolution(state, resolution);
        if (!applied.ok) return applied;
        return {
          ok: true,
          action: resolution.action,
          taskId,
          landingSaved: Boolean(landingNote),
          returnRecorded: returned.recorded,
          sessionStarted: true,
          startedAt,
          renewed: entry.renewed,
          originalSessionId: resolution.decision.sessionId,
          ...recordSessionGrowth(state, {
            sessionId: resolution.decision.sessionId, taskId: resolution.decision.taskId,
            progressMade, closing: false, now: resolvedAt, kind: 'quick-start'
          })
        };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.action) response.action = transaction.action;
      if (transaction.session) {
        response.session = execution.sessionProjection.projectSession(
          transaction.session,
          transaction.startedAt || resolvedAt
        );
      }
      if (transaction.completion) response.completion = transaction.completion;
      return response;
    }

    const session = transaction.sessionStarted ? transaction.state.focusSession : null;
    const fact = Object.freeze({
      type: 'quick-start-resolved',
      action: transaction.action,
      sessionId: transaction.originalSessionId,
      taskId: transaction.taskId,
      resolvedAt,
      revision: transaction.revision,
      landingSaved: transaction.landingSaved,
      returnRecorded: transaction.returnRecorded,
      renewed: transaction.renewed,
      reward: transaction.reward,
      bond: transaction.bond,
      ticketsGranted: transaction.ticketsGranted,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins]),
      session
    });
    if (transaction.sessionStarted) {
      runPostCommitEffect(synchronize, fact, reportEffectError);
    }
    runPostCommitEffect(publish, fact, reportEffectError);

    const response = { ok: true, action: transaction.action };
    if (session) {
      response.session = execution.sessionProjection.projectSession(session, transaction.startedAt);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RESOLVE_QUICK_START_WRITES, createResolveQuickStartWorkflow };
