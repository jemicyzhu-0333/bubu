'use strict';

const { makeRewardEventId } = require('../../../core/reward-ledger');
const { localDayKey } = require('../../../core/calendar');
const { ensureStats, incrementDaily, applyDomainReward } = require('./progress-state');

const RETURN_KINDS = new Set(['focus', 'quick-start']);

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('execution activity requires a finite non-negative time');
  }
  return value;
}

function recordExecutionReturn(state, { sessionId, checkpoint, kind, at } = {}) {
  const recordedAt = requireTimestamp(at);
  if (typeof sessionId !== 'string' || !sessionId
      || typeof checkpoint !== 'string' || !checkpoint
      || !RETURN_KINDS.has(kind)) {
    return { recorded: false };
  }
  const result = applyDomainReward(state, {
    eventId: makeRewardEventId('execution-return', `${sessionId}:${checkpoint}`, 'v1'),
    source: 'execution-return',
    amount: 0,
    at: recordedAt,
    metadata: { sessionId, checkpoint, kind }
  });
  if (result.recorded) {
    incrementDaily(ensureStats(state), 'dailyReturns', localDayKey(recordedAt), 1);
  }
  return result;
}

function recordSessionLaunch(state, { at } = {}) {
  const launchedAt = requireTimestamp(at);
  const day = localDayKey(launchedAt);
  incrementDaily(ensureStats(state), 'dailyLaunches', day, 1);
  return { recorded: true, day };
}

module.exports = { recordExecutionReturn, recordSessionLaunch };
