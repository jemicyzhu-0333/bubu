'use strict';

const execution = require('../../capabilities/execution');
const work = require('../../capabilities/work');

// ARCHITECTURE「任务、会话与奖励」: a projection is never a settlement.
// The command recomputes this action from the canonical draft before writing.
function projectSessionResumeAction({ session, tasks, now }) {
  if (!execution.focusSession.isPausedSession(session)) return null;
  const remaining = execution.focusSession.remainingMs(session, now);
  const kind = execution.focusSession.sessionKind(session);
  const confirm = session.awaitingOfflineConfirmation === true || remaining === 0;
  let reason = confirm && remaining > 0 ? 'recovery-state-inconsistent' : null;
  if (!confirm && session.taskId && kind !== execution.focusSession.STATUS.BREAK) {
    const task = (Array.isArray(tasks) ? tasks : []).find(item => item.id === session.taskId);
    reason = work.availability.taskStartBlockReason(task, now);
  }
  return Object.freeze({ sessionId: session.sessionId,
    intent: confirm ? 'confirm-completion' : 'resume', enabled: reason === null, reason });
}

module.exports = { projectSessionResumeAction };
