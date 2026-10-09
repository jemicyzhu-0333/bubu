'use strict';

const { preferences, companion } = require('../../capabilities');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const UPDATE_PREFERENCES_WRITES = Object.freeze(['settings', 'pet']);

function createUpdatePreferencesWorkflow({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('update-preferences workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('update-preferences workflow requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('update-preferences workflow effects must be functions');
  }

  function execute({ patch, expectedRevision } = {}, { onSuccessBeforePublish } = {}) {
    const updatedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: UPDATE_PREFERENCES_WRITES,
      expectedRevision,
      context: { now: updatedAt },
      transition: state => {
        const previousSettings = state.settings;
        const applied = preferences.settingsPatch.applyPreferencesPatch(state, patch);
        if (!applied.ok) return applied;
        const mealPolicyChanged = applied.changedKeys.some(key => companion.mealRhythm.MEAL_SETTING_KEYS.includes(key)
          && previousSettings[key] !== state.settings[key]);
        const careChanged = (mealPolicyChanged || !state.settings.aiBreakdownEnabled || !state.settings.aiPetMealsEnabled)
          ? companion.mealRhythm.cancelMealAdvice(state, { resetObservation: previousSettings.petEnabled !== state.settings.petEnabled }) : false;
        return { ...applied, careChanged, changed: applied.changed || careChanged };
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const settings = preferences.normalizeSettings(transaction.state
      ? transaction.state.settings
      : undefined);
    const success = { ok: true, settings, changed: transaction.committed, careChanged: transaction.careChanged === true };
    if (typeof onSuccessBeforePublish === 'function') {
      runPostCommitEffect(onSuccessBeforePublish, success, reportEffectError);
    }
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'preferences-updated',
        settings,
        changedKeys: Object.freeze([...(transaction.changedKeys || [])]),
        careChanged: transaction.careChanged === true,
        updatedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return success;
  }

  return Object.freeze({ execute });
}

module.exports = {
  UPDATE_PREFERENCES_WRITES,
  createUpdatePreferencesWorkflow
};
