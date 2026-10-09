'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityModeFor, activityControllerContent, activityLabelFor, normalizeMirror } = require('../src/surfaces/pet/activity-mirror.mjs');
const content = require('../src/content');
const { createSessionActivityController } = require('../src/core/session-activity.mjs');
const { drawActionDetails } = require('../src/core/pet-action-art.mjs');

test('focus and rest always win; the mirror only shows outside a session', () => {
  assert.equal(activityModeFor('focused', 'music'), 'focused');
  assert.equal(activityModeFor('resting', 'ai'), 'resting');
  assert.equal(activityModeFor('idle', 'coding'), 'mirror-coding');
  assert.equal(activityModeFor('idle', null), 'idle');
  assert.equal(activityModeFor('idle', 'dancing'), 'idle');
  assert.equal(normalizeMirror('__proto__'), null);
});

test('mirror modes drive the shared session-activity controller with their own pose and prop', () => {
  const controller = createSessionActivityController({ ...activityControllerContent(content), clock: { now: () => 0 } });
  const expected = { 'mirror-music': ['dance', 'music-notes'], 'mirror-coding': ['type', 'keyboard'], 'mirror-ai': ['browse', 'ai-chat'] };
  for (const [mode, [motion, prop]] of Object.entries(expected)) {
    const activity = controller.setMode(mode, 0);
    assert.deepEqual([activity.motion, activity.prop], [motion, prop]);
    assert.equal(controller.current(10 * 60_000).id, mode, 'a single-activity mode keeps going');
  }
  assert.equal(controller.setMode('idle', 0), null);
  assert.equal(activityLabelFor(content.MIRROR_ACTIVITIES['mirror-ai']), '… 和 AI 对话');
  assert.equal(activityLabelFor(content.SESSION_ACTIVITIES['focus-type']), '⌨ 专注 · 打字');
});

test('the placeholder AI prop is drawn rather than silently skipped', () => {
  const calls = [];
  const context = new Proxy({}, { get: (_target, name) => (name === 'save' || name === 'restore' ? () => {} : (...args) => calls.push([name, ...args])), set: () => true });
  const palette = ['#000', '#111', '#222', '#333'];
  drawActionDetails(context, content.MIRROR_ACTIVITIES['mirror-ai'], 0.05, palette, {});
  assert.ok(calls.length > 0, 'the prop draws something');
});

test('mirror face selection changes only the idle base for an exact declared category', () => {
  const { mirrorBaseExpressionFor } = require('../src/surfaces/pet/activity-mirror.mjs');
  for (const [category, id] of Object.entries({ music: 'mirror-music', coding: 'mirror-coding', ai: 'mirror-ai' })) {
    const activity = content.MIRROR_ACTIVITIES[id];
    assert.equal(mirrorBaseExpressionFor('life.idle', activity, category), activity.expression);
    for (const status of ['work.pause', 'work.focus', 'work.rest', 'life.sleep', 'life.drowsy', 'life.peek', 'react.hungry']) {
      assert.equal(mirrorBaseExpressionFor(status, activity, category), status);
    }
    assert.equal(mirrorBaseExpressionFor('life.idle', activity, null), 'life.idle');
    assert.equal(mirrorBaseExpressionFor('life.idle', { ...activity, id: 'focus-type' }, category), 'life.idle');
    assert.equal(mirrorBaseExpressionFor('life.idle', { ...activity, state: 'focused' }, category), 'life.idle');
  }
  assert.equal(mirrorBaseExpressionFor('life.idle', null, 'ai'), 'life.idle');
});
