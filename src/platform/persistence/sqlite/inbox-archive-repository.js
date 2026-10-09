'use strict';

// Resolved inbox captures, moved out of config.json so the document store stays
// bounded (ARCHITECTURE「收件分类与原文历史」). The document keeps a capture until this
// repository confirms the copy; only then does a second commit release it, so a
// failed write here never loses the original text.
//
// Order is the history order: newest capture first, id ascending on ties. Paging is
// keyset-based so the document's not-yet-archived rows can be merged in exactly.

const MAX_PAGE = 100;
const MAX_ID_LIST = 500;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || !isNonEmptyString(record.id)) return null;
  if (!isNonEmptyString(record.text) || !Number.isSafeInteger(record.createdAt)) return null;
  const resolution = record.resolution;
  if (!resolution || !isNonEmptyString(resolution.action) || !isNonEmptyString(resolution.category)
      || !Number.isSafeInteger(resolution.at)) return null;
  const classification = record.classification || null;
  return {
    id: record.id,
    text: record.text,
    createdAt: record.createdAt,
    category: resolution.category,
    routineKind: classification && isNonEmptyString(classification.routineKind) ? classification.routineKind : null,
    level: classification && Number.isSafeInteger(classification.level) ? classification.level : null,
    action: resolution.action,
    resolvedAt: resolution.at,
    targetId: isNonEmptyString(resolution.targetId) ? resolution.targetId : null
  };
}

// Read shape matches a resolved impulse in the popover projection.
function hydrateRecord(row) {
  const category = row.category;
  return Object.freeze({
    id: row.id,
    text: row.text,
    createdAt: Number(row.createdAt),
    classification: Object.freeze({
      category,
      routineKind: row.routineKind == null ? null : row.routineKind,
      level: row.level == null ? null : Number(row.level)
    }),
    resolution: Object.freeze({
      action: row.action,
      category,
      at: Number(row.resolvedAt),
      targetId: row.targetId == null ? null : row.targetId
    })
  });
}

function keysetClause(cursor) {
  if (!cursor) return { sql: '', params: [] };
  return { sql: ' AND (created_at < ? OR (created_at = ? AND id > ?))', params: [cursor.createdAt, cursor.createdAt, cursor.id] };
}

