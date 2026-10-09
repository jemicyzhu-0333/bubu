'use strict';
const { compareDayKeys } = require('../../../core/calendar');
const { favoriteFood } = require('../../../content/food-progression.mjs');

const MEALS = Object.freeze(['breakfast', 'lunch', 'dinner']);
const DEFAULT_MEAL_MINUTES = Object.freeze([540, 750, 1140]);
const MEAL_SETTING_KEYS = Object.freeze(['aiBreakdownEnabled', 'aiPetMealsEnabled', 'aiBaseUrl', 'aiModel', 'petEnabled']);
const SAMPLE_MS = 5 * 60_000;
const AUTO_FEED_INTERVAL_MS = 60 * 60_000;
const MAX_TIMESTAMP = 8.64e15;
const isTimestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;
function defaultMealCare() {
  return { version: 0, lastObservedAt: null, workTotalMs: 0, mealDay: null, meals: [], autoFeeds: 0,
    lastMealAt: null, lastReminderDay: null, reminderPending: false, nextMealAt: null, aiDay: null, aiCalls: 0, decision: null, plan: null };
}
function normalizeDecision(value) {
  if (!value || typeof value !== 'object' || !isTimestamp(value.expiresAt)
      || typeof value.id !== 'string' || !/^\d+:\d+$/.test(value.id) || value.id.length > 40
      || (value.slot !== null && !MEALS.includes(value.slot))) return null;
  return { id: value.id, expiresAt: value.expiresAt, slot: value.slot };
}
function normalizePlan(value) {
  if (!value || typeof value !== 'object' || !isTimestamp(value.expiresAt)
      || !['basic', 'rice', 'milk', 'carrot', 'berry', 'fish', 'bone'].includes(value.foodId)
      || ![0, 1, 2].includes(value.reactionIndex) || (value.slot !== null && !MEALS.includes(value.slot))) return null;
  return { foodId: value.foodId, reactionIndex: value.reactionIndex, expiresAt: value.expiresAt, slot: value.slot };
}
function normalizeMealCare(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const integer = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  const timestamp = value => isTimestamp(value) ? value : null;
  const day = value => { try { compareDayKeys(value, value); return value; } catch (_) { return null; } };
  return { version: integer(source.version), lastObservedAt: timestamp(source.lastObservedAt),
    workTotalMs: integer(source.workTotalMs), mealDay: day(source.mealDay),
    meals: MEALS.filter(id => Array.isArray(source.meals) && source.meals.includes(id)),
    autoFeeds: Math.min(6, integer(source.autoFeeds)), lastMealAt: timestamp(source.lastMealAt),
    lastReminderDay: day(source.lastReminderDay), reminderPending: source.reminderPending === true,
    nextMealAt: timestamp(source.nextMealAt), aiDay: day(source.aiDay), aiCalls: Math.min(3, integer(source.aiCalls)), decision: normalizeDecision(source.decision), plan: normalizePlan(source.plan) };
}
function effectiveMealDay(raw, dayKey) {
  compareDayKeys(dayKey, dayKey);
  const previous = normalizeMealCare(raw).mealDay;
  return previous && previous > dayKey ? previous : dayKey;
}
function advanceMealDay(care, dayKey) {
  compareDayKeys(dayKey, dayKey);
  if (care.mealDay === null || dayKey > care.mealDay) {
    care.mealDay = dayKey; care.meals = []; care.autoFeeds = 0; care.reminderPending = false;
  }
  return care;
}
function cancelMealAdvice(state, { resetObservation = false } = {}) {
  const raw = state.pet?.care;
  if (!raw || (!raw.decision && !raw.plan && raw.nextMealAt == null
    && (!resetObservation || raw.lastObservedAt === null))) return false;
  const care = normalizeMealCare(raw);
  care.decision = null; care.plan = null; care.nextMealAt = null;
  if (resetObservation) care.lastObservedAt = null;
  care.version = Math.min(Number.MAX_SAFE_INTEGER, care.version + 1);
  state.pet = { ...state.pet, care };
  return true;
}
function sampleMealRhythm(pet, { now, dayKey, minuteOfDay, workTotalMs, mealMinutes = DEFAULT_MEAL_MINUTES }) {
  compareDayKeys(dayKey, dayKey);
  if (!isTimestamp(now) || !Number.isFinite(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440
    || !Number.isSafeInteger(workTotalMs) || workTotalMs < 0 || !Array.isArray(mealMinutes) || mealMinutes.length !== 3
    || mealMinutes.some(minute => !Number.isInteger(minute) || minute < 0 || minute >= 1440)) throw new TypeError('invalid-meal-sample');
  const care = normalizeMealCare(pet.care);
  if (care.lastObservedAt !== null && now <= care.lastObservedAt) return { changed: false, eligible: false, care, satiation: pet.satiation };
  const elapsed = care.lastObservedAt === null ? 0 : now - care.lastObservedAt;
  const continuous = elapsed > 0 && elapsed <= SAMPLE_MS + 60_000;
  if (!continuous || (care.plan && now > care.plan.expiresAt)) { care.plan = null; care.nextMealAt = null; }
  if (care.decision && now >= care.decision.expiresAt) care.decision = null;
  const activeMinutes = continuous ? elapsed / 60_000 : 0;
  const workMinutes = continuous ? Math.min(elapsed, Math.max(0, workTotalMs - care.workTotalMs)) / 60_000 : 0;
  advanceMealDay(care, dayKey);
  const slotIndex = mealMinutes.findIndex(minute => minuteOfDay >= minute && minuteOfDay < minute + 90);
  const slot = slotIndex < 0 ? null : MEALS[slotIndex];
  const appetite = activeMinutes * (slot ? .12 : .025) + workMinutes / 15;
  const satiation = Math.max(25, Math.min(100, Math.round(((Number.isFinite(pet.satiation) ? pet.satiation : 65) - appetite) * 1000) / 1000));
  care.lastObservedAt = now;
  care.workTotalMs = Math.max(care.workTotalMs, workTotalMs);
  const dueMeal = (slot !== null && !care.meals.includes(slot) && satiation <= 75) || (care.plan !== null && now >= care.nextMealAt);
  const hungry = satiation <= 45;
  const cooldownReady = care.lastMealAt === null || now - care.lastMealAt >= AUTO_FEED_INTERVAL_MS;
  const waiting = !hungry && care.nextMealAt !== null && now < care.nextMealAt;
  return { changed: true, care, satiation, slot, eligible: !care.decision && !waiting && cooldownReady && care.autoFeeds < 6 && (dueMeal || hungry) };
}
function autoMealCandidates(pet, skin) {
  // Special treats remain available for an intentional shared feeding.
  const ordinary = ['rice', 'milk', 'carrot', 'berry', 'fish', 'bone'];
  const preferred = favoriteFood(skin);
  return [...new Set([preferred, ...ordinary])].filter(id => ordinary.includes(id)
    && Number.isSafeInteger(pet.foodInventory?.[id]) && pet.foodInventory[id] > 0);
}
function chooseAutoMeal(pet, skin, proposedId = null, basicAvailable = false) {
  const candidates = [...autoMealCandidates(pet, skin), ...(basicAvailable ? ['basic'] : [])];
  return candidates.includes(proposedId) ? proposedId : candidates[0] || null;
}
module.exports = { MEAL_SETTING_KEYS, MEALS, DEFAULT_MEAL_MINUTES, SAMPLE_MS, AUTO_FEED_INTERVAL_MS,
  MAX_TIMESTAMP, defaultMealCare, normalizeMealCare, effectiveMealDay, advanceMealDay, cancelMealAdvice, sampleMealRhythm, autoMealCandidates, chooseAutoMeal };
