'use strict';

const { localDayKey, addDaysToKey } = require('../../../core/calendar');
const { isPlainObject } = require('../../../core/field-normalizers');
const { normalizeRecurrenceRule, SERIES_STATES } = require('./task-model');
const {
  collectUsedIds,
  findSeries,
  advanceSeries
} = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('recurrence series update requires a finite non-negative time');
  }
  return value;
}

function requireIdFactory(createId) {
  if (typeof createId !== 'function') {
    throw new TypeError('recurrence series update requires an id factory');
  }
  return createId;
}

function lastClosedDayForSeries(state, seriesId) {
  const candidates = [];
  for (const collection of ['tasks', 'archivedTasks']) {
    for (const task of Array.isArray(state[collection]) ? state[collection] : []) {
      if (!task || task.seriesId !== seriesId || (!task.done && !task.skippedAt)) continue;
      const closedAt = task.completedAt || task.skippedAt;
      if (Number.isFinite(Number(closedAt))) candidates.push(Number(closedAt));
    }
  }
  return candidates.length ? localDayKey(Math.max(...candidates)) : null;
}

function updateSeries(state, input = {}, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('recurrence series update requires a state draft');
  }
  const now = requireTimestamp(input.now);
  const series = findSeries(state, input.seriesId);
  if (!series) return { ok: false, reason: 'series-not-found' };

  if (input.rule === undefined && input.state === undefined) {
    return { ok: false, reason: 'series-update-empty' };
  }

  let nextRule = series.rule;
  if (input.rule !== undefined) {
    if (!isPlainObject(input.rule)) return { ok: false, reason: 'invalid-recurrence-rule' };
    const patch = Object.fromEntries(
      Object.entries(input.rule).filter(([, value]) => value !== undefined)
    );
    const candidate = { ...series.rule, ...patch };
    const normalized = normalizeRecurrenceRule(candidate, {
      fallbackAnchorDate: series.rule.anchorDate
    });
    if (JSON.stringify(candidate) !== JSON.stringify(normalized)) {
      return { ok: false, reason: 'invalid-recurrence-rule' };
    }
    nextRule = normalized;
  }

  let nextState = series.state;
  let endedAt = series.endedAt;
  if (input.state !== undefined) {
    if (typeof input.state !== 'string' || !SERIES_STATES.includes(input.state)) {
      return { ok: false, reason: 'invalid-series-state' };
    }
    // Ending a schedule is irreversible. Paused schedules can resume, but an
    // ended identity remains an immutable statement about its history.
    if (series.state === 'ended' && input.state !== 'ended') {
      return { ok: false, reason: 'series-ended' };
    }
    nextState = input.state;
    endedAt = input.state === 'ended' ? now : null;
  }

  series.rule = nextRule;
  series.state = nextState;
  series.endedAt = endedAt;
  series.updatedAt = now;

  let nextOccurrence = null;
  if (series.state === 'active' && !series.openTaskId) {
    const createId = requireIdFactory(options.createId);
    const today = localDayKey(now);
    const closedOn = series.lastOccurrenceDate || series.rule.anchorDate;
    const completedOn = lastClosedDayForSeries(state, series.id) || closedOn;
    nextOccurrence = advanceSeries(state, series, {
      closedOn,
      completedOn,
      // Materialize at most one useful occurrence, folding missed schedule
      // slots instead of creating a backlog of overdue work.
      referenceDay: addDaysToKey(today, -1),
      now,
      usedIds: collectUsedIds(state),
      createId
    });
  }

  return { ok: true, series, nextOccurrence };
}

module.exports = { lastClosedDayForSeries, updateSeries };
