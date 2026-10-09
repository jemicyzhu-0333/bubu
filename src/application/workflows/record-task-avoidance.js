'use strict';

const work = require('../../capabilities/work');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const RECORD_TASK_AVOIDANCE_WRITES = Object.freeze(['tasks']);

function createRecordTaskAvoidanceWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-task-avoidance workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-task-avoidance workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('record-task-avoidance workflow effects must be functions');
  }

  function execute({ taskId, expectedRevision } = {}) {
    const avoidedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_TASK_AVOIDANCE_WRITES,
      expectedRevision,
      context: { now: avoidedAt },
      transition: state => work.taskAvoidance.recordTaskAvoidance(state, {
        taskId,
        now: avoidedAt
      })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = {
      ok: true,
      taskId: transaction.taskId,
      avoidanceCount: transaction.avoidanceCount,
      changed: transaction.committed
    };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'task-avoidance-recorded',
        taskId: transaction.taskId,
        avoidanceCount: transaction.avoidanceCount,
        avoidedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { RECORD_TASK_AVOIDANCE_WRITES, createRecordTaskAvoidanceWorkflow };
