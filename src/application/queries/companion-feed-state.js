'use strict';

const { companion, progress } = require('../../capabilities');
const { localDayKey } = require('../../core/calendar');
const { BASIC_MEAL } = require('../../content/growth-policy.mjs');

function basicMealAvailability(state, now) {
  const dayKey = companion.mealRhythm.effectiveMealDay(state.pet?.care, localDayKey(now));
  const allowance = progress.basicMeals.basicMealAllowance(state.rewardLedger, dayKey);
  const satiation = Number.isFinite(state.pet?.satiation) ? state.pet.satiation : 65;
  const reason = allowance.remaining === 0 ? 'basic-meal-limit'
    : satiation > BASIC_MEAL.hungryAt ? 'basic-meal-not-needed' : null;
  return Object.freeze({ dayKey, limit: allowance.limit, remaining: allowance.remaining,
    eligible: !reason, reason });
}
function projectCompanionFeedState(state, now) {
  return { satiation: state.pet.satiation, foodInventory: { ...state.pet.foodInventory },
    foodTickets: state.pet.foodTickets,
    totalFeeds: state.pet.totalFeeds, basicMeal: basicMealAvailability(state, now) };
}
module.exports = { basicMealAvailability, projectCompanionFeedState };
