'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { duplicateTask } = require('../domain/task-duplication');

const DUPLICATE_WORK_ITEM_WRITES = Object.freeze(['tasks']);

function createDuplicateWorkItemCommand({
  unitOfWork,
  clock,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('duplicate-work-item command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('duplicate-work-item command requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('duplicate-work-item command requires an id factory');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('duplicate-work-item command effects must be functions');
  }

  function execute({ taskId, expectedRevision } = {}) {
    const duplicatedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: DUPLICATE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: duplicatedAt },
      transition: state => {
        const duplicated = duplicateTask(
          state,
          { taskId, now: duplicatedAt },
          { createId: idFactory }
        );
        return duplicated.ok
          ? { ok: true, taskId: duplicated.task.id, sourceTaskId: taskId }
          : duplicated;
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const task = transaction.state.tasks.find(candidate => candidate.id === transaction.taskId);
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-item-duplicated',
        taskId: transaction.taskId,
        sourceTaskId: transaction.sourceTaskId,
        duplicatedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, task };
  }

  return Object.freeze({ execute });
}

module.exports = { DUPLICATE_WORK_ITEM_WRITES, createDuplicateWorkItemCommand };
