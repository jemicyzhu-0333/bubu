import { ERROR_OPERATIONS } from '../../src/surfaces/pet/realtime/error-journal.mjs';
import { appendCaptureError } from './report.mjs';
import { safeMessage } from './evidence.mjs';

const controllers = new WeakMap();
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fields = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).every(key => allowed.includes(key));
function validateJournal(log) {
  if (!fields(log, ['schemaVersion', 'total', 'overwritten', 'rows']) || log.schemaVersion !== 1
    || !integer(log.total) || !integer(log.overwritten) || !Array.isArray(log.rows) || log.rows.length > 8
    || log.rows.length !== Math.min(8, log.total) || log.overwritten !== log.total - log.rows.length)
    throw new Error('diagnostic-error-journal-invalid');
  for (const [index, row] of log.rows.entries()) {
    if (!fields(row, ['sequence', 'atMs', 'operation', 'message']) || row.sequence !== log.overwritten + index + 1
      || !(row.atMs === null || Number.isFinite(row.atMs) && row.atMs >= 0)
      || !ERROR_OPERATIONS.includes(row.operation) || typeof row.message !== 'string' || row.message.length > 2048)
      throw new Error('diagnostic-error-row-invalid');
  }
}

/** Shared by readiness polling, collection, and terminal reads; reads never create occurrences. */
export function diagnosticReporter(report) {
  if (controllers.has(report)) return controllers.get(report);
  const states = new Map();
  const observe = (value, phase = 'startup') => {
    if (typeof value?.instanceId !== 'string' || !value.instanceId.length || value.instanceId.length > 128
      || value.instanceId === 'unavailable') throw new Error('diagnostic-generation-unavailable');
    const log = value.errorLog;
    if (log !== undefined) validateJournal(log);
    else if (!Array.isArray(value.errors) || value.errors.length > 8
      || value.errors.some(message => typeof message !== 'string' || message.length > 2048))
      throw new Error('diagnostic-legacy-errors-invalid');
    let state = states.get(value.instanceId);
    if (!state) {
      if (states.size >= 8) throw new Error('diagnostic-error-generation-limit');
      const summary = { instanceId: value.instanceId, evidence: log === undefined ? 'legacy-occurrence-count-unknown' : 'sequence-journal',
        totalOccurrences: log === undefined ? null : 0, observedRows: 0, missingDetails: 0, retainedDetails: 0, droppedDetails: 0,
        lastSequence: log === undefined ? null : 0, lastPendingOperations: null };
      report.rendererDiagnostics ??= [];
      report.rendererDiagnostics.push(summary);
      state = { summary, legacySnapshot: null }; states.set(value.instanceId, state);
    }
    const summary = state.summary;
    summary.lastPendingOperations = integer(value.pendingOperations) ? value.pendingOperations : null;
    if ((log === undefined) !== (summary.evidence === 'legacy-occurrence-count-unknown'))
      throw new Error('diagnostic-error-evidence-changed');
    const retain = detail => {
      summary.observedRows++;
      if (appendCaptureError(report, detail)) summary.retainedDetails++; else summary.droppedDetails++;
    };
    if (log === undefined) {
      // A changed retained array is an observation, never proof of additional occurrences.
      const signature = JSON.stringify(value.errors);
      if (signature === state.legacySnapshot) return;
      state.legacySnapshot = signature;
      for (const message of value.errors) retain({ code: 'renderer-diagnostic-legacy-observation', phase,
        instanceId: value.instanceId, occurrenceCount: null, message: safeMessage(message).message });
      return;
    }
    if (log.total < summary.lastSequence) throw new Error('diagnostic-error-sequence-regressed');
    const missing = Math.max(0, log.overwritten - summary.lastSequence);
    if (missing) {
      summary.missingDetails += missing;
      appendCaptureError(report, { code: 'renderer-diagnostic-detail-loss', phase, instanceId: value.instanceId, count: missing });
    }
    for (const row of log.rows) if (row.sequence > summary.lastSequence) retain({ code: 'renderer-diagnostic-error', phase,
      instanceId: value.instanceId, sequence: row.sequence, atMs: row.atMs, operation: row.operation,
      message: safeMessage(row.message).message });
    summary.lastSequence = log.total; summary.totalOccurrences = log.total;
  };
  const result = Object.freeze({ observe }); controllers.set(report, result); return result;
}
