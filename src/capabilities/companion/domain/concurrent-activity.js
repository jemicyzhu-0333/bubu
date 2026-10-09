'use strict';

const { categoryOf, advanceMirror, normalizeAgentEvent, DEFAULT_POLICY } = require('./activity-mirror');
const { EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity } = require('../contract/activity-concurrent.mjs');

const MAX_AGENT_SOURCES = 64;
const EMPTY_AGENT_SIGNALS = Object.freeze([]);

// ARCHITECTURE「活动镜像」: independent, ephemeral source ownership. A stop is an
// answer-complete notification with reading grace, never a clear-all instruction.
function retainAgentSignals(signals, now, policy = DEFAULT_POLICY) {
  return Object.freeze((signals || []).filter(signal => {
    if (!signal || !normalizeAgentEvent(signal, signal.at) || signal.at > now) return false;
    const ttl = signal.event === 'prompt' ? policy.agentThinkingMs : policy.agentAnswerMs;
    return now - signal.at <= ttl;
  }).map(signal => normalizeAgentEvent(signal, signal.at)));
}

function recordAgentSignal(signals, event, now, policy = DEFAULT_POLICY) {
  const current = retainAgentSignals(signals, now, policy);
  const next = normalizeAgentEvent(event, now);
  if (!next) return current;
  return Object.freeze([...current.filter(signal => signal.source !== next.source), next].slice(-MAX_AGENT_SOURCES));
}

// Internal lifecycle operation only. The public hook protocol stays prompt/stop.
function clearAgentSignal(signals, source) {
  return Object.freeze((signals || []).filter(signal => signal.source !== source));
}

function freshActivitySample(sample, now, policy = DEFAULT_POLICY) {
  // Native helpers sample every 2s. The existing 30s release window tolerates a
  // brief restart, but cannot let a stopped helper assert music/front-app forever.
  return sample && Number.isFinite(sample.at) && sample.at <= now
    && now - sample.at <= policy.releaseMs ? sample : null;
}

function settleSource(previous, candidate, now, missingSince, policy) {
  // A delayed main-process tick must account for time already spent stale,
  // rather than starting another full release window after waking.
  const state = Number.isFinite(missingSince) && missingSince < now
    ? advanceMirror(previous, { candidate, now: missingSince, policy }) : previous;
  return Object.freeze(advanceMirror(state, { candidate, now, policy }));
}

function advanceConcurrentActivity(previous, { sample, agents = EMPTY_AGENT_SIGNALS, idleMs, now, catalog, platform, policy = DEFAULT_POLICY }) {
  const fresh = freshActivitySample(sample, now, policy);
  const idle = !Number.isFinite(idleMs) || idleMs >= policy.idleMs;
  const front = !idle && fresh ? categoryOf(fresh.front, catalog, platform) : null;
  const music = Boolean(fresh && Array.isArray(fresh.audio) && fresh.audio.some(id => categoryOf(id, catalog, platform) === 'music'));
  const staleSince = !fresh && sample && Number.isFinite(sample.at) && sample.at <= now ? sample.at + policy.releaseMs : null;
  const idleSince = idle && Number.isFinite(idleMs) ? now - Math.max(0, idleMs - policy.idleMs) : null;
  const frontMissingSince = [staleSince, idleSince].filter(Number.isFinite);
  const musicState = settleSource(previous && previous.music, music ? 'music' : 'none', now, staleSince, policy);
  const frontState = settleSource(previous && previous.front, front === 'ai' || front === 'coding' ? front : 'none', now,
    frontMissingSince.length ? Math.min(...frontMissingSince) : null, policy);
  const liveAgents = retainAgentSignals(agents, now, policy);
  const agentCandidate = !idle && liveAgents.length > 0 ? 'ai' : 'none';
  // A prompt is precise and immediate. A stop received without a preceding
  // visible prompt still follows the existing dwell. TTL/idle ends the source
  // directly rather than inventing another reading grace after its deadline.
  const agentState = Object.freeze(advanceMirror(previous && previous.agent, { candidate: agentCandidate, now, policy,
    immediate: agentCandidate === 'none' || liveAgents.some(signal => signal.event === 'prompt') }));
  const projection = normalizeConcurrentActivity({ v: 1, music: musicState.activity === 'music',
    coding: frontState.activity === 'coding', ai: frontState.activity === 'ai' || agentState.activity === 'ai' });
  return Object.freeze({ music: musicState, front: frontState, agent: agentState, agents: liveAgents, projection });
}

module.exports = { MAX_AGENT_SOURCES, EMPTY_AGENT_SIGNALS, EMPTY_CONCURRENT_ACTIVITY,
  retainAgentSignals, recordAgentSignal, clearAgentSignal, freshActivitySample, advanceConcurrentActivity };
