'use strict';

// The companion mirrors what the person is doing right now — listening to music,
// writing code, or talking to an AI — from coarse local signals
// (ARCHITECTURE「活动镜像」). Pure: the caller supplies samples, agent events and time.
// Nothing here is persisted; only the category ever leaves this module.
const ACTIVITIES = Object.freeze(['none', 'music', 'coding', 'ai']);
// Any plugin-reported tool name is accepted as a bounded slug; only the event is a closed set.
const AGENT_SOURCE_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const AGENT_EVENTS = Object.freeze(['prompt', 'stop']);

const DEFAULT_POLICY = Object.freeze({
  idleMs: 120_000, // nobody at the keyboard: only music keeps a mirror going
  dwellMs: 15_000, // a candidate must hold this long before the companion follows it
  releaseMs: 30_000, // dropping back to nothing waits a little longer
  agentThinkingMs: 10 * 60_000, // a prompt with no matching stop stops counting after this
  agentAnswerMs: 90_000 // after an answer the person is usually still reading or replying
});

function normalizeIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value.trim().toLowerCase() : null;
}

function matches(identifier, patterns) {
  return patterns.some(pattern => {
    const rule = pattern.toLowerCase();
    return rule.endsWith('*') ? identifier.startsWith(rule.slice(0, -1)) : identifier === rule;
  });
}

// Which category an app belongs to on one platform, or null.
function categoryOf(identifier, catalog, platform) {
  const id = normalizeIdentifier(identifier);
  if (!id) return null;
  for (const category of ['ai', 'coding', 'music']) {
    const patterns = catalog[category] && catalog[category][platform];
    if (Array.isArray(patterns) && matches(id, patterns)) return category;
  }
  return null;
}

function agentActive(agent, now, policy) {
  if (!agent || !Number.isFinite(agent.at) || agent.at > now) return false;
  const window = agent.event === 'prompt' ? policy.agentThinkingMs : policy.agentAnswerMs;
  return now - agent.at <= window;
}

// What the signals say at one instant, before any smoothing. Precedence: an agent
// hook (precise) > an AI app in front > an editor or terminal in front > a music
// player that is audible. Away from the keyboard, only music remains.
function rawActivity({ sample, agent, now, catalog, platform, policy = DEFAULT_POLICY }) {
  const idle = !sample || !Number.isFinite(sample.idleMs) || sample.idleMs >= policy.idleMs;
  const audio = sample && Array.isArray(sample.audio) ? sample.audio : [];
  const listening = audio.some(id => categoryOf(id, catalog, platform) === 'music');
  if (!idle) {
    if (agentActive(agent, now, policy)) return 'ai';
    const front = sample && categoryOf(sample.front, catalog, platform);
    if (front === 'ai' || front === 'coding') return front;
  }
  return listening ? 'music' : 'none';
}

// Smoothing: the companion follows a new category only after it held for `dwellMs`
// (`releaseMs` when falling back to none), so alt-tabbing never makes it flicker.
// An agent event is precise and switches at once.
function advanceMirror(previous, { candidate, now, immediate = false, policy = DEFAULT_POLICY }) {
  const state = previous && ACTIVITIES.includes(previous.activity)
    ? previous : { activity: 'none', since: now, pending: null, pendingSince: null };
  if (!ACTIVITIES.includes(candidate)) return state;
  if (candidate === state.activity) {
    return state.pending === null ? state : { ...state, pending: null, pendingSince: null };
  }
  if (immediate) return { activity: candidate, since: now, pending: null, pendingSince: null };
  const pendingSince = state.pending === candidate ? state.pendingSince : now;
  const hold = candidate === 'none' ? policy.releaseMs : policy.dwellMs;
  if (now - pendingSince >= hold) return { activity: candidate, since: now, pending: null, pendingSince: null };
  return { ...state, pending: candidate, pendingSince };
}

// A closed agent event, or null. Anything else a local process sends is ignored.
function normalizeAgentEvent({ source, event } = {}, now) {
  if (typeof source !== 'string' || !AGENT_SOURCE_PATTERN.test(source) || !AGENT_EVENTS.includes(event) || !Number.isFinite(now)) return null;
  return Object.freeze({ source, event, at: now });
}

module.exports = {
  ACTIVITIES, AGENT_SOURCE_PATTERN, AGENT_EVENTS, DEFAULT_POLICY,
  categoryOf, rawActivity, advanceMirror, normalizeAgentEvent
};
