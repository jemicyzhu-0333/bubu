'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const CLARIFY_WORK_ITEM_WRITES = Object.freeze(['tasks', 'nowTaskId']);

function createClarifyWorkItemWorkflow({
  unitOfWork,
  clock,
  idFactory,
  suggestNextAction,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('clarify-work-item workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('clarify-work-item workflow requires a clock');
  }
  if (typeof idFactory !== 'function' || typeof suggestNextAction !== 'function') {
    throw new TypeError('clarify-work-item workflow requires task policy ports');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('clarify-work-item workflow effects must be functions');
  }

  function execute({ taskId, blocker, nextAction, expectedRevision } = {}) {
    const clarifiedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: CLARIFY_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: clarifiedAt },
      transition: state => {
        const task = work.taskState.findTask(state, taskId);
        const unavailable = work.availability.taskStartBlockReason(task, clarifiedAt);
        if (unavailable) return { ok: false, reason: unavailable };

        const clarified = work.taskClarification.clarifyTask(state, {
          taskId,
          blocker,
          nextAction,
          now: clarifiedAt
        }, { createId: idFactory, suggestNextAction });
        if (!clarified.ok) return clarified;

        const selection = execution.nowSelection.selectTask(clarified.task.id);
        if (!selection.ok) return selection;
        state.nowTaskId = selection.nowTaskId;
        return { ok: true, taskId: clarified.task.id };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const task = transaction.state.tasks.find(candidate => candidate.id === transaction.taskId);
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-item-clarified',
        taskId: transaction.taskId,
        clarifiedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, task };
  }

  return Object.freeze({ execute });
}

module.exports = { CLARIFY_WORK_ITEM_WRITES, createClarifyWorkItemWorkflow };
