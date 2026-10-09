'use strict';

const execution = require('../../capabilities/execution');
const progress = require('../../capabilities/progress');
const companion = require('../../capabilities/companion');
const { recordSessionGrowth } = require('./record-session-growth');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const {
  SETTLE_FOCUS_SESSION_WRITES,
  settleFocusSessionDraft
} = require('./settle-focus-session');

const ACCEPT_HEALTHY_SHUTDOWN_WRITES = Object.freeze([...SETTLE_FOCUS_SESSION_WRITES, 'pet']);

function noReward(state) {
  return {
    recorded: false,
    awardedReward: 0,
    leveledUp: false,
    level: state.level
  };
}

function acceptHealthyShutdownDraft(state, { dayKey, settledAt } = {}) {
  const shutdown = progress.healthyShutdown.recordHealthyShutdown(state, dayKey);
  if (!shutdown.ok) return shutdown;

  const transition = execution.healthyShutdown.settleForHealthyShutdown(
    state.focusSession,
    settledAt
  );
  let settlement = {
    reward: noReward(state),
    foodDrop: null,
    bond: null,
    newlyUnlockedSkins: []
  };

  if (transition.completion) {
    settlement = settleFocusSessionDraft(state, {
      nextSession: transition.session,
      completion: transition.completion,
      settledAt,
      createHandoff: false
    });
    if (!settlement.ok) return settlement;
  } else {
    execution.sessionSettlement.replaceSession(state, transition.session, settledAt);
  }

  const handoff = execution.healthyShutdown.recordHandoff(
    state,
    transition,
    {
      dayKey,
      settledAt
    }
  );
  const growth = recordSessionGrowth(state, {
    sessionId: `shutdown-${dayKey}`, taskId: null, progressMade: false,
    closing: true, now: settledAt, kind: 'shutdown'
  });
  const remainingUnlocks = companion.completionBenefits.unlockEligibleSkins(state);
  const newlyUnlockedSkins = [
    ...new Set([...settlement.newlyUnlockedSkins, ...growth.newlyUnlockedSkins, ...remainingUnlocks])
  ];

  return {
    ok: true,
    action: transition.action,
    completion: transition.completion || null,
    shutdown,
    handoff,
    reward: growth.reward,
    foodDrop: settlement.foodDrop,
    bond: growth.bond || settlement.bond,
    newlyUnlockedSkins
  };
}

function freezeCompletion(completion) {
  if (!completion) return null;
  return Object.freeze({
    ...completion,
    activeSegments: Object.freeze(
      completion.activeSegments.map(segment => Object.freeze({ ...segment }))
    )
  });
}

function createAcceptHealthyShutdownWorkflow({
  unitOfWork,
  clock,
  sessionClock,
  synchronize = () => {},
  publishSettlement = () => {},
  clearNudge = () => {},
  clearTray = () => {},
  present = () => {},
  publish = () => {},
  revealHandoff = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('accept-healthy-shutdown workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function'
      || !sessionClock || typeof sessionClock.now !== 'function') {
    throw new TypeError('accept-healthy-shutdown workflow requires wall and session clocks');
  }
  const effects = [
    synchronize,
    publishSettlement,
    clearNudge,
    clearTray,
    present,
    publish,
    revealHandoff,
    reportEffectError
  ];
  if (effects.some(effect => typeof effect !== 'function')) {
    throw new TypeError('accept-healthy-shutdown workflow effects must be functions');
  }

  function execute({ dayKey, expectedRevision } = {}) {
    const dayValidation = progress.healthyShutdown.validateHealthyShutdownDay(dayKey);
    if (!dayValidation.ok) return dayValidation;
    const wallNow = clock.now();
    const transaction = unitOfWork.run({
      writes: ACCEPT_HEALTHY_SHUTDOWN_WRITES,
      expectedRevision,
      context: { now: wallNow },
      transition: state => {
        const settledAt = sessionClock.now(state.focusSession, wallNow);
        return {
          ...acceptHealthyShutdownDraft(state, { dayKey, settledAt }),
          settledAt
        };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const completion = freezeCompletion(transaction.completion);
    const response = {
      ok: true,
      committed: transaction.committed,
      action: transaction.action,
      session: transaction.state.focusSession
    };
    if (completion) response.completion = completion;
    if (!transaction.committed) return response;

    const fact = Object.freeze({
      type: 'healthy-shutdown-accepted',
      dayKey,
      settledAt: transaction.settledAt,
      revision: transaction.revision,
      action: transaction.action,
      session: transaction.state.focusSession,
      completion,
      shutdown: Object.freeze({ ...transaction.shutdown }),
      handoff: Object.freeze({ ...transaction.handoff }),
      hasPendingHandoff: Boolean(
        transaction.state.focusLandingPrompt && transaction.state.focusLandingPrompt.status === 'pending'
        || transaction.state.quickStartDecision && transaction.state.quickStartDecision.status === 'pending'
      ),
      reward: transaction.reward,
      foodDrop: transaction.foodDrop,
      bond: transaction.bond,
      newlyUnlockedSkins: Object.freeze([...transaction.newlyUnlockedSkins])
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publishSettlement, fact, reportEffectError);
    runPostCommitEffect(clearNudge, fact, reportEffectError);
    runPostCommitEffect(clearTray, fact, reportEffectError);
    runPostCommitEffect(present, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    runPostCommitEffect(revealHandoff, fact, reportEffectError);
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = {
  ACCEPT_HEALTHY_SHUTDOWN_WRITES,
  acceptHealthyShutdownDraft,
  createAcceptHealthyShutdownWorkflow
};
