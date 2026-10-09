'use strict';
const { cancelMealAdvice } = require('../domain/meal-rhythm');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const INVALIDATE_MEAL_CARE_WRITES = Object.freeze(['pet']);

// Runtime interruptions only revoke captured advice and the observation anchor.
// Inventory, satiation and independently reserved quotas are never refunded.
function createInvalidateMealCareCommand({ unitOfWork, publish = () => {}, reportEffectError = () => {} }) {
  if (!unitOfWork?.run) throw new TypeError('meal invalidation requires a unit of work');
  function execute({ resetObservation = false } = {}) {
    const result = unitOfWork.run({ writes: INVALIDATE_MEAL_CARE_WRITES,
      transition: state => ({ ok: true, changed: cancelMealAdvice(state, { resetObservation }) }) });
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.committed) runPostCommitEffect(publish, { type: 'companion-meal-care', revision: result.revision }, reportEffectError);
    return { ok: true, changed: result.committed };
  }
  return Object.freeze({ execute });
}
module.exports = { INVALIDATE_MEAL_CARE_WRITES, createInvalidateMealCareCommand };
