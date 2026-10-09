'use strict';

// Timeline facts use the driver-neutral SQLite handle. Routine corrections
// are versioned; other events retain their append-only identity.

const { isDeepStrictEqual } = require('node:util');
const { validateAiChangeEvent } = require('../../../core/ai-change-event-contract');

const { ROUTINE_LOGGABLE_STATUSES } = require('../../../core/routine-model');
const { ROUTINE_KINDS } = require('../../../content/energy-effects.mjs');

const ENVELOPE_COLUMNS = Object.freeze({ schemaVersion: 'schema_version', receivedAt: 'received_at',
  timezone: 'timezone', utcOffsetMinutes: 'utc_offset_minutes', localDayKey: 'local_day_key', actor: 'actor',
  source: 'source', correlationId: 'correlation_id', causationId: 'causation_id', commandId: 'command_id',
  entityVersion: 'entity_version', visibility: 'visibility', redactionState: 'redaction_state' });
const ENVELOPE_SELECT = Object.entries(ENVELOPE_COLUMNS).map(([key, column]) => `${column} AS ${key}`).join(', ');
const SELECT_EVENT = `SELECT id, occurred_at AS occurredAt, day_key AS dayKey, kind,
  task_id AS taskId, session_id AS sessionId, duration_ms AS durationMs, payload, ${ENVELOPE_SELECT} FROM timeline_events`;
function routineRevision(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
}

function isRoutineLog(event) {
  const payload = event.payload;
  return event.kind === 'routine.logged' && payload && typeof payload === 'object'
    && isNonEmptyString(payload.routineId) && isNonEmptyString(payload.occurrenceId)
    && payload.occurrenceId.startsWith(`${payload.routineId}:`)
    && event.id === `routine.logged:${payload.occurrenceId}:v1`
    && (payload.kind === undefined || ROUTINE_KINDS.includes(payload.kind))
    && ROUTINE_LOGGABLE_STATUSES.includes(payload.status) && typeof payload.scheduled === 'boolean'
    && Object.keys(payload).every(key => ['routineId', 'kind', 'occurrenceId', 'status', 'scheduled'].includes(key))
    && event.taskId === null && event.sessionId === null && event.durationMs === null
    && Object.keys(ENVELOPE_COLUMNS).every(key => key === 'entityVersion' || event[key] === null);
}

