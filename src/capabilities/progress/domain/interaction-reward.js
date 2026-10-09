'use strict';

const { makeRewardEventId } = require('../../../core/reward-ledger');
const { applyDomainReward } = require('./progress-state');

const INTERACTION_REWARD = Object.freeze({
  interactionId: 'care',
  source: 'pet-interaction',
  bucket: 'pet-interaction',
  amount: 0,
  dailyCap: 0
});

function recordInteractionReward(state, { interactionId, rewardDay, at } = {}) {
  if (!/^(longPress|fling|click-(1|3|5|10|20|50))$/.test(interactionId)) {
    return {
      recorded: false,
      awardedReward: 0,
      leveledUp: false,
      level: state.level,
      rewardDay
    };
  }
  const reward = applyDomainReward(state, {
    eventId: makeRewardEventId(INTERACTION_REWARD.source, 'care', rewardDay),
    source: INTERACTION_REWARD.source,
    bucket: INTERACTION_REWARD.bucket,
    amount: INTERACTION_REWARD.amount,
    at,
    dateKey: rewardDay,
    metadata: { interactionId },
    dailyCap: INTERACTION_REWARD.dailyCap
  });
  return { ...reward, rewardDay };
}

module.exports = { INTERACTION_REWARD, recordInteractionReward };
