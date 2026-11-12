'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticReporter } = require('../tools/pet-realtime-capture/diagnostics.mjs');
const { createCaptureReport, appendCaptureError, finalizeReport, validateCapturePayload } = require('../tools/pet-realtime-capture/report.mjs');
const { encodeCapturePackage, decodeCapturePackage } = require('../tools/pet-realtime-capture/package.mjs');
const { createErrorJournal } = require('../src/surfaces/pet/realtime/error-journal.mjs');
const value = (total, { instanceId = 'renderer-0', message = 'runtime unavailable', operation = 'runtime-publication' } = {}) => ({
  instanceId, errorLog: { schemaVersion: 1, total, overwritten: Math.max(0, total - 8),
    rows: Array.from({ length: Math.min(total, 8) }, (_, index) => ({ sequence: Math.max(0, total - 8) + index + 1,
      atMs: index, operation, message })) }, errors: []
});
const draft = () => createCaptureReport({ runId: 'diagnostics-test' });

test('shared reporter deduplicates observations, not identical failures or new generations', () => {
  const report = draft(), reporter = diagnosticReporter(report);
  assert.equal(diagnosticReporter(report), reporter);
  for (let i = 0; i < 62; i++) reporter.observe(value(1), 'idle');
  assert.equal(report.errors.length, 1);
  reporter.observe(value(2), 'idle');
  reporter.observe(value(2, { instanceId: 'renderer-1' }), 'reload');
  assert.equal(report.errors.length, 4);
  assert.deepEqual(report.rendererDiagnostics.map(row => row.totalOccurrences), [2, 2]);
  assert.equal(report.errorAccounting.total, 4);
  validateCapturePayload(report);
});

test('journal rollover counts only unavailable occurrences, never already observed eviction', () => {
  const report = draft(), reporter = diagnosticReporter(report);
  reporter.observe(value(12));
  assert.equal(report.rendererDiagnostics[0].missingDetails, 4);
  reporter.observe(value(12));
  reporter.observe(value(15));
  assert.equal(report.rendererDiagnostics[0].missingDetails, 4);
  reporter.observe(value(30));
  const summary = report.rendererDiagnostics[0];
  assert.equal(summary.missingDetails, 11);
  assert.equal(summary.observedRows, 19);
  assert.equal(summary.totalOccurrences, 30);
  assert.equal(report.errors.filter(row => row.code === 'renderer-diagnostic-detail-loss').length, 2);
  validateCapturePayload(report);
});

test('full report detail capacity preserves exact occurrence, loss and truncation counts', () => {
  const report = draft();
  for (let i = 0; i < 64; i++) appendCaptureError(report, { code: 'earlier-observation' });
  const reporter = diagnosticReporter(report); reporter.observe(value(20)); reporter.observe(value(21));
  assert.equal(report.errors.length, 64);
  assert.deepEqual(report.errorAccounting, { total: 74, retained: 64, truncated: 10 });
  assert.deepEqual(report.rendererDiagnostics[0], { instanceId: 'renderer-0', evidence: 'sequence-journal',
    totalOccurrences: 21, observedRows: 9, missingDetails: 12, retainedDetails: 0, droppedDetails: 9, lastSequence: 21, lastPendingOperations: null });
  validateCapturePayload(report);
});

test('journal rejects malformed sequences, regressions and evidence downgrades without partial consumption', () => {
  const report = draft(), reporter = diagnosticReporter(report); reporter.observe(value(2));
  for (const change of [input => { input.errorLog.rows[1].sequence = 1; },
    input => { input.errorLog.total = 2.5; }, input => { input.errorLog.overwritten = 1; },
    input => { input.errorLog.rows[0].operation = 'untrusted-operation'; },
    input => { input.errorLog.rows[0].message = 'x'.repeat(2049); },
    input => { input.errorLog.rows[0].atMs = -1; }, input => { input.errorLog.extra = 'forbidden'; }]) {
    const input = value(2); change(input); assert.throws(() => reporter.observe(input), /diagnostic-error/);
  }
  assert.throws(() => reporter.observe(value(1)), /sequence-regressed/);
  assert.throws(() => reporter.observe({ instanceId: 'renderer-0', errors: [] }), /evidence-changed/);
  assert.equal(report.errors.length, 2);
});

test('retained diagnostics are bounded and sanitized before package persistence', () => {
  const report = draft(), reporter = diagnosticReporter(report);
  reporter.observe(value(1, { message: 'password="first-secret" token=second-secret C:\\Users\\Private Person\\secret.txt' }));
  reporter.observe(value(2, { message: 'password="other-secret" token=third-secret /Users/Private/file' }));
  const packaged = decodeCapturePackage(encodeCapturePackage(finalizeReport(report)));
  const serialized = JSON.stringify(packaged);
  assert.doesNotMatch(serialized, /first-secret|second-secret|other-secret|third-secret|Private|secret.txt/);
  assert.equal(packaged.rendererDiagnostics[0].totalOccurrences, 2);
  assert(packaged.errors.every(row => row.message.length <= 512));
  reporter.observe(value(3, { message: 'x'.repeat(2048) }));
  assert.equal(report.errors.at(-1).message.length, 512);
});

