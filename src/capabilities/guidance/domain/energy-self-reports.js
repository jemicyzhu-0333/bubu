'use strict';

// ARCHITECTURE「日常与能量」: a missing report is missing evidence. Enabling
// collection never copies the legacy latest check-in or reconstructs predictions.
const { localDayKey } = require('../../../core/calendar');
const v = require('../contract/planning-state');
const COVERAGE_WINDOW_MS = 30 * 86400000;
function setSelfReportConsent(state, { enabled, expectedVersion, now, clearHistory = false } = {}) {
  const store = state.energySelfReports;
  v.validateEnergySelfReports(store);
  if (typeof enabled !== 'boolean' || typeof clearHistory !== 'boolean' || !v.timestamp(now)) return { ok: false, reason: 'self-report-consent-invalid' };
  if (expectedVersion !== store.version) return { ok: false, reason: 'self-report-history-changed' };
  if (enabled === store.consentEnabled && (!clearHistory || !store.events.length)) return { ok: true, changed: false, version: store.version };
  state.energySelfReports = { version: store.version + 1, consentEnabled: enabled,
    consentedAt: enabled && !store.consentEnabled ? now : store.consentedAt,
    events: clearHistory ? [] : store.events };
  return { ok: true, changed: true, version: state.energySelfReports.version };
}
function appendSelfReport(state, { level, at, recordedAt = at, estimate = null } = {}) {
  const store = state.energySelfReports;
  // A pre-migration isolated fixture has no slice. It cannot imply consent.
  if (!store || !store.consentEnabled) return { ok: true, changed: false, reason: 'consent-disabled' };
  v.validateEnergySelfReports(store);
  if (!v.integer(level, 10, 90) || !v.timestamp(at) || !v.timestamp(recordedAt) || at > recordedAt
    || at < store.consentedAt || recordedAt - at > 5 * 60000) return { ok: true, changed: false, reason: 'not-current-consented-report' };
  if (store.events.some(event => event.at >= at)) return { ok: true, changed: false, reason: 'report-already-recorded' };
  const version = store.version + 1;
  const event = { id: `self-report:${at}`, at, dayKey: localDayKey(at), level,
    source: 'user-self-report', consentVersion: version,
    estimate: v.estimateValid(estimate) ? structuredClone(estimate) : null };
  state.energySelfReports = { ...store, version, events: [...store.events, event].slice(-v.MAX_SELF_REPORTS) };
  return { ok: true, changed: true, event };
}
function selfReportCoverage(state, now) {
  const store = state.energySelfReports;
  v.validateEnergySelfReports(store);
  if (!v.timestamp(now)) throw new TypeError('self-report coverage requires a timestamp');
  const events = store.events.filter(event => event.at <= now && event.at >= now - COVERAGE_WINDOW_MS);
  const coveredDays = new Set(events.map(event => event.dayKey)).size;
  const firstAt = events[0]?.at ?? null;
  const lastAt = events.at(-1)?.at ?? null;
  const elapsedDays = firstAt === null ? 0 : (lastAt - firstAt) / 86400000;
  const sufficient = events.length >= 10 && coveredDays >= 7 && elapsedDays >= 7;
  return { consentEnabled: store.consentEnabled, version: store.version, sampleCount: events.length,
    coveredDays, elapsedDays, firstAt, lastAt, windowDays: 30, requiredSamples: 10, requiredDays: 7,
    eligible: store.consentEnabled && sufficient,
    reason: !store.consentEnabled ? 'self-report-consent-required' : sufficient ? null : 'self-report-coverage-insufficient',
    evidenceRefs: events.map(event => event.id), historicalPredictionAvailable: events.every(event => event.estimate !== null) && events.length > 0,
    missingPredictionCount: events.filter(event => event.estimate === null).length };
}
module.exports = { COVERAGE_WINDOW_MS, setSelfReportConsent, appendSelfReport, selfReportCoverage };
