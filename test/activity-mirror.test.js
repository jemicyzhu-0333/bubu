'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityMirror } = require('../src/capabilities').companion;
const { ACTIVITY_APPS } = require('../src/content/activity-apps');

const { categoryOf, rawActivity, advanceMirror, normalizeAgentEvent, DEFAULT_POLICY } = activityMirror;
const NOW = 1_800_000_000_000;
const sample = (front, audio = [], idleMs = 1000) => ({ front, audio, idleMs });
const raw = (input, platform = 'darwin') => rawActivity({ catalog: ACTIVITY_APPS, platform, now: NOW, ...input });

test('apps map to categories per platform, case-insensitively and with prefix rules', () => {
  assert.equal(categoryOf('com.microsoft.VSCode', ACTIVITY_APPS, 'darwin'), 'coding');
  assert.equal(categoryOf('com.jetbrains.intellij', ACTIVITY_APPS, 'darwin'), 'coding');
  assert.equal(categoryOf('com.anthropic.claudefordesktop', ACTIVITY_APPS, 'darwin'), 'ai');
  assert.equal(categoryOf('com.spotify.client', ACTIVITY_APPS, 'darwin'), 'music');
  assert.equal(categoryOf('Spotify', ACTIVITY_APPS, 'win32'), 'music');
  assert.equal(categoryOf('Code', ACTIVITY_APPS, 'win32'), 'coding');
  assert.equal(categoryOf('com.google.Chrome', ACTIVITY_APPS, 'darwin'), null, 'a browser is not music or coding');
  assert.equal(categoryOf('zoom.us', ACTIVITY_APPS, 'darwin'), null);
  assert.equal(categoryOf('code', ACTIVITY_APPS, 'darwin'), null, 'platform tables do not leak into each other');
  assert.equal(categoryOf('x'.repeat(201), ACTIVITY_APPS, 'darwin'), null);
});

test('precedence: agent hook, then AI app, then editor, then audible music; away keeps only music', () => {
  const prompt = { source: 'claude-code', event: 'prompt', at: NOW - 60_000 };
  assert.equal(raw({ sample: sample('com.microsoft.VSCode', ['com.spotify.client']), agent: prompt }), 'ai');
  assert.equal(raw({ sample: sample('com.openai.chat', ['com.spotify.client']) }), 'ai');
  assert.equal(raw({ sample: sample('com.googlecode.iterm2', ['com.spotify.client']) }), 'coding');
  assert.equal(raw({ sample: sample('com.google.Chrome', ['com.spotify.client']) }), 'music');
  assert.equal(raw({ sample: sample('com.google.Chrome', ['com.google.Chrome.helper']) }), 'none', 'browser audio is not music');
  assert.equal(raw({ sample: sample('com.microsoft.VSCode', ['com.spotify.client'], 5 * 60_000), agent: prompt }), 'music');
  assert.equal(raw({ sample: sample('com.microsoft.VSCode', [], 5 * 60_000) }), 'none');
  assert.equal(raw({ sample: null }), 'none');
});

test('agent events expire: a prompt counts while thinking, an answer briefly after', () => {
  const at = offset => ({ source: 'cursor', event: offset.event, at: NOW - offset.ms });
  assert.equal(raw({ sample: sample('com.google.Chrome'), agent: at({ event: 'prompt', ms: DEFAULT_POLICY.agentThinkingMs - 1 }) }), 'ai');
  assert.equal(raw({ sample: sample('com.google.Chrome'), agent: at({ event: 'prompt', ms: DEFAULT_POLICY.agentThinkingMs + 1 }) }), 'none');
  assert.equal(raw({ sample: sample('com.google.Chrome'), agent: at({ event: 'stop', ms: DEFAULT_POLICY.agentAnswerMs - 1 }) }), 'ai');
  assert.equal(raw({ sample: sample('com.google.Chrome'), agent: at({ event: 'stop', ms: DEFAULT_POLICY.agentAnswerMs + 1 }) }), 'none');
  assert.equal(raw({ sample: sample('com.google.Chrome'), agent: { source: 'cursor', event: 'prompt', at: NOW + 5 } }), 'none', 'future events are ignored');
});

test('smoothing: follow only after the dwell, release more slowly, never flicker on a brief switch', () => {
  let state = advanceMirror(null, { candidate: 'coding', now: NOW });
  assert.equal(state.activity, 'none');
  state = advanceMirror(state, { candidate: 'coding', now: NOW + DEFAULT_POLICY.dwellMs - 1 });
  assert.equal(state.activity, 'none');
  state = advanceMirror(state, { candidate: 'coding', now: NOW + DEFAULT_POLICY.dwellMs });
  assert.equal(state.activity, 'coding');
  const start = NOW + DEFAULT_POLICY.dwellMs;
  state = advanceMirror(state, { candidate: 'music', now: start + 1_000 });
  state = advanceMirror(state, { candidate: 'coding', now: start + 3_000 });
  assert.equal(state.activity, 'coding');
  assert.equal(state.pending, null, 'returning cancels a pending switch');
  state = advanceMirror(state, { candidate: 'none', now: start + 4_000 });
  state = advanceMirror(state, { candidate: 'none', now: start + 4_000 + DEFAULT_POLICY.dwellMs });
  assert.equal(state.activity, 'coding', 'release waits longer than follow');
  state = advanceMirror(state, { candidate: 'none', now: start + 4_000 + DEFAULT_POLICY.releaseMs });
  assert.equal(state.activity, 'none');
  assert.equal(advanceMirror(state, { candidate: 'ai', now: start + 50_000, immediate: true }).activity, 'ai');
  assert.equal(advanceMirror(state, { candidate: 'dancing', now: start }), state, 'unknown categories are ignored');
});

test('agent events: any bounded tool slug, a closed event set, stamped with the caller clock', () => {
  assert.deepEqual({ ...normalizeAgentEvent({ source: 'codex', event: 'stop' }, NOW) }, { source: 'codex', event: 'stop', at: NOW });
  assert.equal(normalizeAgentEvent({ source: 'deepseek-harness', event: 'prompt' }, NOW).source, 'deepseek-harness');
  for (const input of [{ source: 'Claude', event: 'prompt' }, { source: 'x'.repeat(33), event: 'stop' }, { source: '-x', event: 'stop' },
    { source: 'cursor', event: 'tool' }, {}, undefined]) {
    assert.equal(normalizeAgentEvent(input, NOW), null);
  }
});
