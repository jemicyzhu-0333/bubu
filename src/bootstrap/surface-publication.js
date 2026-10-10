'use strict';
const { buildStateDelta } = require('../core/state-channel.mjs');
const { runPostCommitEffect } = require('../shared/post-commit-effects');

function expandSurfaceDependencies(dirty = {}) {
  const expanded = { ...dirty };
  if (['all', 'energy', 'wellbeing', 'pomodoro', 'focusSession', 'stats', 'settings', 'routines']
    .some(key => dirty[key])) {
    expanded.energy = true;
    expanded.recommendations = true;
  }
  return expanded;
}
function petContextChanged(dirty) {
  return ['all', 'energy', 'wellbeing', 'pomodoro', 'focusSession', 'stats', 'settings',
    'routines', 'tasks', 'pet', 'companion', 'appearance', 'skin',
    'quickStartDecision', 'focusLandingPrompt'].some(key => dirty[key]);
}

// Process publication revision is not a repository transaction revision. Each
// publication has one read sample; projection and delivery faults never retry
// business work or prevent another surface's independent delivery attempt.
function createSurfacePublisher({ readSample, projectPopover, projectPet,
  sendPopover, sendQuick, sizeQuick, sendPet, reconcileReminders = () => {},
  afterPet = () => {}, reconcileDiagnostics = () => {}, reportEffectError = () => {} }) {
  let revision = 0;
  const attempt = (channel, effect) => runPostCommitEffect(effect, { channel }, reportEffectError);
  function publish(dirty = {}) {
    attempt('ai-diagnostics-privacy', reconcileDiagnostics);
    const flags = expandSurfaceDependencies(dirty);
    const currentRevision = ++revision;
    if (flags.all || flags.routines || flags.settings) {
      attempt('routine-reminders', reconcileReminders);
    }
    let sample;
    attempt('surface-projection', () => { sample = readSample(); });
    let delta;
    if (sample) attempt('popover-projection', () => {
      delta = buildStateDelta(projectPopover(sample, flags), flags);
    });
    attempt('state:diff:popover', () => sendPopover({ revision: currentRevision, dirty: flags,
      ...(delta ? { delta } : {}) }));
    const quickPanel = sample?.quickPanel;
    if (quickPanel) attempt('quick-size', () => sizeQuick(quickPanel));
    attempt('state:diff:quick', () => sendQuick({ revision: currentRevision, dirty: flags,
      ...(quickPanel ? { delta: { quickPanel } } : {}) }));
    if (sample && petContextChanged(flags)) {
      let context;
      attempt('pet-projection', () => { context = projectPet(sample, currentRevision); });
      if (context) attempt('pet:sync', () => sendPet(context));
      attempt('pet-policy', () => afterPet(flags));
    }
    return currentRevision;
  }
  return Object.freeze({ publish, readRevision: () => revision });
}
module.exports = { createSurfacePublisher, expandSurfaceDependencies, petContextChanged };
