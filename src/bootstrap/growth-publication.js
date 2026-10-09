'use strict';
const { runPostCommitEffect } = require('../shared/post-commit-effects');

// Effects consume already committed facts. A broken celebration or history
// adapter cannot suppress the authoritative surface refresh or another effect.
function createGrowthPublisher({ publishChange, notifyLevelUp, announceBond, announceSkins,
  recordTaskCompletion, celebrateTask, notifyRecurrence, clearNudge, reportEffectError }) {
  const attempt = (fact, effect) => runPostCommitEffect(effect, fact, reportEffectError);
  function benefits(fact) {
    if (fact.reward) attempt(fact, () => notifyLevelUp(fact.reward));
    if (fact.bond) attempt(fact, () => announceBond(fact.bond));
    attempt(fact, () => announceSkins(fact.newlyUnlockedSkins || []));
  }
  function publish(fact, dirty) {
    attempt(fact, () => publishChange({ stats: true, companion: true, pet: true,
      skin: Boolean(fact.newlyUnlockedSkins?.length), ...dirty }));
  }
  return Object.freeze({
    completeTask(fact) {
      attempt(fact, () => recordTaskCompletion({ taskId: fact.taskId, completedAt: fact.completedAt,
        stepCount: fact.stepCount, hadFocus: fact.hadFocus }));
      attempt(fact, () => celebrateTask(fact));
      benefits(fact);
      if (fact.nextOccurrenceDate) attempt(fact, notifyRecurrence);
      if (fact.sessionPaused) attempt(fact, clearNudge);
      publish(fact, { tasks: true, nowTask: true, recommendations: true,
        recurrenceSeries: Boolean(fact.nextOccurrenceDate), focusLandingPrompt: true,
        pomodoro: fact.sessionPaused });
    },
    completeStep(fact) {
      benefits(fact);
      publish(fact, { tasks: true, recommendations: true });
    },
    resolveLanding(fact) {
      benefits(fact);
      const saved = fact.action === 'save';
      publish(fact, { tasks: saved, nowTask: saved, focusLandingPrompt: true, recommendations: saved });
    },
    resolveQuickStart(fact) {
      benefits(fact);
      publish(fact, { pomodoro: Boolean(fact.session), quickStartDecision: true,
        tasks: true, nowTask: true, recommendations: true });
    },
    healthyShutdown(fact) {
      benefits(fact);
      publish(fact, { pomodoro: true, tasks: true, quickStartDecision: true, focusLandingPrompt: true });
    },
    startBreak(fact) {
      benefits(fact);
      publish(fact, { pomodoro: true });
    }
  });
}
module.exports = { createGrowthPublisher };
