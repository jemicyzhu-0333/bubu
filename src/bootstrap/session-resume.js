'use strict';

const { runPostCommitEffect } = require('../shared/post-commit-effects');

// Preserve the existing no-partial-commit handoff: only the exact canonical
// completion accepted by settlement can trigger presentation (including rest).
function createSessionResumeAdapter({ workflow, settle, present, publish, project, reportEffectError = () => {} }) {
  return function resumeFocusSession(action) {
    const result = workflow.execute(action);
    if (result.reason !== 'session-completed') return result;
    settle(result.nextSession, result.completion, result.settledAt);
    runPostCommitEffect(present, result.completion, reportEffectError);
    runPostCommitEffect(publish, { pomodoro: true, stats: true, tasks: true }, reportEffectError);
    // Presentation may synchronously start a linked break; project that current
    // session, never the pre-settlement held session or an invented idle view.
    return { ok: true, session: project() };
  };
}

module.exports = { createSessionResumeAdapter };
