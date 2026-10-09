'use strict';

const { validIsoOrNull } = require('../../../core/field-normalizers');
const { taskStartBlockReason } = require('./task-availability');
const { findTask } = require('./task-state');

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('work session entry requires a finite non-negative time');
  }
  return value;
}

function validRenewal(value, now) {
  const expiresAt = validIsoOrNull(value);
  if (!expiresAt || Date.parse(expiresAt) <= now) {
    throw new TypeError('work session entry renewal must be a future instant');
  }
  return expiresAt;
}

function prepareTask(state, {
  taskId,
  now,
  requireNextAction = false,
  renewedExpiry
} = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('work session entry requires a state draft');
  }
  const observedAt = requireTimestamp(now);
  if (taskId === null || taskId === undefined || taskId === '') {
    return requireNextAction
      ? { ok: false, reason: 'task-not-found' }
      : { ok: true, task: null, renewed: false };
  }

  const task = findTask(state, taskId);
  if (!task) return { ok: false, reason: 'task-not-found' };
  if (requireNextAction && !task.nextAction) {
    return { ok: false, reason: 'next-action-required' };
  }
  let reason = taskStartBlockReason(task, observedAt);
  let renewed = false;
  if (reason === 'task-expired'
      && task
      && task.expiresAt
      && renewedExpiry !== undefined) {
    task.expiresAt = validRenewal(renewedExpiry, observedAt);
    task.expired = false;
    reason = taskStartBlockReason(task, observedAt);
    renewed = reason === null;
  }
  if (reason) return { ok: false, reason };
  return { ok: true, task, renewed };
}

module.exports = { prepareTask };
