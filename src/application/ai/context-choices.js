'use strict';

const { cursorOffset, MAX_CURSOR_OFFSET } = require('../../core/ai-read-cursor');
const { entityFingerprint } = require('./entity-fingerprint');
const { exactKeys } = require('./context-grants');

const CHOICE_LIMIT = 20;
function memoryContextVersion(item) { return entityFingerprint({ id: item.id, version: item.version }); }
const ORDINARY_ROUTINE_KINDS = Object.freeze(['meal', 'snack', 'movement', 'rest', 'meeting']);
const PATHS = Object.freeze({ task: 'tasks', inbox: 'impulses', routine: 'routines' });
function isOrdinaryRoutine(item) {
  return item?.active === true && ORDINARY_ROUTINE_KINDS.includes(item.kind);
}
function contextRecords(snapshot, kind) {
  const records = snapshot?.[PATHS[kind]];
  if (!Array.isArray(records)) return null;
  return kind === 'routine' ? records.filter(isOrdinaryRoutine) : records;
}
function contextChoice(item, kind) {
  const common = { id: item.id, version: kind === 'memory' ? memoryContextVersion(item) : entityFingerprint(item) };
  if (kind === 'memory') return { ...common, kind: item.kind, subject: item.subject, body: item.body, scope: item.scope, expiresAt: item.expiresAt };
  if (kind === 'inbox') return { ...common, text: String(item.text || '').slice(0, 500),
    textTruncated: String(item.text || '').length > 500, createdAt: item.createdAt ?? null,
    classification: item.classification?.category || null };
  return { ...common, title: String(item.title || ''), ...(kind === 'routine' ? { kind: item.kind } : { done: item.done === true }) };
}

// Local-only candidates are never model context or an authorization grant.
function createContextChoices({ sessions, readSnapshot, memoryRecall } = {}) {
  if (!sessions || typeof readSnapshot !== 'function') throw new TypeError('context-choice-ports-invalid');
  function getConversationContextChoices(payload = {}) {
    if (!exactKeys(payload, ['conversationId', 'kind', 'query', 'cursor'])
      || (!Object.hasOwn(PATHS, payload.kind) && payload.kind !== 'memory') || typeof payload.conversationId !== 'string'
      || (payload.query !== undefined && (typeof payload.query !== 'string' || [...payload.query].length > 200))
      || cursorOffset(payload.cursor) === null) return { ok: false, reason: 'context-choice-query-invalid' };
    const found = sessions.get({ conversationId: payload.conversationId });
    if (!found.ok) return found;
    let records;
    try {
      const snapshot = readSnapshot();
      if (payload.kind === 'memory') {
        if (snapshot?.settings?.aiMemoryEnabled !== true) return { ok: true, items: [], nextCursor: null, availability: 'disabled' };
        const result = memoryRecall?.discovery({ query: payload.query, cursor: payload.cursor });
        if (!result?.ok) return { ok: true, items: [], nextCursor: null, availability: 'unavailable' };
        return { ok: true, items: result.items.map(item => contextChoice(item, 'memory')),
          nextCursor: result.nextCursor, availability: 'available' };
      } else records = contextRecords(snapshot, payload.kind);
    } catch (_) { records = null; }
    if (records === null) return { ok: true, items: [], nextCursor: null, availability: 'unavailable' };
    const query = (payload.query || '').toLocaleLowerCase();
    const matches = records.filter(item => String(item[payload.kind === 'inbox' ? 'text' : 'title'] || '')
      .toLocaleLowerCase().includes(query)).sort((a, b) => a.id.localeCompare(b.id));
    const offset = cursorOffset(payload.cursor), end = offset + CHOICE_LIMIT;
    return { ok: true, items: matches.slice(offset, end).map(item => contextChoice(item, payload.kind)),
      nextCursor: end < matches.length && end <= MAX_CURSOR_OFFSET ? `offset:${end}` : null, availability: 'available' };
  }
  return Object.freeze({ getConversationContextChoices });
}
module.exports = { CHOICE_LIMIT, memoryContextVersion, ORDINARY_ROUTINE_KINDS, isOrdinaryRoutine, contextRecords, createContextChoices };
