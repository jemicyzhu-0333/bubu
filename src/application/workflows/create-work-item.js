'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const CREATE_WORK_ITEM_WRITES = Object.freeze([
  'tasks',
  'recurrenceSeries',
  'nowTaskId',
  'stats'
]);

function createWorkItemDraft(state, {
  task,
  createdAt,
  breakdown = false,
  selectAsNow = true
} = {}, {
  idFactory,
  inferEnergy,
  suggestDuration
} = {}) {
  const created = work.taskCreation.createTask(state, task, {
    now: createdAt,
    createId: idFactory,
    inferEnergy,
    suggestDuration
  });
  if (!created.ok) return created;

  let selectedAsNow = false;
  if (selectAsNow && !state.nowTaskId
      && work.availability.taskStartBlockReason(created.task, createdAt) === null) {
    const selection = execution.nowSelection.selectTask(created.task.id);
    if (!selection.ok) return selection;
    state.nowTaskId = selection.nowTaskId;
    selectedAsNow = true;
  }
  if (breakdown) progress.progressState.recordTaskBreakdown(state);
  return { ...created, selectedAsNow };
}

function createWorkItemWorkflow({
  unitOfWork,
  clock,
  idFactory,
  inferEnergy,
  suggestDuration,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('create-work-item workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('create-work-item workflow requires a clock');
  }
  if (typeof idFactory !== 'function'
      || typeof inferEnergy !== 'function'
      || typeof suggestDuration !== 'function') {
    throw new TypeError('create-work-item workflow requires task policy ports');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('create-work-item workflow effects must be functions');
  }

  function execute({
    task,
    breakdown = false,
    selectAsNow = true,
    expectedRevision
  } = {}) {
    const createdAt = clock.now();
    const transaction = unitOfWork.run({
      writes: CREATE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: createdAt },
      transition: state => {
        const created = createWorkItemDraft(state, {
          task,
          createdAt,
          breakdown: breakdown === true,
          selectAsNow: selectAsNow !== false
        }, { idFactory, inferEnergy, suggestDuration });
        return created.ok
          ? {
            ok: true,
            taskId: created.task.id,
            seriesId: created.series ? created.series.id : null,
            selectedAsNow: created.selectedAsNow
          }
          : created;
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const taskResult = transaction.state.tasks.find(candidate => candidate.id === transaction.taskId);
    const series = transaction.seriesId
      ? transaction.state.recurrenceSeries.find(candidate => candidate.id === transaction.seriesId)
      : null;
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-item-created',
        taskId: transaction.taskId,
        seriesId: transaction.seriesId,
        createdAt,
        breakdown: breakdown === true,
        selectedAsNow: transaction.selectedAsNow,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, task: taskResult, series };
  }

  return Object.freeze({ execute });
}

module.exports = {
  CREATE_WORK_ITEM_WRITES,
  createWorkItemDraft,
  createWorkItemWorkflow
};
