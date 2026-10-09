'use strict';
const { companion, execution } = require('../../capabilities');
const { projectPetSessionDisplay } = require('./pet-session-display');
const { projectCompanionFeedState } = require('./companion-feed-state');

// Closed pet projection. The internal sample contains private canonical data;
// only these existing context fields cross the pet boundary.
function projectPetContext(sample, { skins, appearanceItems, contextRevision }) {
  const { snapshot, settings, pomodoro, energyEstimate, workStart, workEnd } = sample;
  const appearance = companion.appearanceSelection.selectAppearance({
    items: appearanceItems, level: snapshot.level, unlockedSkins: snapshot.unlockedSkins,
    currentSkin: snapshot.currentSkin,
    equipped: snapshot.companion?.appearance?.equipped
  });
  return {
    contextRevision,
    baseState: pomodoro.running ? (pomodoro.mode === 'break' ? 'resting' : 'focused') : 'idle',
    paused: pomodoro.paused,
    focusRing: execution.sessionProjection.projectFocusRing(pomodoro),
    sessionDisplay: projectPetSessionDisplay({ pomodoro, quickStartDecision: snapshot.quickStartDecision,
      focusLandingPrompt: snapshot.focusLandingPrompt }),
    skin: snapshot.currentSkin,
    level: snapshot.level,
    theme: (skins[snapshot.currentSkin] || skins.pink).theme,
    appearanceItemIds: appearance.worn.map(item => item.id),
    energyLevel: energyEstimate.level,
    work: { start: workStart, end: workEnd },
    ...(sample.feedState || projectCompanionFeedState(snapshot, sample.now)),
    petActivityMode: settings.petActivityMode,
    motionMode: settings.motionMode,
    stimulationMode: settings.stimulationMode,
    dnd: settings.dnd
  };
}

function projectPetState(sample, options, runtime = {}) {
  const { baseState, energyLevel, ...context } = projectPetContext(sample, options);
  return { ...context, state: baseState, energy: sample.energyEstimate,
    screenLocked: runtime.screenLocked === true, visualState: runtime.visualState };
}
module.exports = { projectPetContext, projectPetState };
