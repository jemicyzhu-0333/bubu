'use strict';
const { runPostCommitEffect } = require('../shared/post-commit-effects');

function createPreferencesPublisher({ refreshHydration, setDnd, closeNotifications, activateScheduled,
  checkBoundaries, setPetVisible, syncActivity, rebindShortcut, setQuickPanelEnabled,
  refreshBoundaryWatcher, updateSensory, publishImpulseSensory, publishChange, reportEffectError, mealSettingsChanged = () => {} }) {
  return fact => {
    const changed = new Set(fact.changedKeys || []);
    const attempt = effect => runPostCommitEffect(effect, fact, reportEffectError);
    attempt(() => mealSettingsChanged(fact.changedKeys || []));
    attempt(refreshHydration);
    if (changed.has('dnd')) {
      const dnd = fact.settings.dnd === true;
      attempt(() => setDnd(dnd));
      if (dnd) attempt(closeNotifications);
      else { attempt(activateScheduled); attempt(checkBoundaries); }
    }
    if (changed.has('petEnabled')) attempt(() => setPetVisible(fact.settings.petEnabled));
    if (changed.has('activityMirrorEnabled')) attempt(syncActivity);
    // Rebind before enabling; each host operation keeps its own rollback rule.
    if (changed.has('quickPanelShortcut')) attempt(() => rebindShortcut(fact.settings.quickPanelShortcut));
    if (changed.has('quickPanelEnabled')) attempt(() => setQuickPanelEnabled(fact.settings.quickPanelEnabled));
    if (['workStartHour', 'workEndHour', 'workEndReminder'].some(key => changed.has(key))) attempt(refreshBoundaryWatcher);
    if (['motionMode', 'stimulationMode', 'petActivityMode'].some(key => changed.has(key))) {
      attempt(() => updateSensory(fact.settings));
      attempt(publishImpulseSensory);
    }
    // Same-value opt-out may still clear stale advice. Publish the committed pet
    // slice even when changedKeys is empty and a preceding effect failed.
    attempt(() => publishChange({ settings: true, pet: fact.careChanged === true }));
  };
}
module.exports = { createPreferencesPublisher };
