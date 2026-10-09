'use strict';

const { id, time, clone, immutable } = require('./conversation-record');

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decode(cursor) {
  if (cursor === null) return { version: 1, phase: 'local', after: null };
  if (typeof cursor !== 'string' || cursor.length > 2000) throw new Error('cursor');
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!value || value.version !== 1 || Object.keys(value).length !== 3) throw new Error('cursor');
  if (value.phase === 'saved' && (value.cursor === null || typeof value.cursor === 'string')) return value;
  if (value.phase === 'local' && value.after && Object.keys(value.after).length === 2
    && time(value.after.createdAt) && id(value.after.id)) return value;
  throw new Error('cursor');
}
function conversationListMetadata(record) {
  const first = record.messages.find(message => message.role === 'user');
  const displayTitle = first ? [...first.content.trim().replace(/\s+/gu, ' ')].slice(0, 60).join('') : '';
  return { id: record.id, revision: record.revision, purpose: record.purpose, mode: record.mode,
    createdAt: record.createdAt, updatedAt: record.updatedAt, status: record.status,
    retention: clone(record.retention), relatedEntity: clone(record.relatedEntity), displayTitle };
}
function metadata(entry) {
  const record = entry.record;
  return immutable({ ...conversationListMetadata(record), saveState: record.retention.mode === 'ephemeral' ? 'ephemeral'
      : entry.savedRevision === record.revision ? 'saved' : 'unsaved' });
}

// Local-only sessions precede durable keyset pages. The tagged cursor never
// exposes SQL, and the combined result is bounded by the requested page size.
function listConversationCatalog({ repository, ownerId, entries, limit = 20, cursor = null, localOnly = false }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return { ok: false, reason: 'conversation-page-invalid' };
  let position;
  try { position = decode(cursor); } catch (_) { return { ok: false, reason: 'conversation-cursor-invalid' }; }
  const locals = position.phase === 'local' ? [...entries.values()].filter(entry => localOnly || entry.savedRevision === 0)
    .filter(entry => !position.after || entry.record.createdAt > position.after.createdAt
      || (entry.record.createdAt === position.after.createdAt && entry.record.id > position.after.id))
    .sort((a, b) => a.record.createdAt - b.record.createdAt || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0)) : [];
  const items = locals.slice(0, limit).map(metadata);
  let saved;
  try { saved = repository?.listPage({ ownerId, limit: Math.max(1, limit - items.length), cursor: position.phase === 'saved' ? position.cursor : null }); }
  catch (_) { saved = null; }
  const availability = saved?.ok ? 'available' : 'unavailable';
  const reason = saved?.ok ? null : saved?.reason || 'conversation-storage-unavailable';
  if (locals.length > limit) {
    const last = items.at(-1);
    return { ok: true, items, nextCursor: encode({ version: 1, phase: 'local', after: { createdAt: last.createdAt, id: last.id } }), availability, reason };
  }
  if (items.length === limit) {
    return { ok: true, items, nextCursor: saved?.ok && saved.items.length ? encode({ version: 1, phase: 'saved', cursor: null }) : null, availability, reason };
  }
  for (const item of saved?.ok ? saved.items : []) {
    const cached = entries.get(item.id);
    items.push(cached ? metadata(cached) : immutable({ ...clone(item), saveState: 'saved' }));
  }
  return { ok: true, items, nextCursor: saved?.nextCursor ? encode({ version: 1, phase: 'saved', cursor: saved.nextCursor }) : null, availability, reason };
}

module.exports = { listConversationCatalog, conversationListMetadata };
