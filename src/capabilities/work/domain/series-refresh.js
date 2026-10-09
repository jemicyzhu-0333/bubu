'use strict';

const { addDaysToKey, compareDayKeys } = require('../../../core/calendar');
const { validDayKey } = require('../../../core/field-normalizers');
const { collectUsedIds, findTask, advanceSeries } = require('./task-state');
const { occurrenceDateOnOrBefore } = require('./recurrence');

function requireState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.tasks)) {
    throw new TypeError('the series refresh requires a state draft with tasks');
  }
}

/**
 * Catch fixed-grid recurrences up to today.
 *
 * Recurring work is not "unchecked at midnight": a round the user has not
 * closed keeps its progress. Yesterday remains a fair carry-over; anything
 * older is re-dated to the latest grid slot on or before today so the card does
 * not present an impossible historical debt.
 */
function refreshSeriesOccurrences(state, input = {}, options = {}) {
  requireState(state);
  const now = Number(input.now);
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('input.now must be a finite non-negative timestamp');
  }
  if (!validDayKey(input.today)) {
    throw new TypeError('input.today must be a YYYY-MM-DD local day key');
  }
  const createId = options.createId;
  if (typeof createId !== 'function') {
    throw new TypeError('options.createId must be an identity factory');
  }
  // Catch up *to* today, never past it. The reference day is yesterday so the
  // first grid date on or after today wins: someone returning after a week away
  // should find today's round waiting, not an empty day.
  const referenceDay = addDaysToKey(input.today, -1);
  const generatedTaskIds = [];
  const rolledTaskIds = [];
  for (const series of Array.isArray(state.recurrenceSeries) ? state.recurrenceSeries : []) {
    if (!series || !series.rule || series.state !== 'active' || series.rule.strategy !== 'fixed') continue;
    const open = series.openTaskId ? findTask(state, series.openTaskId) : null;
    if (open) {
      if (rollOpenOccurrenceForward(series, open, input.today, now)) rolledTaskIds.push(open.id);
      continue;
    }
    if (!series.lastOccurrenceDate) continue;
    const result = advanceSeries(state, series, {
      closedOn: series.lastOccurrenceDate,
      referenceDay,
      now,
      usedIds: collectUsedIds(state),
      createId
    });
    if (result) generatedTaskIds.push(result.occurrence.id);
  }
  return { ok: true, generatedTaskIds, rolledTaskIds };
}

function rollOpenOccurrenceForward(series, task, today, now) {
  const from = task.occurrenceDate;
  if (!from || compareDayKeys(from, addDaysToKey(today, -1)) >= 0) return false;
  const current = occurrenceDateOnOrBefore(series.rule, from, today);
  if (current.skipped < 1 || compareDayKeys(current.date, from) <= 0) return false;

  task.occurrenceDate = current.date;
  task.plannedFor = current.date;
  task.updatedAt = now;
  series.lastOccurrenceDate = current.date;
  series.updatedAt = now;
  series.missedCount = (Number(series.missedCount) || 0) + Math.max(0, current.skipped - 1);
  return true;
}

module.exports = { refreshSeriesOccurrences };