test('expanded aggregate causes remain one occurrence and are sanitized before package persistence', () => {
  const journal = createErrorJournal();
  const child = new Error('release failed token=synthetic-token password="synthetic-password"');
  child.stack = 'unrecorded-stack'; child.payload = 'unrecorded-payload';
  journal.record('cleanup-lifecycle', new AggregateError([
    child, new AggregateError([new Error('C:\\Users\\Private\\secret.txt'),
      'https://name:synthetic-credential@example.com/path'], 'nested cleanup')
  ], 'Pet lifecycle cleanup failed'));
  const report = draft(); diagnosticReporter(report).observe({ instanceId: 'aggregate-renderer', errorLog: journal.snapshot() });
  const packaged = decodeCapturePackage(encodeCapturePackage(finalizeReport(report)));
  assert.equal(packaged.rendererDiagnostics[0].totalOccurrences, 1);
  const serialized = JSON.stringify(packaged);
  assert.doesNotMatch(serialized, /synthetic-token|synthetic-password|synthetic-credential|Private|secret.txt|unrecorded-stack|unrecorded-payload/);
  assert.match(packaged.errors[0].message, /release failed/);
  assert(packaged.errors[0].message.length <= 512);
});

test('legacy observations retain useful details without asserting an occurrence count', () => {
  const report = draft(), reporter = diagnosticReporter(report);
  const input = { instanceId: 'legacy', errors: ['panel unavailable'] };
  reporter.observe(input); reporter.observe(input);
  assert.equal(report.errors.length, 1);
  input.errors.push('panel unavailable'); reporter.observe(input);
  const summary = report.rendererDiagnostics[0];
  assert.equal(summary.evidence, 'legacy-occurrence-count-unknown');
  assert.equal(summary.totalOccurrences, null); assert.equal(summary.lastSequence, null);
  assert.equal(summary.observedRows, 3);
  assert(report.errors.every(row => row.occurrenceCount === null));
  validateCapturePayload(report);
  const legacy = draft(); legacy.errors.push({ code: 'renderer-diagnostic-error', phase: 'idle' });
  assert.doesNotThrow(() => finalizeReport(legacy), 'old packages remain readable');
});

test('new report evidence fields reject invalid totals, identities and unbounded details', () => {
  const original = draft(); diagnosticReporter(original).observe(value(1));
  for (const change of [report => { report.errorAccounting.total++; },
    report => { report.rendererDiagnostics[0].missingDetails++; },
    report => { report.rendererDiagnostics[0].retainedDetails++; },
    report => { report.rendererDiagnostics.push({ ...report.rendererDiagnostics[0] }); },
    report => { report.errors[0].message = 'x'.repeat(513); },
    report => { report.errors[0].stack = 'unapproved raw stack'; },
    report => { delete report.rendererDiagnostics; },
    report => { report.errors[0].sequence = 2; }]) {
    const report = structuredClone(original); change(report); assert.throws(() => validateCapturePayload(report));
  }
});


test('producer message truncation cannot expose an unterminated quoted secret', () => {
  const report = draft();
  diagnosticReporter(report).observe(value(1, { message: ('password="' + 'fixture-sensitive-'.repeat(200)).slice(0, 2048) }));
  assert.doesNotMatch(JSON.stringify(report), /fixture-sensitive/);
  assert.match(report.errors[0].message, /redacted/);
});

test('late bounded observations downgrade completed status even when no detail slot remains', () => {
  const report = draft();
  for (let i = 0; i < 64; i++) appendCaptureError(report, { code: 'earlier' });
  report.status = 'completed'; report.capture = { status: 'completed' };
  appendCaptureError(report, { code: 'late-console-error' });
  assert.equal(report.status, 'completed-with-observations');
  assert.equal(report.capture.status, 'completed-with-observations');
  assert.equal(report.errorAccounting.truncated, 1);
});


test('diagnostic summaries preserve latest pending count without confusing unknown with zero', () => {
  const report = draft(), reporter = diagnosticReporter(report), input = value(0);
  input.pendingOperations = 2; reporter.observe(input);
  assert.equal(report.rendererDiagnostics[0].lastPendingOperations, 2);
  input.pendingOperations = 0; reporter.observe(input);
  assert.equal(report.rendererDiagnostics[0].lastPendingOperations, 0);
  delete input.pendingOperations; reporter.observe(input);
  assert.equal(report.rendererDiagnostics[0].lastPendingOperations, null);
  validateCapturePayload(report);
});
