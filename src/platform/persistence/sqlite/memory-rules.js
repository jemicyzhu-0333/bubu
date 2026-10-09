'use strict';

// Long-term memory (ARCHITECTURE「事实流与长期记忆」), read/written over the driver-neutral handle.
// The pure rules below — subject normalization, unique-key construction, the
// scoring function, cap eviction and the recent-activity digest — are exported
// so the JSONL fallback and both callers share one definition of "what is
// remembered and what gets sent to the model".

const DAY_MS = 24 * 60 * 60 * 1000;

// A frozen enum, not an open string. An open kind is the same as no schema:
// every new value silently becomes a bucket nobody scores or expires (ARCHITECTURE「事实流与长期记忆」).
const MEMORY_KINDS = Object.freeze(['rhythm', 'friction', 'preference', 'context', 'pattern']);
// The model is deliberately absent. Only the user (confirmed) or deterministic
// aggregation may write memory; letting the model "remember" accretes a layer of
// hallucination that reinforces itself on every later injection (ARCHITECTURE「事实流与长期记忆」).
const MEMORY_SOURCES = Object.freeze(['user-confirmed', 'aggregated']);

const DEFAULT_SELECT_LIMIT = 8;
const DEFAULT_CHAR_BUDGET = 1200;
const DEFAULT_TOTAL_CAP = 500;
const RECENCY_HALFLIFE_MS = 30 * DAY_MS;
const RECENCY_FLOOR = 0.2;

