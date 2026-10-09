'use strict';

function bubuMotionMode(value) {
  return ['reduced', 'balanced', 'full'].includes(value) ? value : 'balanced';
}

function bubuStimulationMode(value) {
  return ['low', 'balanced', 'high'].includes(value) ? value : 'balanced';
}

function resolveSensoryPolicy(input = {}) {
  const motionMode = bubuMotionMode(input.motionMode);
  const stimulationMode = bubuStimulationMode(input.stimulationMode);
  const dnd = input.dnd === true;
  // "完整" is the deliberate opt-out from the operating system preference.
  // Every other mode continues to respect Reduce Motion.
  const reduceMotion = motionMode === 'reduced'
    || (motionMode !== 'full' && input.systemReducedMotion === true);
  const lowStimulation = stimulationMode === 'low';
  return Object.freeze({
    motionMode,
    stimulationMode,
    dnd,
    reduceMotion,
    lowStimulation,
    calmVisuals: reduceMotion || lowStimulation,
    allowSceneMotion: !reduceMotion && !lowStimulation,
    allowAmbientParticles: !reduceMotion && !lowStimulation,
    allowAutonomousCues: !dnd && !lowStimulation,
    allowAttentionCues: !dnd && !lowStimulation && !reduceMotion,
    allowUnsolicitedSpeech: !dnd,
    allowEssentialFeedback: true
  });
}

const bubuSensoryPolicyApi = {
  normalizeMotionMode: bubuMotionMode,
  normalizeStimulationMode: bubuStimulationMode,
  resolveSensoryPolicy
};



export default bubuSensoryPolicyApi;
export const normalizeMotionMode = bubuSensoryPolicyApi.normalizeMotionMode;
export const normalizeStimulationMode = bubuSensoryPolicyApi.normalizeStimulationMode;
export { resolveSensoryPolicy };
