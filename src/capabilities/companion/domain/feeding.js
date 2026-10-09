'use strict';
const { BASIC_MEAL } = require('../../../content/growth-policy.mjs');
const { normalizeMealCare, advanceMealDay } = require('./meal-rhythm');
const { favoriteFood } = require('../../../content/food-progression.mjs');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('feeding requires a finite non-negative time');
  }
  return value;
}

function prepareFeed(state, { foodId, food, now, dayKey, automatic = false } = {}) {
  const fedAt = requireTimestamp(now);
  if (!state || !state.pet || typeof state.pet !== 'object') {
    throw new TypeError('feeding requires a canonical pet state');
  }
  if (!food || typeof food !== 'object' || food.id !== foodId) {
    return { ok: false, reason: 'unknown-food' };
  }
  const pet = state.pet;
  if (foodId === 'basic' && (Number.isFinite(pet.satiation) ? pet.satiation : 65) > BASIC_MEAL.hungryAt) {
    return { ok: false, reason: 'basic-meal-not-needed' };
  }
  const inventory = { ...(pet.foodInventory || {}) };
  if (foodId !== 'basic' && (!Number.isSafeInteger(inventory[foodId]) || inventory[foodId] <= 0)) {
    return { ok: false, reason: 'out-of-stock' };
  }

  if (foodId !== 'basic') inventory[foodId] -= 1;
  const count = pet.totalFeeds ?? 0;
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('invalid-feed-counter');
  if (!automatic && foodId !== 'basic' && count === Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'food-counter-capacity' };
  const totalFeeds = count + (automatic || foodId === 'basic' ? 0 : 1);
  const care = normalizeMealCare(pet.care);
  if (dayKey) advanceMealDay(care, dayKey);
  if (care.version >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'meal-version-capacity' };
  care.version += 1;
  care.decision = null;
  care.plan = null;
  care.nextMealAt = null;
  care.lastMealAt = Math.max(care.lastMealAt || 0, fedAt);
  const nextPet = {
    ...pet,
    satiation: Math.min(foodId === 'basic' ? BASIC_MEAL.baseline : 100, (Number.isFinite(pet.satiation) ? pet.satiation : 65) + Math.max(0, Number(food.satiation) || 0)),
    care,
    foodInventory: inventory,
    totalFeeds
  };
  state.pet = nextPet;
  return {
    ok: true,
    foodId,
    totalFeeds,
    favorite: foodId === favoriteFood(state.currentSkin),
    gainedXp: 0,
    satiation: nextPet.satiation,
  };
}

module.exports = {
  prepareFeed
};
