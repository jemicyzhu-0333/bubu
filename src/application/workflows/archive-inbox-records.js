'use strict';

const { work } = require('../../capabilities');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const ARCHIVE_INBOX_RECORDS_WRITES = Object.freeze(['impulses']);

// Copy first, release second: config.json drops a resolved capture only after the
// archive confirmed it, and only the exact version that was copied. Without an
// archive (JSONL or unavailable tier) captures simply stay in the document.
function createArchiveInboxRecordsWorkflow({ unitOfWork, readSnapshot, archive, publish = () => {}, reportEffectError = () => {} }) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof readSnapshot !== 'function' || !archive) {
    throw new TypeError('archiving inbox records requires a unit of work, a snapshot reader and an archive');
  }
  function flush() {
    if (!archive.available) return { ok: true, released: 0 };
    const resolved = (readSnapshot().impulses || []).filter(item => item.resolution);
    if (!resolved.length) return { ok: true, released: 0 };
    const copied = archive.put(resolved);
    if (!copied.ok) return { ok: false, reason: copied.reason || 'archive-write-failed' };
    const transaction = unitOfWork.run({
      writes: ARCHIVE_INBOX_RECORDS_WRITES,
      transition: state => work.inboxRecords.releaseArchived(state, resolved.map(item => ({ id: item.id, at: item.resolution.at })))
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) runPostCommitEffect(publish, { type: 'inbox-archived', released: transaction.released }, reportEffectError);
    return { ok: true, released: transaction.released || 0 };
  }
  return Object.freeze({ flush });
}

module.exports = { ARCHIVE_INBOX_RECORDS_WRITES, createArchiveInboxRecordsWorkflow };
