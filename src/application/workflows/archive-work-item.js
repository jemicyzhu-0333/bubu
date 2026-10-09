'use strict';

const work = require('../../capabilities/work');
const { redactRelatedReceipts } = require('../ai/receipt-privacy');
const execution = require('../../capabilities/execution');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const ARCHIVE_WORK_ITEM_WRITES = Object.freeze([
  'tasks',
  'archivedTasks',
  'nowTaskId',
  'aiCollaboration'
]);

function createArchiveWorkItemWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('archive-work-item workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('archive-work-item workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('archive-work-item workflow effects must be functions');
  }

  function execute({ taskId, reason = 'manual', expectedRevision } = {}) {
    const archivedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: ARCHIVE_WORK_ITEM_WRITES,
      expectedRevision,
      context: { now: archivedAt },
      transition: state => {
        const executionBlock = execution.taskLinkage.taskExecutionBlockReason(state, taskId);
        if (executionBlock) return { ok: false, reason: executionBlock };

        const archived = work.taskArchiving.archiveTask(state, { taskId, reason, now: archivedAt });
        if (!archived.ok) return archived;
        execution.taskLinkage.clearNowTask(state, archived.task.id);
        if (reason === 'manual-delete') {
          const privacy = redactRelatedReceipts(state, { sourceRefs: [{ kind: 'task', id: taskId }] });
          if (!privacy.ok) return privacy;
        }
        return { ok: true, task: archived.task };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = { ok: true };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'work-item-archived',
      taskId,
      reason: transaction.task.archiveReason,
      archivedAt,
      revision: transaction.revision
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { ARCHIVE_WORK_ITEM_WRITES, createArchiveWorkItemWorkflow };
