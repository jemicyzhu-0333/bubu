'use strict';

const { redactRelatedReceipts } = require('../ai/receipt-privacy');
const { work } = require('../../capabilities');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

// An explicit deletion removes the original text wherever it currently lives: the
// pending inbox or a resolved record still in the document (work's own discard
// command), and the fact-store archive.
function createDeleteInboxRecordWorkflow({ unitOfWork, archive, durability, publish = () => {}, reportEffectError = () => {} }) {
  if (!archive || typeof archive.remove !== 'function') throw new TypeError('deleting an inbox record requires an archive');
  const writes = DELETE_INBOX_RECORD_WRITES;
  function execute({ impulseId } = {}) {
    let local;
    try {
      local = unitOfWork.run({ writes, transition: state => {
        const result = work.impulseInbox.consumeImpulse(state, impulseId);
        if (!result.ok && result.reason !== 'impulse-not-found') return result;
        const privacy = redactRelatedReceipts(state, { sourceRefs: [{ kind: 'inbox', id: impulseId }] });
        return privacy.ok ? { ok: true, localDeleted: result.ok === true, receiptDetailsRedacted: privacy.changed } : privacy;
      } });
    } catch (_) { return { ok: false, reason: 'inbox-delete-failed' }; }
    if (!local.ok) return local;
    if (durability && !durability.verify().ok) return { ok: false, reason: 'inbox-delete-partial',
      localDeleted: local.localDeleted, receiptDetailsRedacted: true, archivePending: true, durability: 'unconfirmed' };
    const archived = archive.remove(impulseId);
    if (!archived?.ok) return { ok: false, reason: 'inbox-delete-partial', localDeleted: local.localDeleted,
      receiptDetailsRedacted: local.receiptDetailsRedacted, archivePending: true };
    if (!local.localDeleted && !(archived.removed > 0)) return { ok: false };
    runPostCommitEffect(publish, { type: 'inbox-record-deleted', impulseId }, reportEffectError);
    return { ok: true };
  }
  return Object.freeze({ execute });
}

const DELETE_INBOX_RECORD_WRITES = Object.freeze(['impulses', 'aiCollaboration']);
module.exports = { DELETE_INBOX_RECORD_WRITES, createDeleteInboxRecordWorkflow };
