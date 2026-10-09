'use strict';

const {
  requireTimestamp,
  isActiveFocusSession
} = require('./session-state');
const { pauseSession } = require('./session-transitions');
const { pauseForConfirmation } = require('./session-recovery');
const { clearNowTask } = require('./task-linkage');

/**
 * Reconcile execution state after a task is sealed. A matching running work
 * session is paused, never silently settled. If it has just reached its end,
 * retain the full active history for explicit confirmation.
 */
function reconcileCompletedTask(state, { taskId, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task completion reconciliation requires a state draft');
  }
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new TypeError('task completion reconciliation requires a task id');
  }
  const transitionAt = requireTimestamp(now);
  clearNowTask(state, taskId);

  const session = state.focusSession;
  if (!session || session.taskId !== taskId || !isActiveFocusSession(session)) {
    return { paused: false, due: false, session };
  }

  const paused = pauseSession(session, transitionAt);
  const result = paused.completion
    ? pauseForConfirmation(session, transitionAt, 'task-completed-session-due')
    : paused;
  state.focusSession = result.session;
  return {
    paused: true,
    due: result.due === true,
    session: result.session
  };
}

module.exports = { reconcileCompletedTask };
