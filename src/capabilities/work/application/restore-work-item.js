'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { restoreTask } = require('../domain/task-restoration');

const RESTORE_WORK_ITEM_WRITES = Object.freeze(['tasks', 'archivedTasks']);

function createRestoreWorkItemCommand({
  unitOfWork,
  clock,
  renewExpiry,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('restore-work-item command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('restore-work-item command requires a clock');
  }
  if (typeof renewExpiry !== 'function') {
    throw new TypeError('restore-work-item command requires an expiry renewal policy');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('restore-work-item command effects must be functions');
  }

  function execute({ taskId, expectedRevision } = {}) {
    const restoredAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RESTORE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: restoredAt },
      transition: state => {
        const restored = restoreTask(
          state,
          { taskId, now: restoredAt },
          { renewExpiry }
        );
        return restored.ok ? { ok: true, taskId: restored.task.id } : restored;
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const task = transaction.state.tasks.find(candidate => candidate.id === transaction.taskId);
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-item-restored',
        taskId: transaction.taskId,
        restoredAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, task };
  }

  return Object.freeze({ execute });
}

module.exports = { RESTORE_WORK_ITEM_WRITES, createRestoreWorkItemCommand };
