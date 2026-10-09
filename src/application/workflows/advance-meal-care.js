'use strict';
const { companion, progress } = require('../../capabilities');
const { basicMealAvailability } = require('../queries/companion-feed-state');
const { sampleMealRhythm, normalizeMealCare, autoMealCandidates, MAX_TIMESTAMP } = companion.mealRhythm;
const { serveAutomaticMeal, takeMealReminder } = companion.mealServing;
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { favoriteFood } = require('../../content/food-progression.mjs');
const ADVANCE_MEAL_CARE_WRITES = Object.freeze(['pet', 'companion', 'rewardLedger']);
function createAdvanceMealCareCommand({ unitOfWork, clock, calendar, foods, publish = () => {}, reportEffectError = () => {} }) {
  if (!unitOfWork?.run || !clock?.now || typeof calendar !== 'function' || !foods) throw new TypeError('meal care ports required');
  function execute({ workTotalMs = 0, mealMinutes, canRemind = false, hasPlan = false, expectedCareVersion, aiAvailable = false } = {}) {
    const now = clock.now(), date = calendar(now);
    const transaction = unitOfWork.run({ writes: ADVANCE_MEAL_CARE_WRITES, context: { now }, transition: state => {
      const previous = normalizeMealCare(state.pet.care);
      if (expectedCareVersion !== undefined && expectedCareVersion !== previous.version) return { ok: false, reason: 'meal-care-changed' };
      const cancelled = (!state.settings.aiBreakdownEnabled || !state.settings.aiPetMealsEnabled)
        && companion.mealRhythm.cancelMealAdvice(state);
      const sample = sampleMealRhythm(state.pet, { now, ...date, workTotalMs, mealMinutes });
      if (!sample.changed) return { ok: true, meal: null, reminder: null, intent: null };
      if (state.pet.care.version >= Number.MAX_SAFE_INTEGER - 1) {
        return cancelled ? { ok: true, meal: null, reminder: null, intent: null }
          : { ok: false, reason: 'meal-version-capacity' };
      }
      state.pet = { ...state.pet, satiation: sample.satiation, care: { ...sample.care, version: state.pet.care.version + 1 } };
      const candidates = autoMealCandidates(state.pet, state.currentSkin);
      const basic = basicMealAvailability(state, now);
      const available = [...candidates, ...(basic.eligible ? ['basic'] : [])];
      if (candidates.length) state.pet.care.reminderPending = false;
      const care = state.pet.care;
      if (care.plan && !available.includes(care.plan.foodId)) { care.plan = null; care.nextMealAt = null; }
      let meal = null, intent = null;
      if (sample.eligible && available.length) {
        if (care.aiDay === null || date.dayKey > care.aiDay) { care.aiDay = date.dayKey; care.aiCalls = 0; }
        if (!care.plan && aiAvailable && state.settings.aiBreakdownEnabled && state.settings.aiPetMealsEnabled && care.aiCalls < 3) {
          if (now > MAX_TIMESTAMP - 30_000) return { ok: false, reason: 'meal-time-capacity' };
          care.aiCalls += 1;
          care.decision = { id: `${now}:${care.version}`, expiresAt: now + 30_000, slot: sample.slot };
          intent = { ...care.decision, payload: { character: typeof state.currentSkin === 'string' && state.currentSkin.startsWith('usagi') ? 'usagi' : 'dango',
            satiation: state.pet.satiation, meal: sample.slot || 'snack', foods: available,
            favorite: available.includes(favoriteFood(state.currentSkin)) ? favoriteFood(state.currentSkin) : null } };
        } else {
          const served = serveAutomaticMeal(state, { now, slot: care.plan?.slot || sample.slot, foods, advice: care.plan, basicAvailable: basic.eligible, dayKey: basic.dayKey });
          if (!served.ok) return served;
          meal = served.meal;
          if (meal?.foodId === 'basic') {
            const claim = progress.basicMeals.claimBasicMeal(state, { dayKey: basic.dayKey, at: now });
            if (!claim.ok) return claim;
          }
        }
      }
      return { ok: true, meal, intent, reminder: takeMealReminder(state, { canRemind, hasPlan }) };
    } });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) runPostCommitEffect(publish, { type: 'companion-meal-care',
      meal: transaction.meal, reminder: transaction.reminder, revision: transaction.revision }, reportEffectError);
    return { ok: true, changed: transaction.committed, meal: transaction.meal, reminder: transaction.reminder, intent: transaction.intent };
  }
  return Object.freeze({ execute });
}
module.exports = { ADVANCE_MEAL_CARE_WRITES, createAdvanceMealCareCommand };
