'use strict';

// Startability is a work invariant; callers supply the current time explicitly.

function parsedTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Return the reason a task cannot start, or null when it is startable.
 * This is deliberately enforced in the main process; renderer button state is
 * only a convenience and must never be the authorization boundary.
 */
function taskStartBlockReason(task, now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) {
    throw new TypeError('task availability requires a finite non-negative time');
  }
  const observedAt = now;
  if (!task || typeof task !== 'object') return 'task-not-found';
  if (task.done) return 'task-completed';
  // A skipped recurrence occurrence is sealed history, exactly like a completed
  // one: the series has already moved on to its successor.
  if (task.skippedAt) return 'occurrence-skipped';

  // Auto-expiry is an opt-in policy in schema 8 rather than a property of one
  // task category, so any task carrying `expiresAt` is subject to it.
  const expiresAt = parsedTimestamp(task.expiresAt);
  if (expiresAt !== null && (task.expired === true || expiresAt <= observedAt)) return 'task-expired';
  const scheduledAt = parsedTimestamp(task.scheduledFor);
  if (scheduledAt !== null && scheduledAt > observedAt) return 'task-scheduled';
  return null;
}

module.exports = { parsedTimestamp, taskStartBlockReason };
