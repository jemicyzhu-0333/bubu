'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeEvent,
  hydrateEvent,
  sortDedupeEvents,
  toDayKey,
  dayKeyBefore
} = require('./timeline-repository');
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

// Tier 3: a pure-Node, dependency-free store used only when neither node:sqlite
// nor better-sqlite3 is usable. It is the cost we pay so compatibility never
// lands on the user — no native build, no arch match, runs on any macOS. It is
// slower and has no transactions or indexes; that is acceptable because it only
// starts when the first two tiers are unavailable. It reuses the SQL tiers' pure
// rules verbatim, so callers see identical behaviour, only weaker performance.
function openJsonlStore({ dir, now = () => Date.now(), logger = () => {} } = {}) {
  if (typeof dir !== 'string' || !dir) throw new TypeError('jsonl store requires a directory');
  const timelineDir = path.join(dir, 'timeline');
  fs.mkdirSync(timelineDir, { recursive: true });
  const memoriesFile = path.join(dir, 'memories.json');

  function trace(scope, operation, error) {
    try { logger({ scope, operation, message: error && error.message }); } catch (_) {}
  }

  function writeAtomic(file, text) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  // ---- timeline (append-only, one file per business day) ----
  const dayIdCache = new Map();

  function dayFile(dayKey) {
    return path.join(timelineDir, `${dayKey}.jsonl`);
  }

  function readDayRows(dayKey, strict = false) {
    let text = '';
    try {
      text = fs.readFileSync(dayFile(dayKey), 'utf8');
    } catch (error) {
      if (strict && error.code !== 'ENOENT') throw error;
      return [];
    }
    const rows = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { rows.push(JSON.parse(line)); } catch (error) { if (strict) throw error; /* legacy reads skip torn lines */ }
    }
    return rows;
  }

  function idsForDay(dayKey) {
    let ids = dayIdCache.get(dayKey);
    if (!ids) {
      ids = new Set(readDayRows(dayKey).map(row => row.id));
      dayIdCache.set(dayKey, ids);
    }
    return ids;
  }

  const timeline = Object.freeze({
    supportsConfirmedChanges: false,
    appendConfirmedEvent() { return { ok: false, inserted: false, reason: 'reliable-history-unsupported' }; },
    append(event) {
      const normalized = normalizeEvent(event);
      if (!normalized) return { ok: false, inserted: false, reason: 'invalid-event' };
      try {
        const ids = idsForDay(normalized.dayKey);
        if (ids.has(normalized.id)) return { ok: true, inserted: false };
        fs.appendFileSync(dayFile(normalized.dayKey), `${JSON.stringify(normalized)}\n`);
        ids.add(normalized.id);
        return { ok: true, inserted: true };
      } catch (error) {
        trace('timeline', 'append', error);
        return { ok: false, inserted: false };
      }
    },
    queryRange({ fromDayKey, toDayKey: to } = {}) {
      if (typeof fromDayKey !== 'string' || typeof to !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(fromDayKey) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return { ok: false, availability: 'unavailable', reason: 'range-invalid', items: [] };
      }
      try {
        const events = [];
        for (const name of fs.readdirSync(timelineDir)) {
          if (!name.endsWith('.jsonl')) continue;
          const dayKey = name.slice(0, -'.jsonl'.length);
          if (dayKey < fromDayKey || dayKey > to) continue;
          for (const row of readDayRows(dayKey, true)) {
            if (!normalizeEvent(row)) throw new Error('history-row-invalid');
            events.push(hydrateEvent(row));
          }
        }
        return { ok: true, availability: 'available', items: sortDedupeEvents(events) };
      } catch (error) {
        trace('timeline', 'readRange', error);
        return { ok: false, availability: 'unavailable', reason: 'history-read-failed', items: [] };
      }
    },
    readRange(options) { return timeline.queryRange(options).items; },
    readDay(dayKey) {
      return timeline.readRange({ fromDayKey: dayKey, toDayKey: dayKey });
    },
    // Retraction by exact id, matching the SQL tier. The id does not carry its
    // day, so the day files are scanned — but only through `idsForDay`, whose
    // cache makes the common case a set lookup per day rather than a re-read.
    // Rewriting a whole day file to drop one line is the price of append-only
    // storage; undo is rare, and the alternative (a tombstone line the readers
    // would have to honour) puts the retraction logic in every read path.
    remove(id) {
      if (typeof id !== 'string' || !id) return { ok: false, removed: 0, reason: 'id-required' };
      try {
        for (const name of fs.readdirSync(timelineDir)) {
          if (!name.endsWith('.jsonl')) continue;
          const dayKey = name.slice(0, -'.jsonl'.length);
          if (!idsForDay(dayKey).has(id)) continue;
          const kept = readDayRows(dayKey).filter(row => row && row.id !== id);
          const removed = idsForDay(dayKey).size - kept.length;
          if (kept.length === 0) {
            fs.rmSync(dayFile(dayKey), { force: true });
          } else {
            writeAtomic(dayFile(dayKey), `${kept.map(row => JSON.stringify(row)).join('\n')}\n`);
          }
          dayIdCache.delete(dayKey);
          return { ok: true, removed };
        }
        return { ok: true, removed: 0 };
      } catch (error) {
        trace('timeline', 'remove', error);
        return { ok: false, removed: 0 };
      }
    },
    prune({ before, retentionDays, todayKey } = {}) {
      let cutoff = before;
      if (typeof cutoff !== 'string' || !cutoff) {
        if (!Number.isFinite(retentionDays)) return { ok: false, removed: 0, reason: 'no-cutoff' };
        cutoff = dayKeyBefore(typeof todayKey === 'string' && todayKey ? todayKey : toDayKey(now()), retentionDays);
      }
      try {
        let removed = 0;
        for (const name of fs.readdirSync(timelineDir)) {
          if (!name.endsWith('.jsonl')) continue;
          const dayKey = name.slice(0, -'.jsonl'.length);
          if (dayKey < cutoff) {
            removed += idsForDay(dayKey).size;
            fs.rmSync(path.join(timelineDir, name), { force: true });
            dayIdCache.delete(dayKey);
          }
        }
        return { ok: true, removed, cutoff };
      } catch (error) {
        trace('timeline', 'prune', error);
        return { ok: false, removed: 0 };
      }
    }
  });

  // ---- memories (small mutable document, read-modify-write) ----
  function loadMemories() {
    try {
      return JSON.parse(fs.readFileSync(memoriesFile, 'utf8'));
    } catch (_) {
      return [];
    }
  }

  function saveMemories(list) {
    writeAtomic(memoriesFile, JSON.stringify(list));
  }

  let memoryList = loadMemories();

  function toPublic(memory) {
    return Object.freeze({
      id: memory.id,
      kind: memory.kind,
      subject: memory.subject,
      body: memory.body,
      source: memory.source,
      confidence: Number(memory.confidence),
      createdAt: Number(memory.createdAt),
      updatedAt: Number(memory.updatedAt),
      lastUsedAt: memory.lastUsedAt != null ? Number(memory.lastUsedAt) : null,
      useCount: Number(memory.useCount) || 0,
      expiresAt: memory.expiresAt != null ? Number(memory.expiresAt) : null
    });
  }

  const memories = Object.freeze({
    upsert(entry) {
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
      try {
        const existing = memoryList.find(memory => memory.uniqueKey === uniqueKey);
        if (existing) {
          existing.subject = subject;
          existing.body = body;
          existing.source = entry.source;
          existing.confidence = clampConfidence(entry.confidence);
          existing.updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : timestamp;
          existing.expiresAt = Number.isFinite(entry.expiresAt) ? entry.expiresAt : null;
        } else {
          memoryList.push({
            id,
            uniqueKey,
            kind: entry.kind,
            subject,
            body,
            source: entry.source,
            confidence: clampConfidence(entry.confidence),
            createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : timestamp,
            updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : timestamp,
            lastUsedAt: null,
            useCount: 0,
            expiresAt: Number.isFinite(entry.expiresAt) ? entry.expiresAt : null
          });
        }
        const evict = new Set(capMemories(memoryList, { limit: DEFAULT_TOTAL_CAP, now: timestamp }));
        if (evict.size) memoryList = memoryList.filter(memory => !evict.has(memory.id));
        saveMemories(memoryList);
        return { ok: true, id, uniqueKey };
      } catch (error) {
        trace('memory', 'upsert', error);
        return { ok: false, reason: 'write-failed' };
      }
    },
    list({ kind, limit, includeExpired = false } = {}) {
      const at = now();
      let rows = memoryList.filter(memory => (!kind || memory.kind === kind)
        && (includeExpired || !isExpired(memory, at)));
      rows = rows.sort((a, b) => b.updatedAt - a.updatedAt);
      if (Number.isInteger(limit) && limit > 0) rows = rows.slice(0, limit);
      return rows.map(toPublic);
    },
    forget(memoryId) {
      if (!memoryId) return { ok: false, removed: 0, reason: 'missing-id' };
      const before = memoryList.length;
      memoryList = memoryList.filter(memory => memory.id !== memoryId);
      const removed = before - memoryList.length;
      try { saveMemories(memoryList); } catch (error) { trace('memory', 'forget', error); return { ok: false, removed: 0 }; }
      return { ok: true, removed };
    },
    clear() {
      const removed = memoryList.length;
      memoryList = [];
      try { saveMemories(memoryList); } catch (error) { trace('memory', 'clear', error); return { ok: false, removed: 0 }; }
      return { ok: true, removed };
    },
    selectMemories({ kind, now: at = now(), limit = DEFAULT_SELECT_LIMIT, charBudget = DEFAULT_CHAR_BUDGET, kindWeights } = {}) {
      const scored = memoryList
        .filter(memory => !isExpired(memory, at) && (!kind || memory.kind === kind))
        .map(memory => ({ memory: toPublic(memory), score: scoreMemory(memory, at, kindWeights || {}) }))
        .sort((a, b) => b.score - a.score);
      const chosen = [];
      let usedChars = 0;
      for (const { memory } of scored) {
        if (chosen.length >= limit) break;
        const nextChars = usedChars + memory.body.length;
        if (chosen.length > 0 && nextChars > charBudget) break;
        chosen.push(memory);
        usedChars = nextChars;
      }
      return { memories: chosen, disclosure: { memoryIds: chosen.map(memory => memory.id) } };
    },
    recordUsage(memoryIds, at = now()) {
      const ids = new Set((Array.isArray(memoryIds) ? memoryIds : []).filter(Boolean));
      if (!ids.size) return { ok: true, updated: 0 };
      let updated = 0;
      for (const memory of memoryList) {
        if (ids.has(memory.id)) { memory.useCount = (Number(memory.useCount) || 0) + 1; memory.lastUsedAt = at; updated += 1; }
      }
      try { saveMemories(memoryList); } catch (error) { trace('memory', 'recordUsage', error); return { ok: false, updated: 0 }; }
      return { ok: true, updated };
    },
    pruneExpired(at = now()) {
      const before = memoryList.length;
      memoryList = memoryList.filter(memory => !isExpired(memory, at));
      const removed = before - memoryList.length;
      try { saveMemories(memoryList); } catch (error) { trace('memory', 'pruneExpired', error); return { ok: false, removed: 0 }; }
      return { ok: true, removed };
    },
    recentActivityDigest({ now: at = now(), days = 7, topLimit = 5, resolveTaskTitle = null } = {}) {
      const windowDays = Math.min(30, Math.max(1, Math.trunc(days) || 7));
      const to = dayKeyOf(at);
      const from = dayKeyOf(at - (windowDays - 1) * DAY_MS);
      const events = timeline.readRange({ fromDayKey: from, toDayKey: to });
      const digest = buildRecentActivityDigest(events, { fromDayKey: from, toDayKey: to, topLimit, resolveTaskTitle });
      return { ...digest, disclosure: { fields: DIGEST_FIELDS } };
    }
  });

  return Object.freeze({
    timeline,
    memories,
    close() { /* write-through store: nothing buffered to flush */ }
  });
}

module.exports = { openJsonlStore };
