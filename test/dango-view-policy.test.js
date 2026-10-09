'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DANGO_ACTION_VIEWS } = require('../src/content/companion/dango-action-views.mjs');
const { resolveDangoView } = require('../src/core/dango-view-policy.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES, MIRROR_ACTIVITIES } = require('../src/content/session-activities.mjs');
const { sampleActivityStory } = require('../src/capabilities/companion/presentation/activity-playback.mjs');
const { resolveActionPlayback } = require('../src/surfaces/pet/action-playback.mjs');
const { forms, formArt } = require('../src/capabilities/companion/index.mjs');

test('automatic no-action view is front for stationary states and three-quarter only for locomotion or drag', () => {
  for (const state of ['idle', 'focused', 'resting', 'sleeping', 'celebrating']) {
    for (const requested of [undefined, 'auto', 'unknown']) {
      assert.equal(resolveDangoView(requested, { state }), 'front', `${state}/${requested}`);
    }
  }
  for (const state of ['walking', 'dragged']) {
    assert.equal(resolveDangoView('auto', { state }), 'three-quarter', state);
  }
  assert.equal(resolveDangoView('auto'), 'front');
});

test('explicit supported no-action views override state defaults and profile keeps its existing alias', () => {
  for (const state of ['idle', 'focused', 'sleeping', 'walking', 'dragged']) {
    for (const view of ['front', 'three-quarter', 'back']) {
      assert.equal(resolveDangoView(view, { state }), view, `${state}/${view}`);
    }
    assert.equal(resolveDangoView('profile', { state }), 'three-quarter', state);
  }
});

test('real focus-session playback stays frontal through every story phase while a focus expression has no activity', () => {
  const content = { PET_ACTIONS, SESSION_ACTIVITIES }, form = forms.PET_FORMS.dango;
  const sessions = Object.values(SESSION_ACTIVITIES).filter(action => action.state === 'focused');
  assert.equal(sessions.length, 6);
  for (const activity of sessions) {
    const phases = new Set();
    for (let frame = 0; frame <= 100; frame++) {
      const playback = resolveActionPlayback({ content, form, now: frame * 100,
        sessionSnapshot: { activity, progress: frame / 100 } });
      assert.equal(playback.actionConfig.id, activity.id);
      phases.add(playback.phase.index);
      for (const state of ['focused', 'walking', 'dragged']) {
        assert.equal(formArt.resolveView(form, 'auto', { action: playback.actionConfig, state }), 'front',
          `${activity.id}/${playback.phase.index}/${state}`);
      }
    }
    assert.ok(phases.size >= 4, `${activity.id} samples the full story`);
  }
  const expression = resolveActionPlayback({ content, form, now: 2600,
    preview: { category: 'expression', id: 'work.focus' },
    sessionSnapshot: { activity: SESSION_ACTIVITIES['focus-read'], progress: .5 } });
  assert.equal(expression.actionConfig, null, 'expression preview does not masquerade as session playback');
  assert.equal(expression.phase, null);
  assert.equal(formArt.resolveView(form, 'auto', { action: expression.actionConfig, state: 'focused' }), 'front');
});

test('all actions, stories and mirrors have explicit readable dango angles', () => {
  const actions = { ...PET_ACTIONS, ...SESSION_ACTIVITIES, ...MIRROR_ACTIVITIES };
  assert.deepEqual(Object.keys(DANGO_ACTION_VIEWS).sort(), Object.keys(actions).sort());
  for (const action of Object.values(actions)) {
    const policy = DANGO_ACTION_VIEWS[action.id];
    assert.ok(policy.allowed.includes(policy.preferred));
    assert.equal(resolveDangoView('auto', { action }), policy.preferred);
    for (const requested of ['front', 'three-quarter', 'profile', 'back', 'unknown']) {
      const view = resolveDangoView(requested, { action });
      assert.ok(policy.allowed.includes(view), `${action.id}/${requested}: ${view}`);
      assert.notEqual(view, 'profile');
    }
  }
});

test('carrying always retains a readable two-paw angle and frontal face tools stay frontal', () => {
  const carry = PET_ACTIONS['carry-energy'];
  assert.equal(resolveDangoView('auto', { action: carry }), 'front');
  assert.equal(resolveDangoView('profile', { action: carry }), 'three-quarter');
  assert.equal(resolveDangoView('back', { action: carry }), 'front');
  for (const id of ['look-around', 'photo-pose']) {
    assert.equal(resolveDangoView('profile', { action: PET_ACTIONS[id] }), 'front');
    assert.equal(resolveDangoView('back', { action: PET_ACTIONS[id] }), 'front');
  }
});

test('story equipment changes cannot select another silhouette', () => {
  for (const action of Object.values(SESSION_ACTIVITIES)) {
    const expected = resolveDangoView('auto', { action });
    for (let frame = 0; frame <= 100; frame++) {
      const sample = sampleActivityStory(action, frame / 100);
      assert.equal(resolveDangoView('auto', { action: sample.action }), expected);
    }
  }
  assert.equal(resolveDangoView('profile'), 'three-quarter');
  assert.equal(resolveDangoView('auto', { state: 'walking' }), 'three-quarter');
  assert.equal(resolveDangoView('back'), 'back');
});

test('watering and its continuous plant-care story use the front view so face, can and plant agree', () => {
  for (const action of [PET_ACTIONS['plant-water'], SESSION_ACTIVITIES['rest-plant']]) {
    for (const requested of ['auto', 'front', 'three-quarter', 'profile', 'back']) {
      for (const progress of [0, .2, .45, .7, .95]) {
        const sampled = sampleActivityStory(action, progress);
        assert.equal(resolveDangoView(requested, { action: sampled.action }), 'front');
      }
    }
  }
});
