'use strict';
const { normalizeCompletion } = require('./completion-identity');
const RETENTION_MS = 72 * 60 * 60 * 1000;
const MAX_RECEIPTS = 256;
function normalizeReceipts(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_RECEIPTS) throw new TypeError('invalid-completion-receipts');
  const seen = new Set();
  return raw.map(r => {
    if (!r || Object.keys(r).sort().join(',') !== 'completion,occurrenceId,removedAt,routineId'
      || typeof r.occurrenceId !== 'string' || !r.occurrenceId || r.occurrenceId.length > 200
      || typeof r.routineId !== 'string' || !r.routineId || r.routineId.length > 100
      || !Number.isSafeInteger(r.removedAt) || r.removedAt < 0 || r.removedAt > 8.64e15
      || seen.has(r.occurrenceId)) throw new TypeError('invalid-completion-receipt');
    seen.add(r.occurrenceId);
    return { occurrenceId:r.occurrenceId, routineId:r.routineId, removedAt:r.removedAt, completion:normalizeCompletion(r.completion) };
  });
}
function rememberRemoval(log, entry, now, { capacity = MAX_RECEIPTS } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_RECEIPTS) throw new TypeError('invalid-receipt-capacity');
  if (!Number.isSafeInteger(now) || now < 0) return;
  const kept = (log.completionReceipts || []).filter(r => r.occurrenceId !== entry.occurrenceId && now - r.removedAt < RETENTION_MS);
  if (kept.length >= capacity) {
    // A presentation identity limit must never block a business undo. Until all
    // possibly omitted slots leave the correction window, requested-slot theme
    // creation fails closed; explicitly new free records remain independent.
    log.completionRecoveryBlockedUntil = Math.max(log.completionRecoveryBlockedUntil || 0, now + RETENTION_MS);
    kept.shift();
  }
  kept.push({ occurrenceId:entry.occurrenceId, routineId:entry.routineId, removedAt:now, completion:entry.completion || null });
  log.completionReceipts = kept;
}
module.exports = { RETENTION_MS, MAX_RECEIPTS, normalizeReceipts, rememberRemoval };
