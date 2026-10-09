'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const UPDATE_WORK_ITEM_WRITES = Object.freeze(['tasks', 'recurrenceSeries', 'nowTaskId']);

function createUpdateWorkItemWorkflow({
  unitOfWork,
  clock,
  idFactory,
  inferEnergy,
  suggestDuration,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('update-work-item workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('update-work-item workflow requires a clock');
  }
  if (typeof idFactory !== 'function'
      || typeof inferEnergy !== 'function'
      || typeof suggestDuration !== 'function') {
    throw new TypeError('update-work-item workflow requires task policy ports');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('update-work-item workflow effects must be functions');
  }

  function execute({ taskId, patch, scope, expectedRevision } = {}) {
    const updatedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: UPDATE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: updatedAt },
      transition: state => {
        const updated = work.taskEditing.updateTaskGuarded(state, {
          taskId,
          patch,
          scope,
          now: updatedAt
        }, { createId: idFactory, inferEnergy, suggestDuration, focusPolicy: execution.focusSession });
        if (!updated.ok) return updated;

        if (state.nowTaskId === updated.task.id
            && work.availability.taskStartBlockReason(updated.task, updatedAt) !== null) {
          execution.taskLinkage.clearNowTask(state, updated.task.id);
        }
        return { ok: true, taskId: updated.task.id, scope: updated.scope };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason, task: null };
    const task = transaction.state.tasks.find(candidate => candidate.id === transaction.taskId);
    const response = { ok: true, task, scope: transaction.scope };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'work-item-updated',
      taskId: transaction.taskId,
      updatedAt,
      revision: transaction.revision,
      scope: transaction.scope
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { UPDATE_WORK_ITEM_WRITES, createUpdateWorkItemWorkflow };
