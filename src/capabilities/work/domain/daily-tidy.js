'use strict';

const { calendarDayDiff } = require('../../../core/calendar');

// How long expiring work may sit untouched before the local-day pass tidies it
// into recoverable history.
const STALE_AFTER_DAYS = 7;

function requireState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.tasks)) {
    throw new TypeError('the local-day tidy requires a state draft with tasks');
  }
}

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('the local-day tidy requires a finite non-negative time');
  }
  return value;
}

/**
 * Refresh how many local days each open deadline has slipped by. Completed and
 * skipped work keeps the count it was closed with: history is a record of what
 * happened, not a total that keeps running afterwards.
 */
function recountOverdueDays(state, now) {
  requireState(state);
  const at = requireTimestamp(now);
  const recountedTaskIds = [];
  for (const task of state.tasks) {
    if (!task || !task.deadline || task.done || task.skippedAt) continue;
    const overdueCount = Math.max(0, calendarDayDiff(new Date(task.deadline), new Date(at)));
    const previous = task.overdueCount;
    task.overdueCount = overdueCount;
    if (previous !== overdueCount) recountedTaskIds.push(task.id);
  }
  return { ok: true, recountedTaskIds };
}

/**
 * Pick the expiring work that has sat untouched long enough to tidy away. The
 * move is into recoverable history — never a deletion and never a penalty — so
 * anything the app still owes the user is deliberately left where it is.
 */
function selectStaleExpiringTasks(state, { now, protectedTaskIds = [] } = {}) {
  requireState(state);
  const at = requireTimestamp(now);
  const spared = new Set(protectedTaskIds);
  const taskIds = [];
  for (const task of state.tasks) {
    if (!task || task.done || task.skippedAt || !task.expiresAt) continue;
    // A recurrence occurrence belongs to its series' schedule. Tidying it away
    // would remove a round out from under the series that owns it.
    if (task.seriesId) continue;
    if (spared.has(task.id)) continue;
    const expiry = Date.parse(task.expiresAt);
    if (!Number.isFinite(expiry)) continue;
    if (calendarDayDiff(new Date(expiry), new Date(at)) <= STALE_AFTER_DAYS) continue;
    taskIds.push(task.id);
  }
  return { ok: true, taskIds };
}

module.exports = { STALE_AFTER_DAYS, recountOverdueDays, selectStaleExpiringTasks };
