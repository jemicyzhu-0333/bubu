'use strict';

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8.64e15) {
    throw new TypeError('task expiration requires a finite non-negative time');
  }
  return value;
}

function expireDueTasks(state, expiredAt) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.tasks)) {
    throw new TypeError('task expiration requires a state draft with tasks');
  }
  const now = requireTimestamp(expiredAt);
  const expiredTaskIds = [];
  for (const task of state.tasks) {
    if (!task || task.done || task.skippedAt || task.expired || !task.expiresAt) continue;
    const expiry = Date.parse(task.expiresAt);
    if (!Number.isFinite(expiry) || expiry > now) continue;
    task.expired = true;
    expiredTaskIds.push(task.id);
  }
  return { ok: true, expiredTaskIds };
}

module.exports = { expireDueTasks };
