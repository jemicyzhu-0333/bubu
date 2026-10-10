'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityMirror } = require('../src/bootstrap/activity-mirror');

function harness() {
  let now = 1_000_000, idle = 0, sample, event, tick;
  const delivered = [];
  const mirror = createActivityMirror({ platform: 'darwin', isPackaged: true, resourcesPath: '/resources',
    appPath: '/app', profile: 'development', getSettings: () => ({ activityMirrorEnabled: true }),
    readIdleMs: () => idle, now: () => now, exists: () => true, writeClipboard: () => {}, publishChange: () => {},
    presentMirror: (primary, concurrent) => delivered.push({ primary, concurrent }),
    setTimer: fn => { tick = fn; return 1; }, clearTimer: () => {},
    createProbe: ({ onSample }) => { sample = onSample; return { start() {}, stop() {} }; },
    createServer: ({ onEvent }) => { event = onEvent; return { start: async () => ({ ok: true }), stop() {} }; }
  });
  mirror.sync();
  return { mirror, delivered, advance: ms => { now += ms; }, idle: ms => { idle = ms; },
    sample: (front = null, audio = []) => sample({ front, audio }), event: (source, type) => event({ source, event: type }), tick: () => tick() };
}
function assertConsistent(h, primary) {
  const projection = h.mirror.projection();
  assert.equal(projection.activity, primary);
  assert.equal(h.mirror.current(), primary);
  const expected = projection.concurrent.ai ? 'ai' : projection.concurrent.coding ? 'coding' : projection.concurrent.music ? 'music' : 'none';
  assert.equal(primary, expected, 'panel, compatibility and concurrent pet projection have one authority');
  assert.equal(h.delivered.at(-1).primary, primary === 'none' ? null : primary);
}

test('answer completion removes the AI status immediately, without reading or release grace', () => {
  const h = harness();
  h.event('codex', 'prompt');
  h.advance(1_000);
  h.event('codex', 'stop');
  assert.equal(h.mirror.projection().concurrent.ai, false);
  assertConsistent(h, 'none');
});

test('ending AI returns immediately to already settled music and coding, without restarting dwell', () => {
  const h = harness();
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.advance(15_000);
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  h.event('codex', 'prompt');
  h.event('codex', 'stop');
  h.sample('com.microsoft.VSCode', ['com.spotify.client']);
  assertConsistent(h, 'coding');
  assert.equal(h.mirror.projection().concurrent.music, true);
});

test('a late prompt-free tick expires AI consistently while another active source keeps priority', () => {
  const h = harness();
  h.event('codex', 'prompt');
  h.advance(100_000);
  h.event('cursor', 'prompt');
  h.event('codex', 'stop');
  h.advance(90_001);
  h.tick();
  assertConsistent(h, 'ai');
  h.advance(600_000);
  h.tick();
  assertConsistent(h, 'none');
});

test('a foreground AI window cannot retain an ended conversation or re-activate after visibility resumes', () => {
  const h = harness();
  h.sample('com.openai.chat');
  h.advance(15_000);
  h.sample('com.openai.chat');
  assert.equal(h.mirror.current(), 'none', 'a foreground AI app alone never establishes active work');
  h.event('codex', 'prompt');
  h.event('codex', 'stop');
  h.sample('com.openai.chat');
  assertConsistent(h, 'none');
  h.idle(200_000);
  h.tick();
  assertConsistent(h, 'none');
});


test('repeated completion is harmless and a new prompt can immediately own AI again', () => {
  const h = harness();
  h.sample(null, ['com.spotify.client']);
  h.advance(15_000);
  h.sample(null, ['com.spotify.client']);
  h.event('codex', 'prompt');
  assertConsistent(h, 'ai');
  h.event('codex', 'stop');
  assertConsistent(h, 'music');
  h.event('codex', 'stop');
  assertConsistent(h, 'music');
  h.event('codex', 'prompt');
  assertConsistent(h, 'ai');
  assert.equal(h.mirror.projection().concurrent.music, true);
});


test('completion received while idle cannot resurrect when the user returns', () => {
  const h = harness();
  h.event('codex', 'prompt');
  h.idle(120_000);
  h.tick();
  assertConsistent(h, 'none');
  h.event('codex', 'stop');
  h.idle(0);
  h.sample('com.openai.chat');
  h.tick();
  assertConsistent(h, 'none');
});
