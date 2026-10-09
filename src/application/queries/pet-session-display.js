'use strict';
const { sessionProjection } = require('../../capabilities/execution');

// Presentation only: execution owns eligibility, elapsed time and settlement.
// This closed shape contains no task content and never reads another snapshot.
function projectPetSessionDisplay(projection = {}) {
  const session = projection.pomodoro || {};
  const anchor = sessionProjection.projectFocusRing(session);
  if (anchor) {
    const action = session.resumeAction;
    const reason = action?.reason || null;
    const phase = reason === 'recovery-state-inconsistent' ? 'attention'
      : action?.intent === 'confirm-completion' ? 'confirm'
        : session.paused && reason === 'task-completed' ? 'task-completed'
          : session.paused && action?.enabled === false ? 'attention'
            : session.paused ? 'paused' : anchor.mode === 'break' ? 'break' : 'focus';
    return Object.freeze({ ...anchor, kind: session.kind || anchor.mode, phase, reason,
      running: anchor.running && ['focus', 'break'].includes(phase) });
  }
  const pending = projection.quickStartDecision?.status === 'pending' ? projection.quickStartDecision
    : projection.focusLandingPrompt?.status === 'pending' ? projection.focusLandingPrompt : null;
  return pending ? Object.freeze({ sessionId: pending.sessionId,
    kind: pending === projection.quickStartDecision ? 'quick-start' : 'focus', phase: 'complete',
    reason: null, mode: 'focus', plannedMs: 0, elapsedMs: 0, running: false }) : null;
}
module.exports = { projectPetSessionDisplay };
