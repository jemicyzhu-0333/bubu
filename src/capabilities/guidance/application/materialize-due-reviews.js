'use strict';

const dailyReview = require('../domain/daily-review');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const MATERIALIZE_DUE_REVIEWS_WRITES = Object.freeze(['reviews']);

function createMaterializeDueReviewsCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('materialize-due-reviews command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('materialize-due-reviews command requires a clock');
  }

  function execute({ workStartHour = 10, workEndHour = 21, now: requestedNow, expectedRevision } = {}) {
    const now = requestedNow === undefined ? clock.now() : requestedNow;
    if (!Number.isFinite(now) || now < 0) throw new TypeError('materialize-due-reviews requires a valid time');
    const transaction = unitOfWork.run({
      writes: MATERIALIZE_DUE_REVIEWS_WRITES,
      expectedRevision,
      context: { now },
      transition: state => {
        const created = dailyReview.ensureDueReviews(state, { now, workStartHour, workEndHour });
        return { ok: true, created };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason, created: [] };
    const created = transaction.created || [];
    if (transaction.committed) {
      const fact = Object.freeze({ type: 'reviews-materialized', created, now, revision: transaction.revision });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, created, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = { MATERIALIZE_DUE_REVIEWS_WRITES, createMaterializeDueReviewsCommand };
