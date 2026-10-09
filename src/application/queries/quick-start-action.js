'use strict';

const work = require('../../capabilities/work');
const execution = require('../../capabilities/execution');
const { entityFingerprint } = require('../ai/entity-fingerprint');

// The candidate is an identity only; the version always covers the complete
// canonical task. No renderer clock, recommendation copy or global revision.
function projectQuickStartAction({ taskId, tasks, startState, now }) {
  const task = (Array.isArray(tasks) ? tasks : []).find(item => item.id === taskId);
  let reason = !Number.isFinite(now) || now < 0 || !startState ? 'quick-start-unavailable'
    : work.availability.taskStartBlockReason(task, now);
  if (!reason) {
    const authorized = execution.sessionStart.authorizeStart(startState);
    if (!authorized.ok) reason = authorized.reason;
    else if (execution.focusSession.isTimingSession(startState.focusSession)) reason = 'session-active';
  }
  return Object.freeze({ taskId, intent: task?.nextAction ? 'start' : 'clarify-and-start',
    enabled: reason === null, reason, taskVersion: task ? entityFingerprint(task) : null });
}

module.exports = { projectQuickStartAction };
