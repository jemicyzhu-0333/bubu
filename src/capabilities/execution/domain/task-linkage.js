'use strict';

const { isActiveSession, isPausedSession } = require('./session-state');

function requireState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('task linkage requires a state draft');
  }
}

function taskExecutionBlockReason(state, taskId) {
  requireState(state);
  const session = state.focusSession;
  if (session && session.taskId === taskId
      && (isActiveSession(session) || isPausedSession(session))) {
    return 'task-in-active-session';
  }
  const decision = state.quickStartDecision;
  if (decision && decision.status === 'pending' && decision.taskId === taskId) {
    return 'task-in-active-session';
  }
  return null;
}

/**
 * Every task the execution loop still owes the user an answer about: the task
 * in the live or paused session, and the tasks behind an unanswered prompt.
 * Housekeeping must leave these where they are — moving one would drop the
 * handoff the user is midway through.
 */
function pendingHandoffTaskIds(state) {
  requireState(state);
  const taskIds = new Set();
  const session = state.focusSession;
  if (session && session.taskId && (isActiveSession(session) || isPausedSession(session))) {
    taskIds.add(session.taskId);
  }
  for (const prompt of [state.quickStartDecision, state.focusLandingPrompt]) {
    if (prompt && prompt.status === 'pending' && prompt.taskId) taskIds.add(prompt.taskId);
  }
  return [...taskIds];
}

function clearNowTask(state, taskId) {
  requireState(state);
  if (state.nowTaskId === taskId) state.nowTaskId = null;
}

module.exports = {
  taskExecutionBlockReason,
  pendingHandoffTaskIds,
  clearNowTask
};
