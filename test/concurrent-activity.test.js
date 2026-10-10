'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { companion } = require('../src/capabilities');
const { normalizeConcurrentActivity, EMPTY_CONCURRENT_ACTIVITY } = require('../src/capabilities/companion/contract/activity-concurrent.mjs');
const { ACTIVITY_APPS } = require('../src/content/activity-apps');
const { DEFAULT_POLICY, normalizeAgentEvent } = companion.activityMirror;
const { advanceConcurrentActivity, recordAgentSignal, retainAgentSignals, clearAgentSignal, freshActivitySample, MAX_AGENT_SOURCES } = companion.concurrentActivity;
const NOW = 1_800_000_000_000;
const sample = (at, front = 'com.microsoft.VSCode', audio = ['com.spotify.client']) => ({ at, front, audio });
const step = (previous, input) => advanceConcurrentActivity(previous,
  { now: NOW, sample: sample(NOW), idleMs: 1_000, catalog: ACTIVITY_APPS, platform: 'darwin', ...input });

test('concurrent projection is a closed versioned immutable contract, including its empty form', () => {
  const valid = { v: 1, music: true, coding: false, ai: true };
  const normalized = normalizeConcurrentActivity(valid);
  assert.deepEqual(normalized, valid);
  assert.notEqual(normalized, valid);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(EMPTY_CONCURRENT_ACTIVITY));
  valid.music = false;
  assert.equal(normalized.music, true, 'projection is detached from its caller');
  const invalid = [null, undefined, [], true, 'ai', {}, { ...valid, v: 2 }, { ...valid, v: '1' },
    { ...valid, music: 1 }, { ...valid, ai: null }, { v: 1, music: false, ai: false },
    { ...valid, source: 'codex' }, { ...valid, at: NOW }, { ...valid, expiresAt: NOW },
    { ...valid, content: 'not accepted' }, { ...valid, [Symbol('extra')]: false },
    Object.assign(Object.create({ extra: true }), valid)];
  for (const value of invalid) assert.equal(normalizeConcurrentActivity(value), null);
  assert.deepEqual(normalizeConcurrentActivity(Object.assign(Object.create(null), valid)), valid);
});

test('browser facade exposes only the concurrent read-only contract', async () => {
  const facade = await import('../src/capabilities/companion/index.mjs');
  assert.equal(facade.EMPTY_CONCURRENT_ACTIVITY, EMPTY_CONCURRENT_ACTIVITY);
  assert.equal(facade.normalizeConcurrentActivity, normalizeConcurrentActivity);
  assert.equal(facade.recordAgentSignal, undefined);
});

test('music, front-app coding and hooked AI settle independently with unchanged precedence inputs', () => {
  let state = step(null, {});
  assert.deepEqual(state.projection, EMPTY_CONCURRENT_ACTIVITY);
  state = step(state, { now: NOW + DEFAULT_POLICY.dwellMs, sample: sample(NOW + DEFAULT_POLICY.dwellMs) });
  assert.deepEqual(state.projection, { v: 1, music: true, coding: true, ai: false });
  const agents = recordAgentSignal([], { source: 'codex', event: 'prompt' }, NOW + 16_000);
  state = step(state, { now: NOW + 16_000, agents, sample: sample(NOW + 16_000) });
  assert.deepEqual(state.projection, { v: 1, music: true, coding: true, ai: true });
  const frontSince = state.front.since;
  const repeated = recordAgentSignal(agents, { source: 'codex', event: 'prompt' }, NOW + 18_000);
  const refreshed = step(state, { now: NOW + 18_000, agents: repeated, sample: sample(NOW + 18_000) });
  assert.deepEqual(refreshed.projection, state.projection);
  assert.equal(refreshed.front.since, frontSince, 'refreshing a source does not restart settled activity');
  assert.ok(Object.isFrozen(refreshed) && Object.isFrozen(refreshed.agents) && Object.isFrozen(refreshed.agents[0]));
});

test('one source stop clears only its prompt; duplicate or unknown stops never create activity', () => {
  let signals = recordAgentSignal([], { source: 'codex', event: 'prompt' }, NOW);
  signals = recordAgentSignal(signals, { source: 'cursor', event: 'prompt' }, NOW + 1_000);
  signals = recordAgentSignal(signals, { source: 'codex', event: 'stop' }, NOW + 2_000);
  assert.deepEqual(signals.map(({ source, event }) => ({ source, event })), [{ source: 'cursor', event: 'prompt' }]);
  signals = recordAgentSignal(signals, { source: 'codex', event: 'stop' }, NOW + 3_000);
  signals = recordAgentSignal(signals, { source: 'unknown-tool', event: 'stop' }, NOW + 3_000);
  assert.deepEqual(signals.map(signal => signal.source), ['cursor']);
  assert.equal(step(null, { now: NOW + 100_000, agents: signals }).projection.ai, true, 'other source still owns AI');
  assert.deepEqual(clearAgentSignal(signals, 'codex').map(signal => signal.source), ['cursor']);
  assert.deepEqual(clearAgentSignal(signals, 'cursor'), []);
  assert.equal(signals.length, 1, 'clearing returns a new immutable source set');
  assert.deepEqual(retainAgentSignals(signals, NOW + 1_001 + DEFAULT_POLICY.agentThinkingMs), []);
  assert.equal(normalizeAgentEvent({ source: 'codex', event: 'clear' }, NOW), null, 'no external protocol expansion');
});

