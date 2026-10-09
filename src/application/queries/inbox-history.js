'use strict';

const { work } = require('../../capabilities');
const MAX_PAGE = 100;
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const isTotal = value => Number.isSafeInteger(value) && value >= 0;

function validArchiveRow(row) {
  if (!row || !isId(row.id) || typeof row.text !== 'string' || !row.text.length
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > 8.64e15) return false;
  const classification = work.inboxRecords.normalizeClassification(row.classification);
  const resolution = work.inboxRecords.normalizeResolution(row.resolution);
  return Boolean(classification && resolution && classification.category === resolution.category
    && classification.routineKind === row.classification.routineKind && classification.level === row.classification.level
    && resolution.targetId === row.resolution.targetId);
}

// History reads both canonical local records and the archive. A failed archive
// read is unknown, never empty; only verified complete reads can supply totals or
// a continuation cursor (ARCHITECTURE「收件分类与原文历史」).
function createInboxHistoryQuery({ readSnapshot, archive }) {
  if (typeof readSnapshot !== 'function') throw new TypeError('inbox history requires a snapshot reader');
  function documentRows(impulses = readSnapshot().impulses) {
    return (impulses || []).filter(item => item.resolution);
  }
  function read(method, args, validate) {
    try {
      const result = archive?.[method]?.(args);
      return result && result.ok === true && validate(result) ? result : null;
    } catch (_) { return null; }
  }
  function readCounts(rows, category = null) {
    const requested = new Set(rows.map(item => item.id));
    const existing = read('existing', [...requested], result => Array.isArray(result.ids)
      && result.ids.every(id => isId(id) && requested.has(id)) && new Set(result.ids).size === result.ids.length);
    const filtered = read('count', { category }, result => isTotal(result.total));
    const global = category ? read('count', {}, result => isTotal(result.total)) : filtered;
    if (!existing || !filtered || !global || filtered.total > global.total || existing.ids.length > global.total) return null;
    const archivedIds = new Set(existing.ids);
    const local = rows.filter(item => !archivedIds.has(item.id));
    const total = filtered.total + local.filter(item => !category || item.resolution.category === category).length;
    const globalTotal = global.total + local.length;
    return isTotal(total) && isTotal(globalTotal) ? { archivedIds: existing.ids, total, globalTotal, archiveTotal: filtered.total } : null;
  }
  function page({ cursor = null, limit = 30, category = null } = {}) {
    const after = work.inboxRecords.decodeHistoryCursor(cursor);
    const size = Math.max(1, Math.min(MAX_PAGE, Math.trunc(Number(limit)) || 30));
    const rows = documentRows();
    const archived = read('page', { after, limit: size, category }, result => Array.isArray(result.items)
      && result.items.length <= size && result.items.every((item, index, items) => validArchiveRow(item)
        && (!category || item.resolution.category === category)
        && (!after || work.inboxRecords.compareHistory(item, after) > 0)
        && (!index || work.inboxRecords.compareHistory(items[index - 1], item) < 0))
      && new Set(result.items.map(item => item.id)).size === result.items.length);
    const counts = readCounts(rows, category);
    if (!archived || !counts || archived.items.length > counts.archiveTotal
        || (!after && archived.items.length !== Math.min(size, counts.archiveTotal))) {
      const local = work.inboxRecords.mergeHistoryPage({ documentRows: rows, archiveRows: [], cursor: after, limit: size, category });
      return { available: false, partial: local.items.length > 0, items: local.items,
        total: null, globalTotal: null, nextCursor: null };
    }
    const merged = work.inboxRecords.mergeHistoryPage({
      documentRows: rows, archiveRows: archived.items, archivedIds: counts.archivedIds, cursor: after, limit: size, category
    });
    return { available: true, partial: false, items: merged.items,
      total: counts.total, globalTotal: counts.globalTotal, nextCursor: merged.nextCursor };
  }
  // A composing query can supply its already sampled canonical impulses.
  // Standalone history reads keep the same snapshot/count validation path.
  function total(impulses) {
    return readCounts(documentRows(impulses))?.globalTotal ?? null;
  }
  return Object.freeze({ page, total });
}

module.exports = { createInboxHistoryQuery };
