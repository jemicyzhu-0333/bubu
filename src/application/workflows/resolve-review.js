'use strict';

const execution = require('../../capabilities/execution');
const guidance = require('../../capabilities/guidance');
const work = require('../../capabilities/work');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RESOLVE_REVIEW_WRITES = Object.freeze(['reviews', 'tasks', 'nowTaskId']);

function createResolveReviewWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('resolve-review workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('resolve-review workflow requires a clock');
  }

  function execute({ id, action, progress, confirmedTaskIds = [], expectedRevision } = {}) {
    const resolvedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RESOLVE_REVIEW_WRITES,
      expectedRevision,
      context: { now: resolvedAt },
      transition: state => {
        const result = guidance.dailyReview.resolveReview(state, {
          id, action, progress, confirmedTaskIds, now: resolvedAt
        });
        if (!result.ok) return result;
        let updatedTasks = [];
        if (result.updatedTasks.length) {
          const planned = work.taskPlanning.confirmPlannedTasks(state, {
            taskIds: result.updatedTasks,
            dayKey: result.card.dayKey,
            now: resolvedAt
          });
          if (!planned.ok) return planned;
          updatedTasks = planned.updatedTasks;
          // 今天的启动：确认的第一件直接成为“现在”，不必再去任务页找。
          if (result.card.kind === 'startup' && action === 'done' && updatedTasks.length) {
            const first = result.updatedTasks.find(taskId => updatedTasks.includes(taskId));
            const selection = execution.nowSelection.selectTask(first);
            if (selection.ok) state.nowTaskId = selection.nowTaskId;
          }
        }
        return { ok: true, card: result.card, updatedTasks };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const updatedTasks = transaction.updatedTasks || [];
    const response = { ok: true, card: transaction.card };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'review-resolved',
        id,
        action,
        updatedTasks,
        resolvedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RESOLVE_REVIEW_WRITES, createResolveReviewWorkflow };
