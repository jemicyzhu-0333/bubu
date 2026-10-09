'use strict';
const { foodRitual } = require('../../../content/food-rituals.mjs');
const { autoMealCandidates, chooseAutoMeal, AUTO_FEED_INTERVAL_MS } = require('./meal-rhythm');
const { prepareFeed } = require('./feeding');
const { applyBondToState } = require('./completion-benefits');
function serveAutomaticMeal(state, { now, slot, foods, advice = null, basicAvailable = false, dayKey }) {
  if (state.pet.care.autoFeeds >= 6 || (state.pet.care.lastMealAt !== null
    && now - state.pet.care.lastMealAt < AUTO_FEED_INTERVAL_MS)) {
    return { ok: true, meal: null };
  }
  const empty = autoMealCandidates(state.pet, state.currentSkin).length === 0;
  const foodId = chooseAutoMeal(state.pet, state.currentSkin, advice?.foodId, basicAvailable);
  if (!foodId) {
    state.pet.care.plan = null;
    state.pet.care.nextMealAt = null;
    return { ok: true, meal: null };
  }
  const result = prepareFeed(state, { foodId, food: foods[foodId], now, dayKey, automatic: true });
  if (!result.ok) return result;
  const care = state.pet.care;
  care.autoFeeds += 1;
  if (slot && !care.meals.includes(slot)) care.meals.push(slot);
  if (empty && care.lastReminderDay !== care.mealDay) care.reminderPending = true;
  if (foodId !== 'basic') applyBondToState(state, { points: 0, counterId: 'self-meal', foodId, at: now });
  const ritual = foodRitual(foodId);
  const line = foodId === advice?.foodId && [0, 1, 2].includes(advice?.reactionIndex)
    ? advice.reactionIndex : care.autoFeeds % ritual.lines.length;
  return { ok: true, meal: { foodId, automatic: true, favorite: result.favorite, satiation: result.satiation,
    animation: result.favorite ? 'favorite' : foods[foodId].animation,
    reaction: result.favorite ? ritual.favoriteLine : ritual.lines[line] } };
}
function takeMealReminder(state, { canRemind, hasPlan }) {
  const care = state.pet.care;
  if (!canRemind || !care.reminderPending || care.lastReminderDay === care.mealDay) return null;
  care.lastReminderDay = care.mealDay;
  care.reminderPending = false;
  return hasPlan ? '我先吃基础餐啦，忙完有空换点零食一起吃吧'
    : '我先吃基础餐啦。今天的计划想好了吗？有空换点零食一起吃';
}
module.exports = { serveAutomaticMeal, takeMealReminder };
