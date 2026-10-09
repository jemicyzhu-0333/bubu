'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const EXPIRE_WORK_ITEMS_WRITES = Object.freeze(['tasks', 'nowTaskId']);

function createExpireWorkItemsWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('expire-work-items workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('expire-work-items workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('expire-work-items workflow effects must be functions');
  }

  function execute({ notify = true, expectedRevision } = {}) {
    const expiredAt = clock.now();
    const transaction = unitOfWork.run({
      writes: EXPIRE_WORK_ITEMS_WRITES,
      expectedRevision,
      context: { now: expiredAt },
      transition: state => {
        const expiration = work.taskExpiration.expireDueTasks(state, expiredAt);
        const currentNowTaskId = state.nowTaskId;
        const nowTask = work.taskState.findTask(state, currentNowTaskId);
        const blocked = currentNowTaskId
          ? work.availability.taskStartBlockReason(nowTask, expiredAt)
          : null;
        if (blocked) execution.taskLinkage.clearNowTask(state, currentNowTaskId);
        return {
          ok: true,
          expiredTaskIds: expiration.expiredTaskIds,
          clearedNowTaskId: blocked ? currentNowTaskId : null
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-items-expired',
        expiredTaskIds: Object.freeze([...transaction.expiredTaskIds]),
        clearedNowTaskId: transaction.clearedNowTaskId,
        expiredAt,
        notificationRequested: notify !== false,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, expiredCount: transaction.expiredTaskIds.length };
  }

  return Object.freeze({ execute });
}

module.exports = { EXPIRE_WORK_ITEMS_WRITES, createExpireWorkItemsWorkflow };
