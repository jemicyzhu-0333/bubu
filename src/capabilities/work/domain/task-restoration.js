'use strict';

const { validIsoOrNull } = require('../../../core/field-normalizers');
const { findTask } = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task restoration requires a finite non-negative time');
  }
  return value;
}

function renewedExpiry(renewExpiry, restoredAt) {
  if (typeof renewExpiry !== 'function') {
    throw new TypeError('task restoration requires an expiry renewal policy');
  }
  const expiresAt = validIsoOrNull(renewExpiry(restoredAt));
  if (!expiresAt || Date.parse(expiresAt) <= restoredAt) {
    throw new TypeError('task restoration expiry renewal must return a future instant');
  }
  return expiresAt;
}

function restoreTask(state, { taskId, now } = {}, { renewExpiry } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task restoration requires a state draft');
  }
  const restoredAt = requireTimestamp(now);
  const archived = Array.isArray(state.archivedTasks) ? state.archivedTasks : [];
  const task = archived.find(item => item && item.id === taskId);
  if (!task) return { ok: false, reason: 'task-not-found' };
  if (findTask(state, taskId)) return { ok: false, reason: 'task-already-active' };

  // Completed and skipped records are immutable history even when made visible
  // again. Only an unfinished restored item may restart an elapsed expiry.
  const sealed = task.done
    || (typeof task.skippedAt === 'number' && Number.isFinite(task.skippedAt));
  const oldExpiry = task.expiresAt ? Date.parse(task.expiresAt) : Number.NaN;
  const expiresAt = !sealed && task.expiresAt
    && (!Number.isFinite(oldExpiry) || oldExpiry <= restoredAt)
    ? renewedExpiry(renewExpiry, restoredAt)
    : task.expiresAt;
  const restored = {
    ...task,
    archivedAt: null,
    archiveReason: null,
    expired: sealed ? task.expired : false,
    expiresAt
  };

  state.archivedTasks = archived.filter(item => item.id !== taskId);
  state.tasks = [restored, ...state.tasks];
  return { ok: true, task: restored };
}

module.exports = { restoreTask };
