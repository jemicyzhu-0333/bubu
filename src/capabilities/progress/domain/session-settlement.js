'use strict';

const { makeRewardEventId } = require('../../../core/reward-ledger');
const { localDayKey, splitAcrossLocalDays } = require('../../../core/calendar');
const {
  ensureStats,
  incrementDaily,
  applyProgressDay,
  applyDomainReward
} = require('./progress-state');

const SESSION_KINDS = Object.freeze({
  FOCUS: 'focus',
  QUICK_START: 'quick-start',
  BREAK: 'break'
});
const SESSION_REWARDS = Object.freeze({
  [SESSION_KINDS.FOCUS]: 0,
  [SESSION_KINDS.QUICK_START]: 0,
  [SESSION_KINDS.BREAK]: 0
});

function sourceFor(kind) {
  if (kind === SESSION_KINDS.FOCUS) return 'focus-complete';
  if (kind === SESSION_KINDS.QUICK_START) return 'quick-start-complete';
  return 'break-complete';
}

function settlementEventId(completion) {
  return makeRewardEventId('session-settle', completion.sessionId, 'v1');
}

function hasRecordedSessionSettlement(state, completion) {
  const seen = state && state.rewardLedger && state.rewardLedger.seenEventIds;
  return Array.isArray(seen) && seen.includes(settlementEventId(completion));
}

function activeTimeFact(completion) {
  if (![SESSION_KINDS.FOCUS, SESSION_KINDS.QUICK_START].includes(completion.kind)
      || completion.elapsedMs < 5000) return null;
  return Object.freeze({
    taskId: completion.taskId,
    elapsedMs: completion.elapsedMs,
    startedAt: completion.createdAt
  });
}

function accountingSegments(completion) {
  const segments = Array.isArray(completion.activeSegments) ? completion.activeSegments : [];
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endedAt - segment.startedAt),
    0
  );
  return segments.length && Math.abs(total - completion.elapsedMs) <= 1
    ? segments
    : [{ startedAt: completion.endedAt - completion.elapsedMs, endedAt: completion.endedAt }];
}

/**
 * Record only progress-owned state for one terminal session fact. The returned
 * investment fact lets the workflow update work state without this capability
 * reaching into the task aggregate itself.
 */
function recordSessionProgress(state, completion) {
  const completed = completion.completed === true;
  const reward = applyDomainReward(state, {
    eventId: settlementEventId(completion),
    source: sourceFor(completion.kind),
    amount: completed ? SESSION_REWARDS[completion.kind] : 0,
    at: completion.endedAt,
    metadata: {
      taskId: completion.taskId,
      reason: completion.reason,
      elapsedMs: completion.elapsedMs
    }
  });
  if (!reward.recorded) return { reward, investment: null };

  const investment = activeTimeFact(completion);
  if (investment) {
    const stats = ensureStats(state);
    stats.totalFocusMs = (Number(stats.totalFocusMs) || 0) + completion.elapsedMs;
    for (const segment of accountingSegments(completion)) {
      for (const slice of splitAcrossLocalDays(segment.startedAt, segment.endedAt)) {
        stats.dailyFocus[slice.dateKey] = (Number(stats.dailyFocus[slice.dateKey]) || 0) + slice.durationMs;
      }
    }
    if (completed && completion.kind === SESSION_KINDS.FOCUS) {
      stats.totalPomodoros = (Number(stats.totalPomodoros) || 0) + 1;
    }
    if (completed) incrementDaily(stats, 'dailyCompletions', localDayKey(completion.endedAt), 1);
  }
  if (completed && [SESSION_KINDS.FOCUS, SESSION_KINDS.QUICK_START].includes(completion.kind)) {
    applyProgressDay(state, completion.endedAt);
  }
  return { reward, investment };
}

module.exports = {
  SESSION_KINDS,
  SESSION_REWARDS,
  settlementEventId,
  hasRecordedSessionSettlement,
  recordSessionProgress,
  // Exported so the timeline-fact builder derives session.segment from the exact
  // same segment math that feeds stats.dailyFocus (ARCHITECTURE「事实流与长期记忆」) — one definition, so
  // the gantt bars and the daily scalar can never disagree.
  activeTimeFact,
  accountingSegments
};