// Event-kind vocabulary the digest reads. The timeline (progress/timeline-facts)
// owns the authoritative list: focused time is recorded as `session.segment` bars
// that carry durationMs, while `session.completed` is a point with no duration.
// Reading only the point kinds is how the digest used to report 0 minutes for
// every week. The legacy `focus.*` names stay readable; an unknown kind simply
// contributes nothing rather than throwing.
const FOCUS_DURATION_KINDS = Object.freeze(['session.segment', 'focus.completed', 'focus.session']);
const FOCUS_SESSION_KINDS = Object.freeze([...FOCUS_DURATION_KINDS, 'session.completed']);
const TASK_COMPLETED_KINDS = Object.freeze(['task.completed']);
const ABANDON_KINDS = Object.freeze(['focus.abandoned', 'session.abandoned']);
const FRICTION_KINDS = Object.freeze(['task.stuck', 'task.avoided', 'task.deferred']);
const DIGEST_FIELDS = Object.freeze([
  'range', 'focusMinutes', 'sessionCount', 'completedTaskCount',
  'abandonedSessionCount', 'topTasks', 'frictionSignals', 'streakDays'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalizeSubject(subject) {
  return String(subject == null ? '' : subject).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

function memoryUniqueKey(kind, subject) {
  return `${kind}::${normalizeSubject(subject)}`;
}

// ≤ 500 chars, newlines collapsed (ARCHITECTURE「事实流与长期记忆」): a memory is one injected line, not
// a paragraph that can push the actual task out of the prompt.
function sanitizeBody(body) {
  return String(body == null ? '' : body).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Stable non-crypto id derived from the unique key, so re-upserting the same
// fact keeps the same id without pulling in randomUUID.
function stableId(uniqueKey) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uniqueKey.length; i += 1) {
    hash ^= uniqueKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mem_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function recencyDecay(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const decayed = Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS);
  return Math.max(RECENCY_FLOOR, Math.min(1, decayed));
}

function scoreMemory(memory, now, kindWeights = {}) {
  const confidence = clampConfidence(memory.confidence);
  const recency = recencyDecay(now - Number(memory.updatedAt || memory.updated_at || 0));
  const weight = Number.isFinite(kindWeights[memory.kind]) ? kindWeights[memory.kind] : 1;
  const useCount = Math.max(0, Number(memory.useCount != null ? memory.useCount : memory.use_count) || 0);
  const useBoost = 1 + Math.min(useCount, 10) / 20;
  return confidence * recency * weight * useBoost;
}

function isExpired(memory, now) {
  const expiresAt = memory.expiresAt != null ? memory.expiresAt : memory.expires_at;
  return expiresAt != null && Number(expiresAt) <= now;
}

// Returns the ids to evict so the total falls to `limit`. user-confirmed memory
// is protected unless it has expired; everything else is evictable lowest-score
// first (ARCHITECTURE「事实流与长期记忆」).
function capMemories(memories, { limit = DEFAULT_TOTAL_CAP, now } = {}) {
  if (memories.length <= limit) return [];
  const evictable = memories
    .filter(memory => memory.source !== 'user-confirmed' || isExpired(memory, now))
    .map(memory => ({ id: memory.id, score: scoreMemory(memory, now) }))
    .sort((a, b) => a.score - b.score);
  const removeCount = Math.min(evictable.length, memories.length - limit);
  return evictable.slice(0, removeCount).map(entry => entry.id);
}

function dayKeyOf(epochMs) {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Deterministic summary of "what we did lately", computed straight from events
// so it is always consistent with the real data and never a stale cache (ARCHITECTURE「事实流与长期记忆」).
// Returns an all-zero shape (not null) when there are no events (test ARCHITECTURE「事实流与长期记忆」).
//
// Task titles are resolved on this machine (`resolveTaskTitle(taskId)`), with a
// title carried in the event payload as the fallback. A task whose title cannot
// be resolved is left out: an opaque id tells the model nothing and is still an
// identifier leaving the machine.
function buildRecentActivityDigest(events, { fromDayKey, toDayKey, topLimit = 5, resolveTaskTitle = null } = {}) {
  const focusByTask = new Map();
  const frictionByKind = new Map();
  const focusDays = new Set();
  const sessions = new Set();
  let anonymousSessions = 0;
  let focusMinutes = 0;
  let completedTaskCount = 0;
  let abandonedSessionCount = 0;

  const taskEntry = (event) => {
    const prior = focusByTask.get(event.taskId) || { taskId: event.taskId, title: '', minutes: 0, completed: false };
    if (!prior.title && event.payload && isNonEmptyString(event.payload.title)) prior.title = event.payload.title;
    focusByTask.set(event.taskId, prior);
    return prior;
  };

  for (const event of events) {
    if (FOCUS_SESSION_KINDS.includes(event.kind)) {
      // One session may settle into several segments (pauses, midnight), so
      // sessions are counted by id; legacy rows without an id count once each.
      if (isNonEmptyString(event.sessionId)) sessions.add(event.sessionId);
      else anonymousSessions += 1;
    }
    if (FOCUS_DURATION_KINDS.includes(event.kind)) {
      const minutes = Number.isFinite(event.durationMs) && event.durationMs > 0 ? event.durationMs / 60000 : 0;
      focusMinutes += minutes;
      if (minutes > 0 && event.dayKey) focusDays.add(event.dayKey);
      if (isNonEmptyString(event.taskId)) taskEntry(event).minutes += minutes;
    }
    if (TASK_COMPLETED_KINDS.includes(event.kind)) {
      completedTaskCount += 1;
      if (isNonEmptyString(event.taskId)) taskEntry(event).completed = true;
    }
    if (ABANDON_KINDS.includes(event.kind)) abandonedSessionCount += 1;
    if (FRICTION_KINDS.includes(event.kind)) {
      frictionByKind.set(event.kind, (frictionByKind.get(event.kind) || 0) + 1);
    }
  }

  const titleOf = (task) => {
    let resolved = null;
    if (typeof resolveTaskTitle === 'function') {
      try { resolved = resolveTaskTitle(task.taskId); } catch (_) { resolved = null; }
    }
    const title = isNonEmptyString(resolved) ? resolved : task.title;
    return isNonEmptyString(title) ? title.trim().slice(0, 200) : null;
  };
  const topTasks = [...focusByTask.values()]
    .map(task => ({ ...task, title: titleOf(task) }))
    .filter(task => task.title)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, topLimit)
    .map(task => ({ title: task.title, focusMinutes: Math.round(task.minutes), completed: task.completed }));
  const frictionSignals = [...frictionByKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topLimit);

  return Object.freeze({
    range: Object.freeze({ fromDayKey: fromDayKey || null, toDayKey: toDayKey || null }),
    focusMinutes: Math.round(focusMinutes),
    sessionCount: sessions.size + anonymousSessions,
    completedTaskCount,
    abandonedSessionCount,
    topTasks: Object.freeze(topTasks),
    frictionSignals: Object.freeze(frictionSignals),
    streakDays: countStreakDays(focusDays, toDayKey)
  });
}

// Consecutive days with focus ending at the window's last day.
function countStreakDays(focusDays, toDayKey) {
  if (!focusDays.size || !isNonEmptyString(toDayKey)) return 0;
  const [y, m, d] = toDayKey.split('-').map(Number);
  let cursor = Date.UTC(y, (m || 1) - 1, d || 1);
  let streak = 0;
  while (streak < 3650) {
    const date = new Date(cursor);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (!focusDays.has(key)) break;
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

module.exports = {
  MEMORY_KINDS,
  MEMORY_SOURCES,
  DIGEST_FIELDS,
  DEFAULT_SELECT_LIMIT,
  DEFAULT_CHAR_BUDGET,
  DEFAULT_TOTAL_CAP,
  FOCUS_SESSION_KINDS,
  FOCUS_DURATION_KINDS,
  normalizeSubject,
  memoryUniqueKey,
  sanitizeBody,
  clampConfidence,
  stableId,
  scoreMemory,
  isExpired,
  capMemories,
  buildRecentActivityDigest,
  dayKeyOf
};
