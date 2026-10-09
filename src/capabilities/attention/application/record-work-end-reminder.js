'use strict';

const reminderMarker = require('../domain/reminder-marker');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const RECORD_WORK_END_REMINDER_WRITES = Object.freeze(['lastWorkEndNotifyDate']);

function createRecordWorkEndReminderCommand({
  unitOfWork,
  clock,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('record-work-end-reminder command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('record-work-end-reminder command requires a clock');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('record-work-end-reminder command effects must be functions');
  }

  function execute({ dayKey, expectedRevision } = {}) {
    const recordedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: RECORD_WORK_END_REMINDER_WRITES,
      expectedRevision,
      context: { now: recordedAt },
      transition: state => reminderMarker.recordWorkEndReminder(state, { dayKey, now: recordedAt })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'work-end-reminder-recorded',
        dayKey: transaction.dayKey,
        recordedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, changed: transaction.committed, dayKey: transaction.dayKey };
  }

  return Object.freeze({ execute });
}

module.exports = { RECORD_WORK_END_REMINDER_WRITES, createRecordWorkEndReminderCommand };