test('repeated prompt refreshes only its own deadline and expiring sources never reactivate', () => {
  let signals = recordAgentSignal([], { source: 'codex', event: 'prompt' }, NOW);
  signals = recordAgentSignal(signals, { source: 'cursor', event: 'prompt' }, NOW);
  signals = recordAgentSignal(signals, { source: 'codex', event: 'prompt' }, NOW + DEFAULT_POLICY.agentThinkingMs);
  const stillLive = retainAgentSignals(signals, NOW + DEFAULT_POLICY.agentThinkingMs + 1);
  assert.deepEqual(stillLive.map(signal => signal.source), ['codex']);
  const expired = retainAgentSignals(stillLive, NOW + 2 * DEFAULT_POLICY.agentThinkingMs + 1);
  assert.deepEqual(expired, []);
  assert.deepEqual(retainAgentSignals(expired, NOW), [], 'clock reversal cannot resurrect a pruned source');
});

test('an isolated or completed stop stays inactive; a subsequent prompt starts a fresh source', () => {
  let agents = recordAgentSignal([], { source: 'codex', event: 'stop' }, NOW);
  assert.deepEqual(agents, []);
  let state = step(null, { sample: null, agents });
  state = step(state, { now: NOW + DEFAULT_POLICY.dwellMs, sample: null, agents });
  assert.equal(state.projection.ai, false);
  agents = recordAgentSignal(agents, { source: 'codex', event: 'prompt' }, NOW + 20_000);
  state = step(state, { now: NOW + 20_000, sample: null, agents });
  assert.equal(state.projection.ai, true);
  agents = recordAgentSignal(agents, { source: 'codex', event: 'stop' }, NOW + 20_001);
  state = step(state, { now: NOW + 20_001, sample: null, agents });
  assert.equal(state.projection.ai, false);
});

test('a bounded ephemeral source set never keeps arbitrary tool history', () => {
  let signals = [];
  for (let index = 0; index < MAX_AGENT_SOURCES + 5; index += 1) {
    signals = recordAgentSignal(signals, { source: `tool-${index}`, event: 'prompt' }, NOW + index);
  }
  assert.equal(signals.length, MAX_AGENT_SOURCES);
  assert.equal(signals[0].source, 'tool-5');
  assert.deepEqual(retainAgentSignals(signals, NOW + 2 * DEFAULT_POLICY.agentThinkingMs), []);
});

test('front-app switches retain their own dwell while stopping music releases just music', () => {
  let state = step(null, {});
  state = step(state, { now: NOW + 15_000, sample: sample(NOW + 15_000) });
  state = step(state, { now: NOW + 16_000, sample: sample(NOW + 16_000, 'com.openai.chat', []) });
  assert.deepEqual(state.projection, { v: 1, music: true, coding: true, ai: false });
  state = step(state, { now: NOW + 31_000, sample: sample(NOW + 31_000, 'com.openai.chat', []) });
  assert.deepEqual(state.projection, { v: 1, music: true, coding: true, ai: false });
  state = step(state, { now: NOW + 46_000, sample: sample(NOW + 46_000, 'com.openai.chat', []) });
  assert.deepEqual(state.projection, { v: 1, music: false, coding: false, ai: false });
});

test('stale samples lose authority after the release window and delayed ticks cannot extend it forever', () => {
  const last = sample(NOW + 15_000);
  let state = step(null, {});
  state = step(state, { now: last.at, sample: last });
  assert.equal(freshActivitySample(last, last.at + DEFAULT_POLICY.releaseMs), last);
  assert.equal(freshActivitySample(last, last.at + DEFAULT_POLICY.releaseMs + 1), null);
  assert.equal(freshActivitySample(last, last.at - 1), null);
  state = step(state, { now: last.at + DEFAULT_POLICY.releaseMs + 1, sample: last });
  assert.equal(state.projection.music, true, 'source release is smoothed after freshness ends');
  state = step(state, { now: last.at + 2 * DEFAULT_POLICY.releaseMs, sample: last });
  assert.deepEqual(state.projection, EMPTY_CONCURRENT_ACTIVITY);
  let delayed = step(null, {});
  delayed = step(delayed, { now: last.at, sample: last });
  delayed = step(delayed, { now: last.at + 600_000, sample: last });
  assert.deepEqual(delayed.projection, EMPTY_CONCURRENT_ACTIVITY, 'one late tick accounts for elapsed stale time');
});

test('live idle suppresses agent AI and front work while fresh audio survives; agent does not depend on a working probe', () => {
  const agents = recordAgentSignal([], { source: 'codex', event: 'prompt' }, NOW);
  assert.equal(step(null, { sample: null, agents }).projection.ai, true);
  assert.equal(step(null, { sample: null, agents, idleMs: Infinity }).projection.ai, false);
  let state = step(null, { agents });
  state = step(state, { now: NOW + 15_000, sample: sample(NOW + 15_000), agents });
  state = step(state, { now: NOW + 200_000, sample: sample(NOW + 200_000), agents, idleMs: 200_000 });
  assert.deepEqual(state.projection, { v: 1, music: true, coding: false, ai: false });
  state = step(state, { now: NOW + 201_000, sample: sample(NOW + 201_000), agents, idleMs: 0 });
  assert.equal(state.projection.ai, true, 'still-live hook resumes only when current idle state permits it');
  assert.equal(state.projection.coding, false, 'front app must dwell again after idle release');
});

test('unknown/browser audio and front applications cannot create extra categories', () => {
  let state = step(null, { sample: sample(NOW, 'com.google.Chrome', ['com.google.Chrome.helper']) });
  state = step(state, { now: NOW + 20_000, sample: sample(NOW + 20_000, 'zoom.us', ['zoom.us']) });
  assert.deepEqual(state.projection, EMPTY_CONCURRENT_ACTIVITY);
});