function envelope(value) {
  return Object.fromEntries(Object.keys(ENVELOPE_COLUMNS).map(key => [key, value[key] ?? null]));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A local business day. The caller owns the calendar when it appends (it passes
// dayKey), so this is only used to derive a default retention cutoff.
function toDayKey(epochMs) {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// The oldest day that survives a retention window. Day-granular, so UTC date
// math is exact for counting whole days regardless of DST.
function dayKeyBefore(todayKey, retentionDays) {
  const [y, m, d] = String(todayKey).split('-').map(Number);
  const base = Date.UTC(y, (m || 1) - 1, d || 1);
  return toDayKeyUtc(base - Math.max(0, retentionDays) * DAY_MS);
}

function toDayKeyUtc(epochMs) {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Returns a frozen normalized event or null. Kept strict so a malformed append
// is dropped at the door rather than written and tripping a reader later.
function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (!isNonEmptyString(event.id)) return null;
  if (!Number.isFinite(event.occurredAt)) return null;
  if (!isNonEmptyString(event.dayKey)) return null;
  if (!isNonEmptyString(event.kind)) return null;
  let payload = '{}';
  if (event.payload !== undefined && event.payload !== null) {
    try {
      payload = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);
    } catch (_) {
      return null;
    }
  }
  return Object.freeze({
    ...envelope(event),
    id: event.id,
    occurredAt: Math.trunc(event.occurredAt),
    dayKey: event.dayKey,
    kind: event.kind,
    taskId: isNonEmptyString(event.taskId) ? event.taskId : null,
    sessionId: isNonEmptyString(event.sessionId) ? event.sessionId : null,
    durationMs: Number.isFinite(event.durationMs) ? Math.trunc(event.durationMs) : null,
    payload
  });
}

// Read shape: payload parsed back to an object, ordering stable. Dedupe keeps
// the first occurrence of an id, matching INSERT OR IGNORE (first write wins).
function hydrateEvent(row) {
  let payload = {};
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
  } catch (_) {
    payload = {};
  }
  return Object.freeze({
    ...envelope(row),
    id: row.id,
    occurredAt: Number(row.occurredAt),
    dayKey: row.dayKey,
    kind: row.kind,
    taskId: row.taskId != null ? row.taskId : null,
    sessionId: row.sessionId != null ? row.sessionId : null,
    durationMs: row.durationMs != null ? Number(row.durationMs) : null,
    payload
  });
}

function sortDedupeEvents(events) {
  const seen = new Set();
  const kept = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    kept.push(event);
  }
  kept.sort((a, b) => (a.occurredAt - b.occurredAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return kept;
}

function createSqlTimelineRepository({ handle, logger = () => {}, now = () => Date.now() }) {
  function trace(operation, error) {
    // Post-commit history is not the source of truth (ARCHITECTURE「事实流与长期记忆」), so a repo
    // error is logged and swallowed — the caller never wraps this in try/catch.
    try { logger({ scope: 'timeline', operation, message: error && error.message }); } catch (_) {}
  }

  function append(event) {
    const normalized = normalizeEvent(event);
    if (!normalized) return { ok: false, inserted: false, reason: 'invalid-event' };
    try {
      const info = handle.run(
        `INSERT OR IGNORE INTO timeline_events
          (id, occurred_at, day_key, kind, task_id, session_id, duration_ms, payload, ${Object.values(ENVELOPE_COLUMNS).join(', ')})
         VALUES (${Array(8 + Object.keys(ENVELOPE_COLUMNS).length).fill('?').join(', ')})`,
        [normalized.id, normalized.occurredAt, normalized.dayKey, normalized.kind,
          normalized.taskId, normalized.sessionId, normalized.durationMs, normalized.payload,
          ...Object.keys(ENVELOPE_COLUMNS).map(key => normalized[key])]
      );
      return { ok: true, inserted: Number(info && info.changes) > 0 };
    } catch (error) {
      trace('append', error);
      return { ok: false, inserted: false };
    }
  }

  function appendConfirmedEvent(event) {
    let expected;
    try { expected = validateAiChangeEvent(event); }
    catch (_) { return { ok: false, inserted: false, reason: 'invalid-event' }; }
    try {
      // INSERT OR IGNORE is only the racing insert primitive. Readback and full
      // value comparison, never the change count alone, authorize delivery ack.
      const result = append(expected);
      if (!result.ok) return { ...result, reason: 'history-write-failed' };
      const row = handle.get(`${SELECT_EVENT} WHERE id = ?`, [expected.id]);
      if (!row || !isDeepStrictEqual(hydrateEvent(row), expected)) {
        return { ok: false, inserted: false, reason: 'event-id-conflict' };
      }
      return result.inserted ? result : { ok: true, inserted: false, verifiedDuplicate: true };
    } catch (error) {
      trace('append-confirmed', error);
      return { ok: false, inserted: false, reason: 'history-write-failed' };
    }
  }

  // A canonical privacy command may monotonically hide an already delivered
  // receipt. It cannot rewrite an event identity, time, payload or causal chain.
  function redactReceipt(receiptId) {
    if (!isNonEmptyString(receiptId)) return { ok: false, reason: 'receipt-id-required' };
    try {
      const rows = handle.all(`${SELECT_EVENT} WHERE source = ?`, ['ai-collaboration']);
      let updated = 0;
      for (const row of rows) {
        if (hydrateEvent(row).payload.receiptId !== receiptId) continue;
        updated += Number(handle.run(`UPDATE timeline_events SET visibility = 'private', redaction_state = 'redacted' WHERE id = ?`, [row.id]).changes) || 0;
      }
      return { ok: true, updated };
    } catch (error) { trace('redact-receipt', error); return { ok: false, reason: 'history-write-failed' }; }
  }

  function queryRange({ fromDayKey, toDayKey: to } = {}) {
    if (!isNonEmptyString(fromDayKey) || !isNonEmptyString(to)) {
      return { ok: false, availability: 'unavailable', reason: 'range-invalid', items: [] };
    }
    try {
      const rows = handle.all(
        `${SELECT_EVENT} WHERE day_key >= ? AND day_key <= ? ORDER BY occurred_at ASC, id ASC`,
        [fromDayKey, to]
      );
      return { ok: true, availability: 'available', items: sortDedupeEvents(rows.map(hydrateEvent)) };
    } catch (error) {
      trace('readRange', error);
      return { ok: false, availability: 'unavailable', reason: 'history-read-failed', items: [] };
    }
  }

  function readRange(options) { return queryRange(options).items; }

  function readDay(dayKey) {
    return readRange({ fromDayKey: dayKey, toDayKey: dayKey });
  }

  // The one retraction this store allows, and only by exact id. ARCHITECTURE「日常与能量」 requires a
  // routine tap to be undoable, and an undo that leaves "09:03 已服药" standing in
  // permanent history is the mis-tap the user cannot correct — the same failure
  // `undoOccurrence` removes the log entry to avoid, seen one table over.
  //
  // Deliberately not a general delete: no kind filter, no day filter, no predicate.
  // History is append-only except where a command that already exists can name the
  // single row it is retracting.
  function remove(id) {
    if (!isNonEmptyString(id)) return { ok: false, removed: 0, reason: 'id-required' };
    try {
      const info = handle.run('DELETE FROM timeline_events WHERE id = ?', [id]);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('remove', error);
      return { ok: false, removed: 0 };
    }
  }

  // Deletes rows strictly older than the cutoff day; the boundary day is kept
  // (ARCHITECTURE「事实流与长期记忆」). Caller may pass an explicit `before` cutoff, or a
  // retention window that is resolved against today.
  function prune({ before, retentionDays, todayKey } = {}) {
    let cutoff = before;
    if (!isNonEmptyString(cutoff)) {
      if (!Number.isFinite(retentionDays)) return { ok: false, removed: 0, reason: 'no-cutoff' };
      cutoff = dayKeyBefore(isNonEmptyString(todayKey) ? todayKey : toDayKey(now()), retentionDays);
    }
    try {
      const info = handle.run('DELETE FROM timeline_events WHERE day_key < ?', [cutoff]);
      return { ok: true, removed: Number(info && info.changes) || 0, cutoff };
    } catch (error) {
      trace('prune', error);
      return { ok: false, removed: 0 };
    }
  }


  // A correction replaces one routine point, never an AI receipt or another
  // append-only event. A single CAS updates status, time and version together.
  function upsertRoutineLogged(event) {
    const normalized = normalizeEvent(event);
    const revision = normalized && routineRevision(normalized.entityVersion);
    const expected = normalized && hydrateEvent(normalized);
    if (!revision || typeof normalized.payload !== 'string' || normalized.payload.length > 1024 || !isRoutineLog(expected)) return { ok: false, reason: 'invalid-routine-event' };
    try {
      let row = handle.get(`${SELECT_EVENT} WHERE id = ?`, [normalized.id]);
      if (!row) {
        const inserted = append(normalized);
        if (!inserted.ok || inserted.inserted) return inserted;
        row = handle.get(`${SELECT_EVENT} WHERE id = ?`, [normalized.id]);
      }
      if (!row) return { ok: false, reason: 'history-write-failed' };
      const current = hydrateEvent(row);
      const previousRevision = current.entityVersion === null ? 0 : routineRevision(current.entityVersion);
      if (!isRoutineLog(current) || current.payload.routineId !== expected.payload.routineId || previousRevision === null) {
        return { ok: false, reason: 'event-id-conflict' };
      }
      if (revision < previousRevision) return { ok: false, reason: 'stale-event-revision' };
      if (revision === previousRevision) return isDeepStrictEqual(current, expected)
        ? { ok: true, inserted: false, updated: false, verifiedDuplicate: true }
        : { ok: false, reason: 'event-revision-conflict' };
      const result = handle.run(`UPDATE timeline_events SET occurred_at = ?, day_key = ?, payload = ?, entity_version = ?
        WHERE id = ? AND kind = 'routine.logged' AND entity_version IS ?`,
      [normalized.occurredAt, normalized.dayKey, normalized.payload, normalized.entityVersion, normalized.id, current.entityVersion]);
      return Number(result?.changes) === 1 ? { ok: true, inserted: false, updated: true }
        : { ok: false, reason: 'event-revision-conflict' };
    } catch (error) {
      trace('upsert-routine', error);
      return { ok: false, reason: 'history-write-failed' };
    }
  }

  return Object.freeze({ supportsConfirmedChanges: true, append, upsertRoutineLogged, appendConfirmedEvent, redactReceipt, readRange, queryRange, readDay, remove, prune });
}

module.exports = {
  createSqlTimelineRepository,
  normalizeEvent,
  hydrateEvent,
  sortDedupeEvents,
  toDayKey,
  dayKeyBefore
};
