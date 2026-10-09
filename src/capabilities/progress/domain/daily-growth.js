'use strict';

const { createRewardEvent, recordReward, makeRewardEventId } = require('../../../core/reward-ledger');
const { GROWTH } = require('../../../content/growth-policy.mjs');

// Source facts and daily entitlements use separate durable identities. A task
// completed after its step retains the fact without paying for that task twice.
function recordDailyGrowth(ledger, {
  eventId, source, dateKey, at, taskId = null, advance = false, close = false, metadata = {}
}) {
  const record = (id, kind, amount, bucket = kind, cap) => {
    const event = createRewardEvent({
      eventId: id, source: kind, baseReward: amount, dateKey, createdAt: at, bucket, metadata
    }, { now: at });
    const result = recordReward(ledger, event, { dailyCap: cap, maxEvents: 5000 });
    ledger = result.ledger;
    return result;
  };
  const fact = record(eventId, source, 0);
  if (!fact.recorded) {
    return { ...fact, advanceGranted: false, firstAdvance: false, closeGranted: false };
  }
  let unit = null;
  let first = null;
  let closing = null;
  if (advance) {
    const identity = taskId === null ? 'free' : `task:${taskId}`;
    unit = record(makeRewardEventId('growth-unit', identity, dateKey), 'growth-unit',
      GROWTH.unit, 'growth-unit', GROWTH.unit * GROWTH.unitsPerDay);
    if (unit.awardedReward > 0) {
      first = record(makeRewardEventId('growth-first', 'profile', dateKey),
        'growth-first', GROWTH.firstAdvance, 'growth-first', GROWTH.firstAdvance);
    }
  }
  if (close) {
    closing = record(makeRewardEventId('growth-close', 'profile', dateKey),
      'growth-close', GROWTH.close, 'growth-close', GROWTH.close);
  }
  return {
    ...fact,
    ledger,
    awardedReward: (unit?.awardedReward || 0) + (first?.awardedReward || 0) + (closing?.awardedReward || 0),
    advanceGranted: (unit?.awardedReward || 0) > 0,
    firstAdvance: (first?.awardedReward || 0) > 0,
    closeGranted: (closing?.awardedReward || 0) > 0
  };
}

module.exports = { recordDailyGrowth };
