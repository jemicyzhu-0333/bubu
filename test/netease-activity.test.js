'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityMirror, concurrentActivity } = require('../src/capabilities').companion;
const { ACTIVITY_APPS } = require('../src/content/activity-apps');
const { parseProbeLine } = require('../src/platform/activity/probe-line');
const NETEASE = 'com.netease.163music';
const NOW = 1_800_000_000_000;

function observe(previous, front, audio, now) {
  const sample = { ...parseProbeLine(JSON.stringify({ v: 1, front, audio })), at: now };
  return concurrentActivity.advanceConcurrentActivity(previous, {
    sample, agents: [], idleMs: 0, now, catalog: ACTIVITY_APPS, platform: 'darwin'
  });
}

test('NetEase output is recognized in foreground and background independently of coding', () => {
  for (const front of [NETEASE, 'com.microsoft.VSCode', 'com.google.Chrome', null]) {
    let state = observe(null, front, [NETEASE], NOW);
    state = observe(state, front, [NETEASE], NOW + 15_000);
    assert.equal(state.projection.music, true);
    assert.equal(state.projection.coding, front === 'com.microsoft.VSCode');
    state = observe(state, front, [], NOW + 17_000);
    state = observe(state, front, [], NOW + 47_000);
    assert.equal(state.projection.music, false, 'stopped output releases music even with player still in front');
  }
});

test('an open NetEase app, missing output or unrelated audio cannot prove music playback', () => {
  for (const audio of [[], ['com.google.Chrome.helper'], ['com.netease.unverified-player']]) {
    assert.equal(activityMirror.rawActivity({ sample: { front: NETEASE, audio, idleMs: 0 },
      now: NOW, catalog: ACTIVITY_APPS, platform: 'darwin' }), 'none');
  }
  assert.equal(activityMirror.rawActivity({ sample: { front: null, audio: [NETEASE], idleMs: 180_000 },
    now: NOW, catalog: ACTIVITY_APPS, platform: 'darwin' }), 'music', 'background output survives keyboard idle');
});
