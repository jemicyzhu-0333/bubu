'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionActivityController } = require('../src/core/session-activity.mjs');
const {
  SESSION_ACTIVITIES,
  SESSION_ACTIVITY_ROTATIONS
} = require('../src/content/session-activities.mjs');

test('session activity controller starts and rotates only inside the active session mode', () => {
  let now = 0;
  const controller = createSessionActivityController({
    activities: SESSION_ACTIVITIES,
    rotations: SESSION_ACTIVITY_ROTATIONS,
    clock: { now: () => now }
  });

  assert.equal(controller.current(), null);
  assert.equal(controller.setMode('focused').state, 'focused');
  const first = controller.current();
  now = first.durationMs - 1;
  assert.equal(controller.current().id, first.id);
  now += 1;
  assert.notEqual(controller.current().id, first.id);
  assert.equal(controller.current().state, 'focused');

  const rest = controller.setMode('resting');
  assert.equal(rest.state, 'resting');
  assert.ok(SESSION_ACTIVITY_ROTATIONS.resting.includes(rest.id));
  assert.equal(controller.setMode('idle'), null);
});

test('manual activity advance wraps without changing the session mode', () => {
  const controller = createSessionActivityController({
    activities: SESSION_ACTIVITIES,
    rotations: SESSION_ACTIVITY_ROTATIONS,
    clock: { now: () => 0 }
  });
  controller.setMode('resting', 0);
  const seen = [];
  for (let index = 0; index < SESSION_ACTIVITY_ROTATIONS.resting.length; index += 1) {
    seen.push(controller.current(0).id);
    controller.advance(0);
  }
  assert.deepEqual(seen, SESSION_ACTIVITY_ROTATIONS.resting);
  assert.equal(controller.current(0).id, SESSION_ACTIVITY_ROTATIONS.resting[0]);
});

// 推进与入口是两件事：推进必须只读单调时钟（否则校时会跳段），而“从哪个
// 活动开始”需要一个会变的种子。单调时钟从 0 起算，共用它等于入口被钉在首项。
test('the rotation entry follows wall-clock minutes while progress stays monotonic', () => {
  let playbackNow = 0;
  let wallNow = 0;
  const controller = createSessionActivityController({
    activities: SESSION_ACTIVITIES,
    rotations: SESSION_ACTIVITY_ROTATIONS,
    clock: { now: () => playbackNow },
    entryClock: { now: () => wallNow }
  });

  const first = controller.setMode('focused');
  assert.equal(first.id, SESSION_ACTIVITY_ROTATIONS.focused[0]);

  // 同一个单调时刻、下一个墙钟分钟：下一段会话必须从另一个活动进入。
  controller.setMode('idle');
  wallNow = 60_000;
  const second = controller.setMode('focused');
  assert.equal(second.id, SESSION_ACTIVITY_ROTATIONS.focused[1]);

  // 进入之后，墙钟怎么跳都不得推进轮换或让进度倒退。
  playbackNow = Math.floor(second.durationMs / 2);
  const midway = controller.progress();
  wallNow += 24 * 60 * 60 * 1000;
  assert.equal(controller.current().id, second.id);
  assert.equal(controller.progress(), midway);
  wallNow -= 48 * 60 * 60 * 1000;
  assert.equal(controller.current().id, second.id);
  assert.equal(controller.progress(), midway);

  // 单调时钟走完一段时长才轮到下一个。
  playbackNow += second.durationMs;
  assert.equal(controller.current().id, SESSION_ACTIVITY_ROTATIONS.focused[2]);
});

test('an unusable entry seed falls back to the first activity instead of a NaN index', () => {
  const controller = createSessionActivityController({
    activities: SESSION_ACTIVITIES,
    rotations: SESSION_ACTIVITY_ROTATIONS,
    clock: { now: () => 0 },
    entryClock: { now: () => Number.NaN }
  });
  assert.equal(controller.setMode('focused').id, SESSION_ACTIVITY_ROTATIONS.focused[0]);
});


test('unequal activity durations retain story progress after delayed frames and whole rotations', () => {
  const activities = {
    a: { id: 'a', state: 'focused', durationMs: 30000 },
    b: { id: 'b', state: 'focused', durationMs: 48000 },
    c: { id: 'c', state: 'focused', durationMs: 42000 }
  };
  const controller = createSessionActivityController({ activities,
    rotations: { focused: ['a', 'b', 'c'] }, clock: { now: () => 0 } });
  controller.setMode('focused', 0);
  const now = 120000 * 100000 + 30000 + 24000;
  assert.equal(controller.current(now).id, 'b');
  assert.equal(controller.progress(now), .5);
  assert.equal(controller.snapshot(now).startedAt, now - 24000);
  assert.equal(controller.current(now).id, 'b');
  controller.advance(now);
  assert.equal(controller.current(now).id, 'c');
  assert.equal(controller.progress(now), 0);
});
