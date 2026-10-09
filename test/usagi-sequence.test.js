'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPANION_ACTIVITY_STORIES } = require('../src/content/companion/activity-stories.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { sampleFaceChoreography } = require('../src/capabilities/companion/presentation/face-choreography.mjs');
const { sampleBodyMotion, motionOffset } = require('../src/capabilities/companion/presentation/usagi-body-motion.mjs');
const { resolveActionPlayback } = require('../src/surfaces/pet/action-playback.mjs');
const { forms, formArt } = require('../src/capabilities/companion/index.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { EXPRESSIONS } = require('../src/content/expressions.mjs');
const byId = Object.fromEntries(EXPRESSIONS.map(e => [e.id, e]));

test('all twelve long activities have bounded chronological anticipation, action and recovery beats', () => {
  assert.equal(Object.keys(COMPANION_ACTIVITY_STORIES).length, 12);
  for (const [id, timeline] of Object.entries(COMPANION_ACTIVITY_STORIES)) {
    assert.ok(SESSION_ACTIVITIES[id].durationMs >= 30000);
    assert.ok(timeline.stages.length >= 4);
    let start = 0;
    for (const stage of timeline.stages) {
      assert.ok(stage.until > start && stage.until <= 1, id);
      assert.ok(stage.cycles >= 1 && stage.cycles <= 4);
      assert.ok(byId[stage.expression]);
      const sample = sampleActivityStory(SESSION_ACTIVITIES[id], (start + stage.until) / 2);
      assert.equal(sample.action.id, id, 'activity identity and timing are preserved');
      assert.equal(sample.action.durationMs, SESSION_ACTIVITIES[id].durationMs);
      assert.equal(sample.action.motion, stage.motion);
      assert.equal(sample.action.prop, stage.prop);
      assert.ok(sample.progress >= 0 && sample.progress <= 1);
      start = stage.until;
    }
    assert.equal(start, 1);
    assert.equal(sampleActivityStory(SESSION_ACTIVITIES[id], 1).phase.index, timeline.stages.length - 1);
  }
});

test('reduced motion is a stable held story beat independent of time and progress', () => {
  for (const action of Object.values(SESSION_ACTIVITIES)) {
    const first = sampleActivityStory(action, 0, { calmVisual: true });
    for (const progress of [.2, .5, .8, 1]) {
      assert.deepEqual(sampleActivityStory(action, progress, { calmVisual: true }), first);
    }
  }
});

test('sequence sampling is random-access, frame-rate independent and shared by both companion forms', () => {
  const action = SESSION_ACTIVITIES['focus-write'];
  const mid = sampleActivityStory(action, .45);
  sampleActivityStory(action, .85);
  assert.deepEqual(sampleActivityStory(action, .45), mid);
  assert.deepEqual(formArt.sampleAction(forms.PET_FORMS.dango, action, .45), mid);
  assert.equal(sampleActivityStory(PET_ACTIONS.wave, .3).action, PET_ACTIONS.wave);
});

test('production playback preserves semantic prop and story phase through preview and sessions', () => {
  const content = { PET_ACTIONS, SESSION_ACTIVITIES };
  const form = forms.PET_FORMS.usagi;
  const session = SESSION_ACTIVITIES['rest-plant'];
  const preview = resolveActionPlayback({ content, form, preview: { category: 'session', id: session.id },
    now: session.durationMs * .5 });
  const active = resolveActionPlayback({ content, form, sessionSnapshot: { activity: session, progress: .5 }, now: 500 });
  assert.equal(active.actionConfig.prop, 'watering-can');
  assert.equal(active.actionConfig.motion, 'water');
  assert.deepEqual(preview.actionConfig, active.actionConfig);
  assert.deepEqual(resolveActionPlayback({ content, form, preview: { category: 'expression', id: 'life.idle' }, now: 0 }).actionConfig, null);
});

test('action-correlated faces have multiple real eye and mouth states and continuous gaze', () => {
  for (const action of Object.values(PET_ACTIONS)) {
    const expression = byId[action.expression].face;
    const poses = Array.from({ length: 21 }, (_, i) => sampleFaceChoreography(expression, {
      action, motion: action.motion, progress: i / 20, elapsedMs: i * 100,
      expressionId: action.expression
    }));
    assert.ok(new Set(poses.map(p => JSON.stringify(p))).size >= 4, action.id);
    for (const pose of poses) {
      assert.ok(pose.openness >= 0 && pose.openness <= 1);
      assert.ok(Math.abs(pose.eyeOffsetX) <= 4);
    }
    const calm = sampleFaceChoreography(expression, { action, motion: action.motion, progress: .4, calmVisual: true });
    assert.equal(calm, expression);
    assert.equal(sampleFaceChoreography(expression, { action, motion: action.motion, progress: .4,
      expressionId: 'system.error' }), expression, 'higher-priority feedback is not replaced');
  }
});

test('whole-body offsets are bounded and calm mode stops them immediately', () => {
  for (const motion of new Set(Object.values(PET_ACTIONS).map(a => a.motion))) {
    for (let i = 0; i <= 120; i += 1) {
      const pose = sampleBodyMotion(motion, i / 120);
      // Falling now sinks through the fixed floor; its clipped geometry is
      // covered by the production-contact and full posed-stage tests.
      assert.ok(Math.abs(pose.x) <= 6 && Math.abs(pose.y) <= (motion === 'fall' ? 39 : 6), motion);
      assert.ok(pose.sx >= .9 && pose.sy >= .9 && pose.sx <= 1.1 && pose.sy <= 1.1);
      assert.deepEqual(motionOffset(motion, i / 120, true), { x: 0, y: 0 });
    }
    const a = sampleBodyMotion(motion, 0), b = sampleBodyMotion(motion, 1);
    assert.ok(Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8);
    assert.ok(Math.abs(Math.sin(a.r) - Math.sin(b.r)) < 1e-8);
  }
});


test('all 32 standalone expressions have their own timed facial phrase and calm holds the original', () => {
  const { EXPRESSION_PHRASES } = require('../src/capabilities/companion/presentation/expression-phrases.mjs');
  assert.deepEqual(Object.keys(EXPRESSION_PHRASES), EXPRESSIONS.map(e => e.id));
  for (const expression of EXPRESSIONS) {
    const period = EXPRESSION_PHRASES[expression.id][0];
    const samples = [0, .2, .4, .6, .8].map(p => sampleFaceChoreography(expression.face, {
      expressionId: expression.id, expressionElapsedMs: period * p, motion: 'idle'
    }));
    assert.ok(new Set(samples.map(p => JSON.stringify(p))).size >= 3, expression.id);
    assert.ok(samples.some(p => p.mouth !== expression.face.mouth || p.eyes !== expression.face.eyes), expression.id);
    assert.equal(sampleFaceChoreography(expression.face, { expressionId: expression.id, elapsedMs: period * .5,
      calmVisual: true }), expression.face);
  }
});


test('long stories keep shared tools visible and ease real equipment changes', () => {
  const action = SESSION_ACTIVITIES['focus-read'];
  assert.equal(sampleActivityStory(action, .12).action.propOpacity, 1);
  assert.equal(sampleActivityStory(action, .42).action.propOpacity, 0);
  assert.ok(sampleActivityStory(action, .418).action.propOpacity < .5);
  assert.equal(sampleActivityStory(action, .46).action.propOpacity, 1);
  assert.equal(sampleActivityStory(action, .42, { calmVisual: true }).action.propOpacity, 1);
});


test('long activities keep one authored silhouette through tool and motion changes', () => {
  const { derivePetView } = require('../src/core/pet-appearance.mjs');
  for (const activity of Object.values(SESSION_ACTIVITIES)) {
    const expected = derivePetView({ action: activity, state: activity.state });
    for (let i = 0; i <= 100; i += 1) {
      const sampled = sampleActivityStory(activity, i / 100);
      assert.equal(derivePetView({ action: sampled.action, state: activity.state }), expected, activity.id);
    }
  }
});
