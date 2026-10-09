'use strict';

const { compareDayKeys } = require('../../../core/calendar');
const { createRewardEvent, recordReward } = require('../../../core/reward-ledger');
const { BASIC_MEAL } = require('../../../content/growth-policy.mjs');
const eventId = (dayKey, slot) => `basic-meal:${dayKey}:${slot}`;

// Daily food entitlement uses the existing durable fact identities, with zero
// reward. Display-event trimming must never replenish a consumed allowance.
function basicMealAllowance(ledger, dayKey) {
  compareDayKeys(dayKey, dayKey);
  const seen = new Set(ledger?.seenEventIds || []);
  const slots = Array.from({ length: BASIC_MEAL.dailyLimit }, (_, index) => index + 1);
  const available = slots.filter(slot => !seen.has(eventId(dayKey, slot)));
  return Object.freeze({ dayKey, limit: BASIC_MEAL.dailyLimit, used: slots.length - available.length,
    remaining: available.length, nextSlot: available[0] ?? null });
}
function claimBasicMeal(state, { dayKey, at }) {
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('invalid-basic-meal-time');
  const allowance = basicMealAllowance(state.rewardLedger, dayKey);
  if (!allowance.remaining) return { ok: false, reason: 'basic-meal-limit' };
  const result = recordReward(state.rewardLedger, createRewardEvent({ eventId: eventId(dayKey, allowance.nextSlot),
    source: 'basic-meal', baseReward: 0, dateKey: dayKey, createdAt: at }, { now: at }), { maxEvents: 5000 });
  if (!result.recorded) return { ok: false, reason: 'basic-meal-limit' };
  state.rewardLedger = result.ledger;
  return { ok: true, remaining: allowance.remaining - 1 };
}
module.exports = { basicMealAllowance, claimBasicMeal };
