'use strict';

const { TRIAGE_CATEGORIES, TRIAGE_LEVELS, TRIAGE_ROUTINE_KINDS, findImpulse } = require('./impulse-inbox');
const CATEGORIES = Object.freeze(['unclassified', ...TRIAGE_CATEGORIES]);
// One explicit "keep all" covers a full popover inbox page.
const MAX_KEEP_ALL = 100;
const ACTIONS = Object.freeze(['promote', 'next-step', 'schedule', 'someday', 'routine', 'log', 'state', 'feeling', 'keep']);

function normalizeClassification(value) {
  if (!value || typeof value !== 'object' || !CATEGORIES.includes(value.category)) return null;
  return {
    category: value.category,
    routineKind: ['routine', 'log'].includes(value.category) && TRIAGE_ROUTINE_KINDS.includes(value.routineKind) ? value.routineKind : null,
    level: value.category === 'state' && TRIAGE_LEVELS.includes(value.level) ? value.level : null
  };
}

function classificationOf(impulse) {
  return normalizeClassification(impulse.classification || impulse.triage) || normalizeClassification({ category: 'unclassified' });
}

function normalizeResolution(value) {
  if (!value || typeof value !== 'object' || !ACTIONS.includes(value.action)
      || !CATEGORIES.includes(value.category) || !Number.isSafeInteger(value.at) || value.at < 0 || value.at > 8.64e15) return null;
  return { action: value.action, category: value.category, at: value.at,
    targetId: typeof value.targetId === 'string' && value.targetId.length <= 200 ? value.targetId : null };
}

function classifyImpulse(state, { id, category, routineKind = null, level = null }) {
  const impulse = findImpulse(state, id);
  if (!impulse) return { ok: false, reason: 'impulse-not-found' };
  const classification = normalizeClassification({ category, routineKind, level });
  if (!classification) return { ok: false, reason: 'impulse-classification-invalid' };
  impulse.classification = classification;
  return { ok: true };
}

function resolveRecord(state, id, resolution) {
  const impulse = findImpulse(state, id);
  if (!impulse) return { ok: false, reason: 'impulse-not-found' };
  const normalized = normalizeResolution(resolution);
  if (!normalized) return { ok: false, reason: 'impulse-resolution-invalid' };
  impulse.resolution = normalized;
  return { ok: true, impulse };
}

function removeMoodRecords(state, targetId) {
  state.impulses = state.impulses.filter(item => !(item.resolution?.action === 'feeling' && item.resolution.targetId === targetId));
}

// Keep every listed pending capture as-is in one commit; the outcome records the label it had.
function keepAll(state, ids, at) {
  const kept = [];
  for (const id of ids) {
    const impulse = findImpulse(state, id);
    if (!impulse) continue;
    const resolved = resolveRecord(state, id, { action: 'keep', category: classificationOf(impulse).category, at, targetId: null });
    if (resolved.ok) kept.push(id);
  }
  return kept.length ? { ok: true, kept } : { ok: false, reason: 'impulse-not-found' };
}

// After the archive confirms a copy, the document releases exactly that version of the record.
function releaseArchived(state, entries) {
  const archived = new Map(entries.map(entry => [entry.id, entry.at]));
  const before = state.impulses.length;
  state.impulses = state.impulses.filter(item => !(item.resolution && archived.get(item.id) === item.resolution.at));
  return { ok: true, released: before - state.impulses.length };
}

// History order: newest capture first, id ascending on ties. A cursor is the last row shown.
function compareHistory(a, b) {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function isAfterCursor(item, cursor) {
  return !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id > cursor.id);
}

function encodeHistoryCursor(item) {
  return `before:${item.createdAt}:${item.id}`;
}

function decodeHistoryCursor(cursor) {
  const match = typeof cursor === 'string' ? /^before:(\d{1,16}):(.{1,200})$/.exec(cursor) : null;
  return match && Number.isSafeInteger(Number(match[1])) ? { createdAt: Number(match[1]), id: match[2] } : null;
}

// Merge the document's not-yet-archived rows with one archive page, without duplicates.
function mergeHistoryPage({ documentRows, archiveRows, archivedIds = [], cursor = null, limit = 30, category = null }) {
  const archived = new Set(archivedIds);
  const local = documentRows.filter(item => item.resolution && !archived.has(item.id)
    && (!category || item.resolution.category === category));
  const seen = new Set();
  const rows = [...local.filter(item => isAfterCursor(item, cursor)), ...archiveRows]
    .filter(item => !seen.has(item.id) && seen.add(item.id))
    .sort(compareHistory);
  const items = rows.slice(0, limit);
  return { items, localCount: local.length, nextCursor: rows.length > limit || archiveRows.length >= limit ? encodeHistoryCursor(items[items.length - 1]) : null };
}

module.exports = {
  CATEGORIES, MAX_KEEP_ALL, normalizeClassification, normalizeResolution, classificationOf, classifyImpulse, resolveRecord,
  removeMoodRecords, keepAll, releaseArchived, compareHistory, encodeHistoryCursor, decodeHistoryCursor, mergeHistoryPage
};
