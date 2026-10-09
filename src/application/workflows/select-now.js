'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const SELECT_NOW_WRITES = Object.freeze(['tasks', 'nowTaskId']);

function createSelectNowWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('select-now workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('select-now workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('select-now workflow effects must be functions');
  }

  function execute({ taskId, expectedRevision } = {}) {
    const selectedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: SELECT_NOW_WRITES,
      expectedRevision,
      transition: state => {
        const taskIndex = Array.isArray(state.tasks)
          ? state.tasks.findIndex(task => task && task.id === taskId)
          : -1;
        const selection = work.selection.selectTaskForNow(
          taskIndex >= 0 ? state.tasks[taskIndex] : null,
          selectedAt
        );
        if (!selection.ok) return selection;

        const nowSelection = execution.nowSelection.selectTask(selection.task.id);
        if (!nowSelection.ok) return nowSelection;
        state.tasks[taskIndex] = selection.task;
        state.nowTaskId = nowSelection.nowTaskId;
        return { ok: true };
      },
      context: { now: selectedAt }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const task = transaction.state.tasks.find(item => item.id === taskId);
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'now-selected',
        taskId: task.id,
        selectedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, task };
  }

  return Object.freeze({ execute });
}

module.exports = { SELECT_NOW_WRITES, createSelectNowWorkflow };
