'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { dismissNotice } = require('../domain/migration-notices');

const DISMISS_MIGRATION_NOTICE_WRITES = Object.freeze(['migrationNotices']);

function createDismissMigrationNoticeCommand({
  unitOfWork,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('dismiss-migration-notice command requires a unit of work');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('dismiss-migration-notice command effects must be functions');
  }

  // No clock: a dismissal records nothing about when it happened, and the notice
  // it removes was written by the migration that ran at construction time.
  function execute({ noticeId, expectedRevision } = {}) {
    const transaction = unitOfWork.run({
      writes: DISMISS_MIGRATION_NOTICE_WRITES,
      expectedRevision,
      transition: state => dismissNotice(state, noticeId)
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'migration-notice-dismissed',
        dismissedId: transaction.dismissedId,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true };
  }

  return Object.freeze({ execute });
}

module.exports = { DISMISS_MIGRATION_NOTICE_WRITES, createDismissMigrationNoticeCommand };
