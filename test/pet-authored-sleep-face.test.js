'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const sleep = EXPRESSIONS.find(item => item.id === 'life.sleep');

test('an explicitly sleeping story beat stays closed through every doze cycle phase', () => {
  const nap = SESSION_ACTIVITIES['rest-nap'];
  for (let i = 0; i <= 200; i++) {
    const sample = sampleActivityStory(nap, .27 + .49999 * i / 200);
    const face = sampleFaceChoreography(sleep.face, { action: sample.action, motion: sample.action.motion,
      progress: sample.progress, expressionId: sleep.id });
    assert.equal(sample.action.faceCue, 'life.sleep');
    assert.equal(face.eyes, 'closed', `phase ${sample.progress}`);
    assert.equal(face.openness, 0);
  }
});

test('awake preparation and recovery still open eyes and priority feedback can interrupt sleep', () => {
  const nap = SESSION_ACTIVITIES['rest-nap'];
  for (const progress of [.075, .2, .82, .93]) {
    const sample = sampleActivityStory(nap, progress);
    const face = sampleFaceChoreography(sleep.face, { action: sample.action, motion: sample.action.motion,
      progress: sample.progress, expressionId: sleep.id });
    assert.notEqual(sample.action.faceCue, 'life.sleep');
    assert.ok(face.openness > 0);
  }
  const sample = sampleActivityStory(nap, .5), feedback = EXPRESSIONS.find(item => item.id === 'react.happy');
  assert.strictEqual(sampleFaceChoreography(feedback.face, { action: sample.action, motion: sample.action.motion,
    progress: sample.progress, expressionId: feedback.id }), feedback.face);
});
