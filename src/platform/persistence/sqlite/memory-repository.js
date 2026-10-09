'use strict';

const {
  MEMORY_KINDS,
  MEMORY_SOURCES,
  DIGEST_FIELDS,
  DEFAULT_SELECT_LIMIT,
  DEFAULT_CHAR_BUDGET,
  DEFAULT_TOTAL_CAP,
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
} = require('./memory-rules');

const DAY_MS = 24 * 60 * 60 * 1000;

// Long-term memory over the SQL handle. Every method is failure-tolerant: a
// broken query is traced and swallowed, so a caller never has to guard memory
// writes to keep the focus flow alive (ARCHITECTURE「事实流与长期记忆」).
//
// IMPORTANT (ARCHITECTURE「事实流与长期记忆」): the only write sources are 'user-confirmed' and
// 'aggregated'. The model is never a source. upsert rejects any other source so
// a future caller cannot quietly let generated text accrete as remembered fact.
function createSqlMemoryRepository({ handle, timeline, now = () => Date.now(), logger = () => {}, totalCap = DEFAULT_TOTAL_CAP } = {}) {
  // Once the v4 transaction imports these rows, this adapter is a historical
  // source only. Reopening without the independent forgetting ledger must never
  // reactivate the old writer or its automatic model injection path.
  function cutover() {
    try {
      return Number(handle.get('SELECT COUNT(*) AS count FROM memory_authority').count) > 0
        || Number(handle.get('SELECT COUNT(*) AS count FROM memory_records').count) > 0;
    } catch (_) { return true; }
  }
  function trace(operation, error) {
    try { logger({ scope: 'memory', operation, message: error && error.message }); } catch (_) {}
  }

  function upsert(entry) {
    if (cutover()) return { ok: false, reason: 'memory-authority-cutover' };
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'invalid-entry' };
    if (!MEMORY_KINDS.includes(entry.kind)) return { ok: false, reason: 'unknown-kind' };
    if (!MEMORY_SOURCES.includes(entry.source)) return { ok: false, reason: 'forbidden-source' };
    const subject = normalizeSubject(entry.subject);
    if (!subject) return { ok: false, reason: 'empty-subject' };
    const body = sanitizeBody(entry.body);
    if (!body) return { ok: false, reason: 'empty-body' };

    const uniqueKey = memoryUniqueKey(entry.kind, entry.subject);
    const id = stableId(uniqueKey);
    const timestamp = now();
    const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : timestamp;
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : timestamp;
    const expiresAt = Number.isFinite(entry.expiresAt) ? entry.expiresAt : null;

    try {
      handle.run(
        `INSERT INTO agent_memories
           (id, unique_key, kind, subject, body, source, confidence, created_at, updated_at, last_used_at, use_count, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
         ON CONFLICT(unique_key) DO UPDATE SET
           subject = excluded.subject,
           body = excluded.body,
           source = excluded.source,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
        [id, uniqueKey, entry.kind, subject, body, entry.source,
          clampConfidence(entry.confidence), createdAt, updatedAt, expiresAt]
      );
      enforceCap();
      return { ok: true, id, uniqueKey };
    } catch (error) {
      trace('upsert', error);
      return { ok: false, reason: 'write-failed' };
    }
  }

  function enforceCap() {
    try {
      const rows = handle.all('SELECT id, source, confidence, updated_at AS updatedAt, use_count AS useCount, kind, expires_at AS expiresAt FROM agent_memories');
      const evict = capMemories(rows, { limit: totalCap, now: now() });
      if (evict.length) {
        handle.run(`DELETE FROM agent_memories WHERE id IN (${evict.map(() => '?').join(',')})`, evict);
      }
    } catch (error) {
      trace('enforceCap', error);
    }
  }

  function rowToMemory(row) {
    return Object.freeze({
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      body: row.body,
      source: row.source,
      confidence: Number(row.confidence),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      lastUsedAt: row.lastUsedAt != null ? Number(row.lastUsedAt) : null,
      useCount: Number(row.useCount) || 0,
      expiresAt: row.expiresAt != null ? Number(row.expiresAt) : null
    });
  }

  const SELECT_COLUMNS =
    `id, kind, subject, body, source, confidence, created_at AS createdAt,
     updated_at AS updatedAt, last_used_at AS lastUsedAt, use_count AS useCount, expires_at AS expiresAt`;

  // For the user to see and manage (memory:list). Expired rows are hidden by
  // default; the point of the list is what is currently influencing the model.
  function list({ kind, limit, includeExpired = false } = {}) {
    if (cutover()) return [];
    try {
      const clauses = [];
      const params = [];
      if (kind) { clauses.push('kind = ?'); params.push(kind); }
      if (!includeExpired) { clauses.push('(expires_at IS NULL OR expires_at > ?)'); params.push(now()); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const cap = Number.isInteger(limit) && limit > 0 ? ` LIMIT ${limit}` : '';
      const rows = handle.all(`SELECT ${SELECT_COLUMNS} FROM agent_memories ${where} ORDER BY updated_at DESC${cap}`, params);
      return rows.map(rowToMemory);
    } catch (error) {
      trace('list', error);
      return [];
    }
  }

  function forget(memoryId) {
    if (cutover()) return { ok: false, removed: 0, reason: 'memory-authority-cutover' };
    if (!memoryId) return { ok: false, removed: 0, reason: 'missing-id' };
    try {
      const info = handle.run('DELETE FROM agent_memories WHERE id = ?', [memoryId]);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('forget', error);
      return { ok: false, removed: 0 };
    }
  }

  function clear() {
    if (cutover()) return { ok: false, removed: 0, reason: 'memory-authority-cutover' };
    try {
      const info = handle.run('DELETE FROM agent_memories', []);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('clear', error);
      return { ok: false, removed: 0 };
    }
  }

  // Rule-scored selection with two hard caps: at most `limit` memories and at
  // most `charBudget` characters of body, whichever binds first (ARCHITECTURE「事实流与长期记忆」).
  // The disclosure is built from the same list that is returned, so "what we
  // disclose" and "what we send" cannot drift (ARCHITECTURE「事实流与长期记忆」).
  function selectMemories({ kind, now: at = now(), limit = DEFAULT_SELECT_LIMIT, charBudget = DEFAULT_CHAR_BUDGET, kindWeights } = {}) {
    if (cutover()) return { memories: [], disclosure: { memoryIds: [] }, reason: 'memory-authority-cutover' };
    let rows = [];
    try {
      const clauses = ['(expires_at IS NULL OR expires_at > ?)'];
      const params = [at];
      if (kind) { clauses.push('kind = ?'); params.push(kind); }
      rows = handle.all(`SELECT ${SELECT_COLUMNS} FROM agent_memories WHERE ${clauses.join(' AND ')}`, params);
    } catch (error) {
      trace('selectMemories', error);
      return { memories: [], disclosure: { memoryIds: [] } };
    }
    const scored = rows
      .map(rowToMemory)
      .map(memory => ({ memory, score: scoreMemory(memory, at, kindWeights || {}) }))
      .sort((a, b) => b.score - a.score);

    const memories = [];
    let usedChars = 0;
    for (const { memory } of scored) {
      if (memories.length >= limit) break;
      const nextChars = usedChars + memory.body.length;
      if (memories.length > 0 && nextChars > charBudget) break;
      memories.push(memory);
      usedChars = nextChars;
    }
    return { memories, disclosure: { memoryIds: memories.map(memory => memory.id) } };
  }

  // Called after memory is actually sent, so use_count reflects real use.
  function recordUsage(memoryIds, at = now()) {
    if (cutover()) return { ok: false, updated: 0, reason: 'memory-authority-cutover' };
    const ids = (Array.isArray(memoryIds) ? memoryIds : []).filter(Boolean);
    if (!ids.length) return { ok: true, updated: 0 };
    try {
      const info = handle.run(
        `UPDATE agent_memories SET use_count = use_count + 1, last_used_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
        [at, ...ids]
      );
      return { ok: true, updated: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('recordUsage', error);
      return { ok: false, updated: 0 };
    }
  }

  function pruneExpired(at = now()) {
    if (cutover()) return { ok: false, removed: 0, reason: 'memory-authority-cutover' };
    try {
      const info = handle.run('DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= ?', [at]);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('pruneExpired', error);
      return { ok: false, removed: 0 };
    }
  }

  function recentActivityDigest({ now: at = now(), days = 7, topLimit = 5, resolveTaskTitle = null } = {}) {
    const windowDays = Math.min(30, Math.max(1, Math.trunc(days) || 7));
    const toDayKey = dayKeyOf(at);
    const fromDayKey = dayKeyOf(at - (windowDays - 1) * DAY_MS);
    const events = timeline && typeof timeline.readRange === 'function'
      ? timeline.readRange({ fromDayKey, toDayKey })
      : [];
    const digest = buildRecentActivityDigest(events, { fromDayKey, toDayKey, topLimit, resolveTaskTitle });
    return { ...digest, disclosure: { fields: DIGEST_FIELDS } };
  }

  return Object.freeze({
    upsert, list, forget, clear, selectMemories, recordUsage, pruneExpired, recentActivityDigest
  });
}

module.exports = { createSqlMemoryRepository };
