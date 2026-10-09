'use strict';

const execution = require('../../capabilities/execution');
const preferences = require('../../capabilities/preferences');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const ADJUST_FOCUS_DURATION_WRITES = Object.freeze(['focusSession', 'settings']);

function createAdjustFocusDurationWorkflow({
  unitOfWork,
  clock,
  synchronize = () => {},
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('adjust-focus-duration workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('adjust-focus-duration workflow requires a clock');
  }
  if ([synchronize, publish, reportEffectError].some(effect => typeof effect !== 'function')) {
    throw new TypeError('adjust-focus-duration workflow effects must be functions');
  }

  function execute({ minutes, expectedRevision } = {}) {
    const adjustedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: ADJUST_FOCUS_DURATION_WRITES,
      expectedRevision,
      context: { now: adjustedAt },
      transition: state => {
        const requested = execution.sessionDuration.normalizeFocusMinutes(
          minutes,
          state.settings && state.settings.pomodoroMinutes
        );
        const adjustment = execution.focusSession.adjustSessionDuration(
          state.focusSession,
          { plannedDurationMs: requested * 60 * 1000 },
          { now: adjustedAt }
        );
        if (!adjustment.ok) return { ...adjustment, requested };
        if (!adjustment.changed) return { ...adjustment, requested };

        const remembered = preferences.focusDuration.rememberSelection(state.settings, requested);
        if (!remembered.ok) return remembered;
        state.focusSession = adjustment.session;
        state.settings = remembered.settings;
        return { ...adjustment, requested };
      }
    });

    if (!transaction.ok) {
      const response = { ok: false, reason: transaction.reason };
      if (transaction.session) {
        response.minMinutes = execution.sessionDuration.minimumAdjustableMinutes(
          transaction.investedMs || 0
        );
        response.session = execution.sessionProjection.projectSession(transaction.session, adjustedAt);
      }
      return response;
    }

    const session = transaction.state.focusSession;
    const projection = execution.sessionProjection.projectSession(session, adjustedAt);
    if (!transaction.committed) return { ok: true, changed: false, session: projection };

    const fact = Object.freeze({
      type: 'focus-duration-adjusted',
      minutes: transaction.requested,
      adjustedAt,
      revision: transaction.revision,
      session
    });
    runPostCommitEffect(synchronize, fact, reportEffectError);
    runPostCommitEffect(publish, fact, reportEffectError);
    return { ok: true, changed: true, session: projection };
  }

  return Object.freeze({ execute });
}

module.exports = { ADJUST_FOCUS_DURATION_WRITES, createAdjustFocusDurationWorkflow };
