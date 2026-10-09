'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { recordSessionGrowth } = require('./record-session-growth');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RESOLVE_FOCUS_LANDING_WRITES = Object.freeze([
  'tasks', 'focusLandingPrompt', 'xp', 'level', 'rewardLedger', 'pet', 'companion', 'unlockedSkins'
]);

function createResolveFocusLandingWorkflow({
  unitOfWork,
  clock,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('resolve-focus-landing workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('resolve-focus-landing workflow requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('resolve-focus-landing workflow requires an id factory');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('resolve-focus-landing workflow effects must be functions');
  }

  function execute({ sessionId, action, landingNote, progressMade, expectedRevision } = {}) {
    if (typeof progressMade !== 'boolean') return { ok: false, reason: 'invalid-progress-choice' };
    const resolvedAt = clock.now();
    if (!Number.isFinite(resolvedAt) || resolvedAt < 0 || resolvedAt > 8.64e15) {
      throw new TypeError('resolve-focus-landing workflow requires a valid clock value');
    }
    const transaction = unitOfWork.run({
      writes: RESOLVE_FOCUS_LANDING_WRITES,
      expectedRevision,
      context: { now: resolvedAt },
      transition: state => {
        const resolution = execution.focusLanding.resolvePrompt(state, { sessionId, action });
        if (!resolution.ok) return resolution;

        if (resolution.action === 'save') {
          const landing = work.taskClarification.applyLandingNote(state, {
            taskId: resolution.prompt.taskId,
            landingNote,
            now: resolvedAt
          }, { createId: idFactory });
          if (!landing.ok) return landing;
        }
        return {
          ok: true,
          action: resolution.action,
          sessionId: resolution.prompt.sessionId,
          taskId: resolution.prompt.taskId,
          ...recordSessionGrowth(state, {
            sessionId: resolution.prompt.sessionId, taskId: resolution.prompt.taskId,
            progressMade, closing: true, now: resolvedAt, kind: 'focus'
          })
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = { ok: true, action: transaction.action };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'focus-landing-resolved',
      sessionId: transaction.sessionId,
      taskId: transaction.taskId,
      action: transaction.action,
      resolvedAt,
      revision: transaction.revision,
      reward: transaction.reward,
      bond: transaction.bond,
      ticketsGranted: transaction.ticketsGranted,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RESOLVE_FOCUS_LANDING_WRITES, createResolveFocusLandingWorkflow };
