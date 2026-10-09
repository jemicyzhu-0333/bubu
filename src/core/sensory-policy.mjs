'use strict';

function imAdhderMotionMode(value) {
  return ['reduced', 'balanced', 'full'].includes(value) ? value : 'balanced';
}

function imAdhderStimulationMode(value) {
  return ['low', 'balanced', 'high'].includes(value) ? value : 'balanced';
}

function resolveSensoryPolicy(input = {}) {
  const motionMode = imAdhderMotionMode(input.motionMode);
  const stimulationMode = imAdhderStimulationMode(input.stimulationMode);
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

const imAdhderSensoryPolicyApi = {
  normalizeMotionMode: imAdhderMotionMode,
  normalizeStimulationMode: imAdhderStimulationMode,
  resolveSensoryPolicy
};



export default imAdhderSensoryPolicyApi;
export const normalizeMotionMode = imAdhderSensoryPolicyApi.normalizeMotionMode;
export const normalizeStimulationMode = imAdhderSensoryPolicyApi.normalizeStimulationMode;
export { resolveSensoryPolicy };
