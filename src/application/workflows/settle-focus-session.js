'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const companion = require('../../capabilities/companion');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const SETTLE_FOCUS_SESSION_WRITES = Object.freeze([
  'focusSession',
  'quickStartDecision',
  'focusLandingPrompt',
  'tasks',
  'xp',
  'level',
  'lastCompletedDate',
  'stats',
  'rewardLedger',
  'companion',
  'unlockedSkins'
]);

function settleFocusSessionDraft(state, {
  nextSession,
  completion,
  settledAt,
  createHandoff = true
} = {}) {
  const validation = execution.sessionSettlement.validateCompletion(completion);
  if (!validation.ok) return validation;

  const alreadyRecorded = progress.sessionSettlement.hasRecordedSessionSettlement(state, completion);
  const sessionResult = execution.sessionSettlement.settleSession(state, {
    nextSession,
    completion,
    settledAt,
    alreadyRecorded
  });
  if (!sessionResult.ok) return sessionResult;

  const progressResult = progress.sessionSettlement.recordSessionProgress(state, completion);
  if (!progressResult.reward.recorded) {
    return {
      ok: true,
      reward: progressResult.reward,
      foodDrop: null,
      bond: null,
      newlyUnlockedSkins: []
    };
  }

  if (progressResult.investment) {
    work.sessionInvestment.recordSessionInvestment(state, progressResult.investment);
  }
  if (createHandoff) {
    execution.sessionSettlement.recordCompletionHandoff(state, completion);
  }

  const benefits = completion.completed && completion.kind === execution.focusSession.STATUS.FOCUS
    ? companion.completionBenefits.applyFocusCompletionBenefits(state, {
        now: completion.endedAt
      })
    : { foodDrop: null, bond: null };
  const newlyUnlockedSkins = companion.completionBenefits.unlockEligibleSkins(state);
  return {
    ok: true,
    reward: progressResult.reward,
    foodDrop: benefits.foodDrop,
    bond: benefits.bond,
    newlyUnlockedSkins
  };
}

function createSettleFocusSessionWorkflow({
  unitOfWork,
  clock,
  synchronize = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('settle-focus-session workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('settle-focus-session workflow requires a clock');
  }
  if ([synchronize, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('settle-focus-session workflow effects must be functions');
  }

  function execute({ nextSession, completion, settledAt, expectedRevision } = {}) {
    const validation = execution.sessionSettlement.validateCompletion(completion);
    if (!validation.ok) return validation;
    const now = settledAt === undefined ? clock.now() : settledAt;
    const transaction = unitOfWork.run({
      writes: SETTLE_FOCUS_SESSION_WRITES,
      expectedRevision,
      context: { now },
      transition: state => settleFocusSessionDraft(state, {
        nextSession,
        completion,
        settledAt: now
      })
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = {
      ok: true,
      committed: transaction.committed,
      reward: transaction.reward,
      foodDrop: transaction.foodDrop,
      bond: transaction.bond,
      newlyUnlockedSkins: [...transaction.newlyUnlockedSkins]
    };
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'focus-session-settled',
      settledAt: now,
      revision: transaction.revision,
      completion: Object.freeze({
        ...completion,
        activeSegments: Object.freeze(completion.activeSegments.map(segment => Object.freeze({ ...segment })))
      }),
      session: transaction.state.focusSession,
      reward: transaction.reward,
      foodDrop: transaction.foodDrop,
      bond: transaction.bond,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = {
  SETTLE_FOCUS_SESSION_WRITES,
  settleFocusSessionDraft,
  createSettleFocusSessionWorkflow
};
