'use strict';

const { clone, immutable } = require('./conversation-record');
const DAY_MS = 86400000;
const deadline = record => record.retention.pinned ? null : record.updatedAt + record.retention.days * DAY_MS;

// Keep the exact ambiguous attempt separate from newer local edits. Only its
// verified receipt may advance the durable revision; reconciliation never saves it again.
function createConversationPersistence({ repository, ownerId, now }) {
  function failed(entry, reason) {
    entry.saveError = reason || 'conversation-save-unavailable';
    return { ok: false, reason: entry.saveError };
  }
  function accept(entry, attempt, revision) {
    entry.savedRevision = revision;
    entry.retentionDeadline = deadline(attempt.snapshot);
    entry.retentionInitialized = true;
    entry.saveError = null;
  }
  function reconcile(entry) {
    const attempt = entry.pendingSave;
    if (!attempt) return { ok: true };
    let result;
    try { result = repository?.reconcileSave({ ownerId, ...clone(attempt) }); } catch (_) { result = null; }
    const committed = result?.ok && result.outcome === 'committed' && result.revision === attempt.snapshot.revision;
    const rolledBack = result?.ok && result.outcome === 'rolled-back' && result.revision === attempt.expectedRevision;
    if (!committed && !rolledBack) return failed(entry, 'conversation-save-unknown');
    if (committed) accept(entry, attempt, result.revision);
    entry.pendingSave = null;
    return { ok: true };
  }
  function save(entry) {
    const settled = reconcile(entry);
    if (!settled.ok) return settled;
    if (entry.savedRevision === entry.record.revision) return { ok: true };
    const attempt = immutable({ snapshot: clone(entry.record), expectedRevision: entry.savedRevision });
    let result;
    try { result = repository?.saveSnapshot({ ownerId, ...clone(attempt), now: now() }); }
    catch (_) { result = { durability: 'unknown' }; }
    if (!result?.ok || result.revision !== attempt.snapshot.revision) {
      if (result?.durability === 'unknown' || result?.ok) entry.pendingSave = attempt;
      return failed(entry, result?.reason);
    }
    accept(entry, attempt, result.revision);
    return { ok: true };
  }
  return Object.freeze({ save, reconcile });
}

module.exports = { createConversationPersistence };
