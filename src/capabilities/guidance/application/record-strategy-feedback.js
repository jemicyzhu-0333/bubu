'use strict';

const strategyFeedback = require('../domain/strategy-feedback');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const RECORD_STRATEGY_FEEDBACK_WRITES = Object.freeze(['strategyFeedback']);

function createRecordStrategyFeedbackCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-strategy-feedback command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-strategy-feedback command requires a clock');
  }

  function execute({ strategyId, helpful, expectedRevision } = {}) {
    const recordedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_STRATEGY_FEEDBACK_WRITES,
      expectedRevision,
      context: { now: recordedAt },
      transition: state => {
        if (!strategyFeedback.isValidStrategyId(strategyId)
            || typeof helpful !== 'boolean'
            || !Number.isFinite(recordedAt) || recordedAt < 0) {
          return { ok: false, reason: 'strategy-invalid' };
        }
        state.strategyFeedback = strategyFeedback.recordStrategyFeedback(
          state.strategyFeedback,
          strategyId,
          helpful,
          recordedAt
        );
        return { ok: true };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'strategy-feedback-recorded',
        strategyId,
        helpful,
        recordedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = { RECORD_STRATEGY_FEEDBACK_WRITES, createRecordStrategyFeedbackCommand };
