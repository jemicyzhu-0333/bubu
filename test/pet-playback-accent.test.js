'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePlaybackAccent } = require('../src/surfaces/pet/action-playback.mjs');
const { createExpressionRegistry } = require('../src/core/pet-expression.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const registry = createExpressionRegistry(EXPRESSIONS);

test('rest-nap accents follow authored awake, drowsy, asleep and recovery story phases', () => {
  const nap = SESSION_ACTIVITIES['rest-nap'];
  for (const [progress, expected] of [[.05, 'none'], [.2, 'drowsy-zzz'], [.5, 'sleep-zzz'], [.82, 'none'], [.95, 'none']]) {
    const { action } = sampleActivityStory(nap, progress);
    assert.equal(resolvePlaybackAccent(registry, nap.expression, action), expected, String(progress));
  }
  const quiet = sampleActivityStory(nap, .9, { calmVisual: true });
  assert.equal(resolvePlaybackAccent(registry, nap.expression, quiet.action), 'sleep-zzz');
});

test('feedback priority, standalone expressions and missing phase metadata retain the winning accent', () => {
  const sleeping = sampleActivityStory(SESSION_ACTIVITIES['rest-nap'], .5).action;
  for (const expression of EXPRESSIONS) {
    if (expression.id === sleeping.baseExpression) continue;
    assert.equal(resolvePlaybackAccent(registry, expression.id, sleeping), expression.accent);
    assert.equal(resolvePlaybackAccent(registry, expression.id, null), expression.accent);
  }
  assert.equal(resolvePlaybackAccent(registry, 'life.sleep', { expression: 'life.sleep' }), 'sleep-zzz');
  assert.equal(resolvePlaybackAccent(registry, 'life.sleep', { expression: 'life.sleep', faceCue: 'unknown' }), 'sleep-zzz');
  assert.equal(resolvePlaybackAccent(null, 'life.sleep', sleeping), 'none');
});
