'use strict';

const { cursorOffset, MAX_CURSOR_OFFSET } = require('./ai-read-cursor');
const MAX_MEMORY_IDS = 8;
const MAX_MEMORY_BODY_CHARS = 1200;
const MEMORY_CHOICE_LIMIT = 20;

// ARCHITECTURE「有界记忆检索」: qualify the existing full-corpus projection.
function memoryEligible(item, at) {
  return item.contextAllowed === true && item.status === 'active'
    && Number.isSafeInteger(item.version) && item.version > 0
    && Number.isFinite(item.validFrom) && item.validFrom <= at
    && ['user-confirmed', 'aggregated'].includes(item.source)
    && (item.expiresAt === null ? item.source === 'user-confirmed' : Number.isFinite(item.expiresAt) && item.expiresAt > at);
}

function validMemoryIds(ids) {
  return Array.isArray(ids) && ids.length <= MAX_MEMORY_IDS
    && Array.from(ids).every(id => typeof id === 'string' && id.length > 0)
    && new Set(ids).size === ids.length;
}
function qualifyMemorySelection(items, ids, at) {
  if (!validMemoryIds(ids)) return { ok: false, reason: 'memory-selection-budget' };
  if (!Array.isArray(items) || items.length !== ids.length
    || new Set(items.map(item => item.id)).size !== items.length
    || items.some(item => !ids.includes(item.id) || !memoryEligible(item, at))) {
    return { ok: false, reason: 'memory-context-invalid' };
  }
  if (items.reduce((sum, item) => sum + [...item.body].length, 0) > MAX_MEMORY_BODY_CHARS) {
    return { ok: false, reason: 'memory-context-budget' };
  }
  return { ok: true, items: structuredClone(items).sort((a, b) => a.id.localeCompare(b.id)) };
}
function recallPage(items, { query = '', cursor, limit }, joined) {
  if (typeof query !== 'string' || [...query].length > 200) return { ok: false, reason: 'tool-query-invalid' };
  const offset = cursorOffset(cursor);
  if (offset === null) return { ok: false, reason: 'tool-cursor-invalid' };
  const needle = query.toLocaleLowerCase();
  const matches = items.filter(item => joined
    ? `${item.subject} ${item.body}`.toLocaleLowerCase().includes(needle)
    : [item.subject, item.body].some(value => value.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const end = offset + limit;
  return { ok: true, items: structuredClone(matches.slice(offset, end)),
    nextCursor: end < matches.length && end <= MAX_CURSOR_OFFSET ? `offset:${end}` : null,
    truncated: end < matches.length };
}
function discoverMemory(items, args = {}, at) {
  return recallPage(items.filter(item => memoryEligible(item, at)), { ...args, limit: MEMORY_CHOICE_LIMIT }, true);
}
function recallSelectedMemory(items, args = {}) {
  const limit = args.limit === undefined ? MAX_MEMORY_IDS : args.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEMORY_IDS) return { ok: false, reason: 'tool-limit-invalid' };
  return recallPage(items, { ...args, limit }, false);
}

module.exports = { memoryEligible, validMemoryIds, qualifyMemorySelection, discoverMemory, recallSelectedMemory,
  MAX_MEMORY_IDS, MAX_MEMORY_BODY_CHARS, MEMORY_CHOICE_LIMIT };