function createSqlInboxArchiveRepository({ handle, logger = () => {} }) {
  function trace(operation, error) {
    try { logger({ scope: 'inbox-archive', operation, message: error && error.message }); } catch (_) {}
  }

  function put(records) {
    const rows = (Array.isArray(records) ? records : []).map(normalizeRecord);
    if (rows.some(row => row === null)) return { ok: false, written: 0, reason: 'invalid-record' };
    if (!rows.length) return { ok: true, written: 0 };
    try {
      handle.exec('BEGIN IMMEDIATE');
      try {
        for (const row of rows) {
          handle.run(
            `INSERT OR REPLACE INTO inbox_records
              (id, text, created_at, category, routine_kind, level, action, resolved_at, target_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.id, row.text, row.createdAt, row.category, row.routineKind, row.level,
              row.action, row.resolvedAt, row.targetId]
          );
        }
        handle.exec('COMMIT');
      } catch (error) {
        handle.exec('ROLLBACK');
        throw error;
      }
      return { ok: true, written: rows.length };
    } catch (error) {
      trace('put', error);
      return { ok: false, written: 0 };
    }
  }

  function page({ after = null, limit = 30, category = null } = {}) {
    const size = Math.max(1, Math.min(MAX_PAGE, Math.trunc(Number(limit)) || 30));
    const keyset = keysetClause(after);
    const filter = isNonEmptyString(category) ? ' AND category = ?' : '';
    try {
      const items = handle.all(
        `SELECT id, text, created_at AS createdAt, category, routine_kind AS routineKind, level,
                action, resolved_at AS resolvedAt, target_id AS targetId
           FROM inbox_records WHERE 1 = 1${filter}${keyset.sql}
          ORDER BY created_at DESC, id ASC LIMIT ?`,
        [...(filter ? [category] : []), ...keyset.params, size]
      ).map(hydrateRecord);
      return { ok: true, items };
    } catch (error) {
      trace('page', error);
      return { ok: false, items: [], reason: 'store-unavailable' };
    }
  }

  function count({ category = null } = {}) {
    try {
      const row = isNonEmptyString(category)
        ? handle.get('SELECT COUNT(*) AS total FROM inbox_records WHERE category = ?', [category])
        : handle.get('SELECT COUNT(*) AS total FROM inbox_records');
      const total = row && (typeof row.total === 'number' || typeof row.total === 'bigint') ? Number(row.total) : null;
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('invalid-history-count');
      return { ok: true, total };
    } catch (error) {
      trace('count', error);
      return { ok: false, total: null, reason: 'store-unavailable' };
    }
  }

  function existing(ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter(isNonEmptyString))];
    if (!list.length) return { ok: true, ids: [] };
    try {
      const found = [];
      // This read covers every local overlap. The per-target deletion bound below
      // is separate and must still reject an oversized destructive scope.
      for (let offset = 0; offset < list.length; offset += MAX_ID_LIST) {
        const batch = list.slice(offset, offset + MAX_ID_LIST);
        found.push(...handle.all(`SELECT id FROM inbox_records WHERE id IN (${batch.map(() => '?').join(', ')})`, batch)
          .map(row => row.id));
      }
      return { ok: true, ids: found };
    } catch (error) {
      trace('existing', error);
      return { ok: false, ids: [], reason: 'store-unavailable' };
    }
  }

  // Explicit deletion only: a person removing one capture, or the mood note it became.
  function remove(id) {
    if (!isNonEmptyString(id)) return { ok: false, removed: 0, reason: 'id-required' };
    try {
      const info = handle.run('DELETE FROM inbox_records WHERE id = ?', [id]);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('remove', error);
      return { ok: false, removed: 0 };
    }
  }

  function idsByTarget(action, targetId) {
    if (!isNonEmptyString(action) || !isNonEmptyString(targetId)) return { ok: false, ids: [], reason: 'target-required' };
    try {
      const rows = handle.all('SELECT id FROM inbox_records WHERE action = ? AND target_id = ? ORDER BY id LIMIT ?', [action, targetId, MAX_ID_LIST + 1]);
      return rows.length > MAX_ID_LIST ? { ok: false, ids: [], reason: 'source-scope-too-large' }
        : { ok: true, ids: rows.map(row => row.id) };
    } catch (_) { return { ok: false, ids: [], reason: 'source-query-unavailable' }; }
  }

  function removeByTarget(action, targetId) {
    if (!isNonEmptyString(action) || !isNonEmptyString(targetId)) return { ok: false, removed: 0, reason: 'target-required' };
    try {
      const info = handle.run('DELETE FROM inbox_records WHERE action = ? AND target_id = ?', [action, targetId]);
      return { ok: true, removed: Number(info && info.changes) || 0 };
    } catch (error) {
      trace('removeByTarget', error);
      return { ok: false, removed: 0 };
    }
  }

  return Object.freeze({ available: true, put, page, count, existing, remove, removeByTarget, idsByTarget });
}

// JSONL and unavailable tiers keep resolved captures in config.json, exactly as
// before the archive existed: degraded size, never lost text.
const UNAVAILABLE_INBOX_ARCHIVE = Object.freeze({
  available: false,
  put: () => ({ ok: false, written: 0, reason: 'store-unavailable' }),
  page: () => ({ ok: false, items: [], reason: 'store-unavailable' }),
  count: () => ({ ok: false, total: null, reason: 'store-unavailable' }),
  existing: () => ({ ok: false, ids: [], reason: 'store-unavailable' }),
  idsByTarget: () => ({ ok: false, ids: [], reason: 'store-unavailable' }),
  remove: () => ({ ok: false, removed: 0, reason: 'store-unavailable' }),
  removeByTarget: () => ({ ok: false, removed: 0, reason: 'store-unavailable' })
});

module.exports = { createSqlInboxArchiveRepository, UNAVAILABLE_INBOX_ARCHIVE, normalizeRecord, hydrateRecord };
