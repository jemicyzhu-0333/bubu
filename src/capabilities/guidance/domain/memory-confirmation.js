'use strict';

// The other writer of long-term memory (ARCHITECTURE「事实流与长期记忆」: "记忆的写入者只有一个 ——
// guidance 能力"). Where memory-aggregation derives `aggregated` rows from the
// activity digest, this module turns a single user-confirmed statement into one
// `user-confirmed` row.
//
// Pure by construction: `confirmMemory(input, { now })` takes the raw payload
// plus `now` and returns either { ok:false, reason } or { ok:true, entry }. No
// clock beyond `now`, no store, no I/O — so "what a confirmation becomes" is a
// table-driven question a test can ask.
//
// Three invariants this module exists to enforce:
//
// 1. **The user is the source, always.** `source`, `confidence` and `expiresAt`
//    are hardcoded here, never read from the payload. A user-confirmed memory is
//    a fact the person stated about themselves: confidence is 1 (aggregated caps
//    at 0.9 precisely because it is *not* a fact about the person, ARCHITECTURE「事实流与长期记忆」) and it
//    never expires (ARCHITECTURE「事实流与长期记忆」). Letting a surface set these would reopen the door ARCHITECTURE「事实流与长期记忆」
//    closed — "禁止模型自由写记忆" — by allowing a caller to launder model output
//    in as a user fact.
// 2. **Kind is a closed enum.** An open kind is the same as no schema: every new
//    value becomes a bucket nobody scores or expires. The allowlist is owned
//    here, not imported from the persistence layer — capabilities may not depend
//    on platform — and is kept in lockstep with MEMORY_KINDS in memory-rules.js.
// 3. **The three aggregated subjects are refused.** `unique_key` is kind+subject
//    and the aggregated writer re-upserts its three fixed pairs on every daily
//    reset (memory-aggregation.js). A user-confirmed row on any of those pairs
//    would be silently overwritten the next morning and its text lost, so those
//    subjects are rejected here rather than accepted and quietly destroyed.

// Kept in lockstep with MEMORY_KINDS in src/platform/persistence/sqlite/
// memory-rules.js. Duplicated, not imported: capabilities → platform is a
// forbidden layer edge. A test pins the two lists equal.
const CONFIRMABLE_KINDS = Object.freeze(['rhythm', 'friction', 'preference', 'context', 'pattern']);

// The kind+subject pairs the aggregated writer owns (memory-aggregation.js).
// Compared after the same normalization the unique key uses, so casing and
// whitespace variants of a reserved subject are refused too.
const RESERVED_PAIRS = Object.freeze([
  Object.freeze({ kind: 'rhythm', subject: '连续投入的天数' }),
  Object.freeze({ kind: 'pattern', subject: '专注与完成的量' }),
  Object.freeze({ kind: 'friction', subject: '最常出现的卡点' })
]);

const SUBJECT_MAX = 200;
const BODY_MAX = 500;

// The same normalization memory-rules.js applies before building the unique key.
// Duplicated for the same layer reason as the kind list; a test pins it equal.
function normalizeSubject(subject) {
  return String(subject == null ? '' : subject).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, SUBJECT_MAX);
}

function sanitizeBody(body) {
  return String(body == null ? '' : body).replace(/\s+/g, ' ').trim().slice(0, BODY_MAX);
}

function isReservedSubject(kind, subject) {
  const normalized = normalizeSubject(subject);
  return RESERVED_PAIRS.some(pair => pair.kind === kind && normalizeSubject(pair.subject) === normalized);
}

// Turns a user's confirmation into one entry to upsert, or an explained refusal.
// `now` is accepted for symmetry with memory-aggregation and to keep the writer
// clockless; a user-confirmed row has no expiry so it is currently unused.
function confirmMemory(input, { now } = {}) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'input must be an object' };
  if (!CONFIRMABLE_KINDS.includes(input.kind)) {
    return { ok: false, reason: `kind must be one of: ${CONFIRMABLE_KINDS.join(', ')}` };
  }
  const subject = String(input.subject == null ? '' : input.subject).trim();
  if (!subject) return { ok: false, reason: 'subject must be a non-empty string' };
  const body = sanitizeBody(input.body);
  if (!body) return { ok: false, reason: 'body must be a non-empty string' };
  if (isReservedSubject(input.kind, subject)) {
    // These belong to the aggregated writer; accepting one would let the next
    // daily reset silently overwrite it. Refuse rather than lose the user's text.
    return { ok: false, reason: 'this subject is reserved for automatic summaries' };
  }
  return {
    ok: true,
    entry: {
      kind: input.kind,
      subject: subject.slice(0, SUBJECT_MAX),
      body,
      source: 'user-confirmed',
      confidence: 1,
      expiresAt: null
    }
  };
}

module.exports = {
  confirmMemory,
  CONFIRMABLE_KINDS,
  RESERVED_PAIRS,
  SUBJECT_MAX,
  BODY_MAX
};
