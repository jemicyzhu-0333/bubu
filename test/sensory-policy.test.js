'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSensoryPolicy } = require('../src/core/sensory-policy.mjs');

test('balanced motion follows the operating system while full is an explicit override', () => {
  assert.equal(resolveSensoryPolicy({ motionMode: 'balanced', systemReducedMotion: true }).reduceMotion, true);
  assert.equal(resolveSensoryPolicy({ motionMode: 'full', systemReducedMotion: true }).reduceMotion, false);
  assert.equal(resolveSensoryPolicy({ motionMode: 'reduced', systemReducedMotion: false }).reduceMotion, true);
});

test('low stimulation removes decorative motion without hiding essential feedback', () => {
  const policy = resolveSensoryPolicy({ motionMode: 'full', stimulationMode: 'low' });
  assert.equal(policy.reduceMotion, false);
  assert.equal(policy.calmVisuals, true);
  assert.equal(policy.allowAmbientParticles, false);
  assert.equal(policy.allowAutonomousCues, false);
  assert.equal(policy.allowEssentialFeedback, true);
});

test('DND silences unsolicited cues but does not redefine the motion preference', () => {
  const policy = resolveSensoryPolicy({
    dnd: true,
    motionMode: 'full',
    stimulationMode: 'high',
    systemReducedMotion: true
  });
  assert.equal(policy.allowAutonomousCues, false);
  assert.equal(policy.allowAttentionCues, false);
  assert.equal(policy.allowUnsolicitedSpeech, false);
  assert.equal(policy.reduceMotion, false);
  assert.equal(policy.allowSceneMotion, true);
});

test('invalid persisted values fall back to balanced behavior', () => {
  const policy = resolveSensoryPolicy({ motionMode: 'system', stimulationMode: 'extreme' });
  assert.equal(policy.motionMode, 'balanced');
  assert.equal(policy.stimulationMode, 'balanced');
});
