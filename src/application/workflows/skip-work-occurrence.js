'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const SKIP_WORK_OCCURRENCE_WRITES = Object.freeze([
  'tasks',
  'recurrenceSeries',
  'nowTaskId',
]);

function createSkipWorkOccurrenceWorkflow({
  unitOfWork,
  clock,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('skip-work-occurrence workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('skip-work-occurrence workflow requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('skip-work-occurrence workflow requires an id factory');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('skip-work-occurrence workflow effects must be functions');
  }

  function execute({ taskId, expectedRevision } = {}) {
    const skippedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: SKIP_WORK_OCCURRENCE_WRITES,
      expectedRevision,
      context: { now: skippedAt },
      transition: state => {
        const executionBlock = execution.taskLinkage.taskExecutionBlockReason(state, taskId);
        if (executionBlock) return { ok: false, reason: executionBlock };

        const skipped = work.occurrenceSkipping.skipOccurrence(state, {
          taskId,
          now: skippedAt,
          referenceDay: progress.progressState.monotonicRewardDay(state, skippedAt)
        }, { createId: idFactory });
        if (!skipped.ok) return skipped;

        execution.taskLinkage.clearNowTask(state, skipped.task.id);
        return {
          ok: true,
          nextOccurrenceDate: skipped.nextOccurrence
            ? skipped.nextOccurrence.occurrence.occurrenceDate
            : null
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = { ok: true, nextOccurrenceDate: transaction.nextOccurrenceDate };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'work-occurrence-skipped',
      taskId,
      skippedAt,
      revision: transaction.revision,
      nextOccurrenceDate: transaction.nextOccurrenceDate
    });
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { SKIP_WORK_OCCURRENCE_WRITES, createSkipWorkOccurrenceWorkflow };
