'use strict';
const { companion, progress } = require('../../capabilities');
const { basicMealAvailability } = require('../queries/companion-feed-state');
const { autoMealCandidates, MAX_TIMESTAMP } = companion.mealRhythm;
const { serveAutomaticMeal, takeMealReminder } = companion.mealServing;
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const RESOLVE_MEAL_DECISION_WRITES = Object.freeze(['pet', 'companion', 'rewardLedger']);
function createResolveMealDecisionCommand({ unitOfWork, clock, foods, publish = () => {}, reportEffectError = () => {} }) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || !clock || typeof clock.now !== 'function'
    || !foods || typeof foods !== 'object' || Array.isArray(foods)
    || typeof publish !== 'function' || typeof reportEffectError !== 'function') throw new TypeError('meal decision ports required');
  function execute({ decisionId, advice = null, canRemind = false, hasPlan = false } = {}) {
    const now = clock.now();
    const transaction = unitOfWork.run({ writes: RESOLVE_MEAL_DECISION_WRITES, context: { now }, transition: state => {
      if (!state.settings.aiBreakdownEnabled || !state.settings.aiPetMealsEnabled) {
        const cancelled = companion.mealRhythm.cancelMealAdvice(state);
        return cancelled ? { ok: true, meal: null, reminder: null } : { ok: false, reason: 'meal-decision-expired' };
      }
      const care = state.pet.care, decision = care.decision;
      if (!decision || decision.id !== decisionId || now >= decision.expiresAt || now < care.lastObservedAt) return { ok: false, reason: 'meal-decision-expired' };
      if (care.version >= Number.MAX_SAFE_INTEGER - 1) return { ok: false, reason: 'meal-version-capacity' };
      const candidates = autoMealCandidates(state.pet, state.currentSkin);
      const basic = basicMealAvailability(state, now);
      const available = [...candidates, ...(basic.eligible ? ['basic'] : [])];
      const valid = state.settings.aiBreakdownEnabled && state.settings.aiPetMealsEnabled
        && advice && typeof advice === 'object' && !Array.isArray(advice)
        && Object.keys(advice).length === 3 && ['foodId', 'waitMinutes', 'reactionIndex'].every(key => Object.hasOwn(advice, key))
        && available.includes(advice.foodId) && [0, 5, 10].includes(advice.waitMinutes)
        && [0, 1, 2].includes(advice.reactionIndex);
      const accepted = valid ? advice : null;
      care.decision = null;
      care.version += 1;
      if (accepted?.waitMinutes > 0 && state.pet.satiation > 45) {
        if (now > MAX_TIMESTAMP - (accepted.waitMinutes + 6) * 60_000) return { ok: false, reason: 'meal-time-capacity' };
        care.nextMealAt = now + accepted.waitMinutes * 60_000;
        care.plan = { foodId: accepted.foodId, reactionIndex: accepted.reactionIndex, slot: decision.slot,
          expiresAt: care.nextMealAt + 6 * 60_000 };
        return { ok: true, meal: null, reminder: null };
      }
      const served = serveAutomaticMeal(state, { now, slot: decision.slot, foods, advice: accepted, basicAvailable: basic.eligible, dayKey: basic.dayKey });
      if (!served.ok) return served;
      if (served.meal?.foodId === 'basic') {
        const claim = progress.basicMeals.claimBasicMeal(state, { dayKey: basic.dayKey, at: now });
        if (!claim.ok) return claim;
      }
      return { ok: true, meal: served.meal, reminder: takeMealReminder(state, { canRemind, hasPlan }) };
    } });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) runPostCommitEffect(publish, { type: 'companion-meal-care', meal: transaction.meal,
      reminder: transaction.reminder, revision: transaction.revision }, reportEffectError);
    return { ok: true, meal: transaction.meal, reminder: transaction.reminder };
  }
  return Object.freeze({ execute });
}
module.exports = { RESOLVE_MEAL_DECISION_WRITES, createResolveMealDecisionCommand };
