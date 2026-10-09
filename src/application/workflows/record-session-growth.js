'use strict';

const progress = require('../../capabilities/progress');
const companion = require('../../capabilities/companion');
const { makeRewardEventId } = require('../../core/reward-ledger');

const RECORD_SESSION_GROWTH_WRITES = Object.freeze([
  'xp', 'level', 'rewardLedger', 'pet', 'companion', 'unlockedSkins'
]);

// Draft helper only: callers own the single commit and declare the full writes.
function recordSessionGrowth(state, { sessionId, taskId = null, progressMade, closing, now, kind }) {
  if (typeof progressMade !== 'boolean' || typeof closing !== 'boolean') {
    throw new TypeError('session growth requires explicit progress and close choices');
  }
  const rewards = [];
  const bonds = [];
  let ticketsGranted = false;
  if (progressMade) {
    rewards.push(progress.progressState.applyDomainReward(state, {
      eventId: makeRewardEventId('confirmed-progress', sessionId, 'v1'),
      source: kind === 'quick-start' ? 'quick-start-confirmed' : 'focus-confirmed',
      amount: 10, at: now, metadata: { taskId, sessionId }
    }));
  }
  if (closing) {
    const source = kind === 'shutdown' ? 'healthy-shutdown' : kind === 'break' ? 'rest-choice' : 'focus-landing';
    rewards.push(progress.progressState.applyDomainReward(state, {
      eventId: makeRewardEventId('chosen-close', sessionId, 'v1'),
      source, amount: 10, at: now, metadata: { taskId, sessionId }
    }));
  }
  for (const reward of rewards) {
    const benefit = companion.completionBenefits.applyGrowthBenefits(state, { reward, now });
    if (benefit.bond) bonds.push(benefit.bond);
    ticketsGranted ||= benefit.ticketsGranted === true;
  }
  return {
    reward: {
      recorded: rewards.some(item => item.recorded),
      awardedReward: rewards.reduce((sum, item) => sum + item.awardedReward, 0),
      advanceGranted: rewards.some(item => item.advanceGranted),
      firstAdvance: rewards.some(item => item.firstAdvance),
      closeGranted: rewards.some(item => item.closeGranted),
      leveledUp: rewards.some(item => item.leveledUp), level: state.level, xp: state.xp
    },
    bond: bonds.length ? { ...bonds.at(-1), stageChanged: bonds.some(item => item.stageChanged) } : null,
    ticketsGranted,
    newlyUnlockedSkins: companion.completionBenefits.unlockEligibleSkins(state)
  };
}

module.exports = { RECORD_SESSION_GROWTH_WRITES, recordSessionGrowth };
