'use strict';

const strategyFeedback = require('../domain/strategy-feedback');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const RECORD_STRATEGY_SHOWN_WRITES = Object.freeze(['strategyFeedback']);

function createRecordStrategyShownCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-strategy-shown command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-strategy-shown command requires a clock');
  }

  function execute({ strategyId, expectedRevision } = {}) {
    const shownAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_STRATEGY_SHOWN_WRITES,
      expectedRevision,
      context: { now: shownAt },
      transition: state => {
        if (!strategyFeedback.isValidStrategyId(strategyId)
            || !Number.isFinite(shownAt) || shownAt < 0) {
          return { ok: false, reason: 'strategy-invalid' };
        }
        state.strategyFeedback = strategyFeedback.recordStrategyShown(
          state.strategyFeedback,
          strategyId,
          shownAt
        );
        return { ok: true };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'strategy-shown',
        strategyId,
        shownAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = { RECORD_STRATEGY_SHOWN_WRITES, createRecordStrategyShownCommand };
