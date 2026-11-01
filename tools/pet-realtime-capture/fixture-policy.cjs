'use strict';
const AI_FLAGS = Object.freeze(['aiBreakdownEnabled', 'aiClarifyEnabled', 'aiMemoryEnabled',
  'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled']);
function assertCaptureFixtureState(state) {
  const settings = state?.settings;
  if (state?.schemaVersion !== 20 || !settings || AI_FLAGS.some(key => settings[key] !== false)
    || settings.aiBaseUrl !== null || settings.autoCheckUpdates !== false || settings.activityMirrorEnabled !== false
    || settings.quickPanelEnabled !== false || settings.soundEnabled !== false || settings.dnd !== true
    || settings.routineRemindersEnabled !== false || settings.workEndReminder !== false
    || settings.petActivityMode !== 'off' || settings.motionMode !== 'full' || settings.stimulationMode !== 'balanced'
    || ['tasks', 'archivedTasks', 'impulses', 'routines'].some(key => !Array.isArray(state[key]) || state[key].length !== 0)
    || state.focusSession?.status !== 'idle' || state.focusSession.sessionId !== null || state.focusSession.taskId !== null
    || !Array.isArray(state.focusSession.activeSegments) || state.focusSession.activeSegments.length !== 0) throw new Error('capture-fixture-safety-invalid');
  return true;
}
module.exports = { assertCaptureFixtureState, AI_FLAGS };
