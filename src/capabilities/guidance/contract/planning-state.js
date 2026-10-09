'use strict';

// ARCHITECTURE「日常与能量」: preferences, explicit reports and trials are separate
// values. Normalization is strict and time-independent; it never invents history.
const { closed, id, jsonValue, day } = require('../../../core/ai-change-protocol');
const { BASELINE_EDITABLE_BOUNDS } = require('../../../content/energy-effects.mjs');
const MAX_PREFERENCES = 24;
const MAX_PLANNING_RECEIPTS = 512;
const MAX_SELF_REPORTS = 240;
const MAX_TRIAL_EVIDENCE = MAX_SELF_REPORTS;
const TRIAL_PARAMETERS = Object.freeze(['chronotypeShift', 'morningRampMinutes']);
const SCOPES = Object.freeze(['today', '7days', 'saved']);
const exact = (value, keys) => closed(value, keys) && Object.keys(value).length === keys.length;
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value)
  && !Object.is(value, -0) && value >= min && value <= max;
const timestamp = value => integer(value, 0, 8.64e15);
function assert(value, reason) { if (!value) throw new TypeError(`planning-state-invalid:${reason}`); }
function normalize(value, validate) {
  assert(jsonValue(value), 'json'); validate(value); return structuredClone(value);
}
function preferenceValid(value) {
  return exact(value, ['id', 'version', 'startMinute', 'endMinute', 'demand', 'scope', 'createdAt', 'updatedAt', 'expiresAt', 'source'])
    && id(value.id) && integer(value.version, 1) && integer(value.startMinute, 0, 1439)
    && integer(value.endMinute, 1, 1440) && value.endMinute > value.startMinute
    && ['low', 'medium', 'high'].includes(value.demand) && SCOPES.includes(value.scope)
    && timestamp(value.createdAt) && timestamp(value.updatedAt) && value.updatedAt >= value.createdAt
    && (value.scope === 'saved' ? value.expiresAt === null : timestamp(value.expiresAt) && value.expiresAt > value.createdAt)
    && value.source === 'user-confirmed';
}
function preferenceOriginValid(value) {
  return value === null || exact(value, ['conversationId', 'proposalId']) && id(value.conversationId) && id(value.proposalId);
}
function preferenceReceiptValid(value) {
  return exact(value, ['receiptId', 'preferenceId', 'beforeVersion', 'afterVersion', 'committedAt', 'origin', 'revertedAt', 'revertedVersion'])
    && id(value.receiptId) && id(value.preferenceId) && integer(value.afterVersion, 1)
    && (value.beforeVersion === null ? value.afterVersion === 1 : integer(value.beforeVersion, 1) && value.afterVersion === value.beforeVersion + 1)
    && timestamp(value.committedAt) && preferenceOriginValid(value.origin)
    && (value.revertedAt === null ? value.revertedVersion === null : timestamp(value.revertedAt) && value.revertedAt >= value.committedAt
      && (value.beforeVersion === null ? value.revertedVersion === null : value.revertedVersion === value.afterVersion + 1));
}
function validatePlanningPreferences(value) {
  assert(exact(value, ['version', 'items', 'undo', 'receipts']) && integer(value.version), 'preferences');
  assert(Array.isArray(value.items) && value.items.length <= MAX_PREFERENCES
    && value.items.every(item => preferenceValid(item) && item.version <= value.version) && new Set(value.items.map(item => item.id)).size === value.items.length, 'items');
  assert(Array.isArray(value.receipts) && value.receipts.length <= MAX_PLANNING_RECEIPTS
    && value.receipts.every(receipt => preferenceReceiptValid(receipt) && receipt.afterVersion <= value.version
      && (receipt.revertedVersion === null || receipt.revertedVersion <= value.version))
    && new Set(value.receipts.map(receipt => receipt.receiptId)).size === value.receipts.length, 'preference-receipts');
  const origins = value.receipts.filter(receipt => receipt.origin !== null).map(receipt => JSON.stringify([receipt.origin.conversationId, receipt.origin.proposalId]));
  assert(new Set(origins).size === origins.length, 'preference-receipt-origins');
  if (value.undo === null) return;
  const undo = value.undo;
  assert(exact(undo, ['id', 'appliedVersion', 'before', 'after', 'expiresAt']) && id(undo.id)
    && undo.appliedVersion === value.version && timestamp(undo.expiresAt)
    && (undo.before === null || preferenceValid(undo.before)) && preferenceValid(undo.after)
    && (undo.before === null || undo.before.id === undo.after.id)
    && value.receipts.some(receipt => receipt.receiptId === undo.id && receipt.preferenceId === undo.after.id
      && receipt.afterVersion === undo.after.version && receipt.beforeVersion === (undo.before?.version ?? null) && receipt.revertedAt === null)
    && value.items.some(item => JSON.stringify(item) === JSON.stringify(undo.after)), 'preference-undo');
}
function estimateValid(value) {
  return exact(value, ['modelLevel', 'sourceVersion', 'baseline']) && Number.isFinite(value.modelLevel)
    && value.modelLevel >= 10 && value.modelLevel <= 90 && baselineValid(value.baseline)
    && typeof value.sourceVersion === 'string' && value.sourceVersion.length > 0 && value.sourceVersion.length <= 4096;
}
function reportValid(value) {
  return exact(value, ['id', 'at', 'dayKey', 'level', 'source', 'consentVersion', 'estimate'])
    && id(value.id) && timestamp(value.at) && typeof value.dayKey === 'string' && day(value.dayKey)
    && integer(value.level, 10, 90) && value.source === 'user-self-report' && integer(value.consentVersion, 1)
    && (value.estimate === null || estimateValid(value.estimate));
}
function validateEnergySelfReports(value) {
  assert(exact(value, ['version', 'consentEnabled', 'consentedAt', 'events']) && integer(value.version)
    && typeof value.consentEnabled === 'boolean'
    && (value.consentedAt === null ? !value.consentEnabled : timestamp(value.consentedAt)), 'self-reports');
  assert(Array.isArray(value.events) && value.events.length <= MAX_SELF_REPORTS
    && value.events.every(report => reportValid(report) && report.consentVersion <= value.version)
    && new Set(value.events.map(report => report.id)).size === value.events.length
    && value.events.every((report, index) => !index || report.at > value.events[index - 1].at)
    && (value.events.length === 0 || value.consentedAt !== null), 'report-events');
}
function baselineValid(value) {
  return exact(value, Object.keys(BASELINE_EDITABLE_BOUNDS))
    && Object.entries(BASELINE_EDITABLE_BOUNDS).every(([key, [min, max]]) => Number.isFinite(value[key])
      && value[key] >= min && value[key] <= max);
}
function trialValid(value) {
  if (!exact(value, ['id', 'version', 'parameter', 'from', 'to', 'scope', 'startsAt', 'expiresAt', 'sourceVersion', 'sourceBaseline', 'sourceReportsVersion', 'evidenceRefs', 'coverage'])) return false;
  if (!id(value.id) || !integer(value.version, 1) || !TRIAL_PARAMETERS.includes(value.parameter)
    || !['today', '7days'].includes(value.scope) || !timestamp(value.startsAt)
    || !timestamp(value.expiresAt) || value.expiresAt <= value.startsAt
    || value.expiresAt - value.startsAt > 8 * 86400000 || !baselineValid(value.sourceBaseline)
    || typeof value.sourceVersion !== 'string' || value.sourceVersion.length < 1 || value.sourceVersion.length > 4096
    || !integer(value.sourceReportsVersion, 1) || !integer(value.from, -120, 240) || !integer(value.to, -120, 240)) return false;
  const [min, max] = BASELINE_EDITABLE_BOUNDS[value.parameter];
  if (value.from !== value.sourceBaseline[value.parameter] || value.to < min || value.to > max
    || value.to === value.from || Math.abs(value.to - value.from) > (max - min) * 0.02) return false;
  return Array.isArray(value.evidenceRefs) && value.evidenceRefs.length >= 10 && value.evidenceRefs.length <= MAX_TRIAL_EVIDENCE
    && value.evidenceRefs.every(id) && new Set(value.evidenceRefs).size === value.evidenceRefs.length
    && exact(value.coverage, ['sampleCount', 'coveredDays', 'firstAt', 'lastAt'])
    && value.coverage.sampleCount === value.evidenceRefs.length && integer(value.coverage.coveredDays, 7, MAX_SELF_REPORTS)
    && timestamp(value.coverage.firstAt) && timestamp(value.coverage.lastAt)
    && value.coverage.lastAt - value.coverage.firstAt >= 7 * 86400000 && value.coverage.lastAt <= value.startsAt;
}
function validateEnergyCurveTrials(value) {
  assert(exact(value, ['version', 'active', 'undo']) && integer(value.version), 'curve-trials');
  assert(value.active === null || trialValid(value.active) && value.active.version === value.version, 'active-trial');
  if (value.undo === null) return;
  assert(exact(value.undo, ['id', 'appliedVersion', 'expiresAt']) && id(value.undo.id)
    && value.undo.appliedVersion === value.version && timestamp(value.undo.expiresAt)
    && value.active !== null && value.undo.id === value.active.id, 'trial-undo');
}
const createPlanningPreferences = () => ({ version: 0, items: [], undo: null, receipts: [] });
const createEnergySelfReports = () => ({ version: 0, consentEnabled: false, consentedAt: null, events: [] });
const createEnergyCurveTrials = () => ({ version: 0, active: null, undo: null });
module.exports = { MAX_PREFERENCES, MAX_PLANNING_RECEIPTS, MAX_SELF_REPORTS, TRIAL_PARAMETERS, SCOPES, exact, integer, timestamp,
  baselineValid, preferenceValid, preferenceOriginValid, preferenceReceiptValid, estimateValid, reportValid, trialValid, createPlanningPreferences, createEnergySelfReports, createEnergyCurveTrials,
  validatePlanningPreferences, validateEnergySelfReports, validateEnergyCurveTrials,
  normalizePlanningPreferences: value => normalize(value, validatePlanningPreferences),
  normalizeEnergySelfReports: value => normalize(value, validateEnergySelfReports),
  normalizeEnergyCurveTrials: value => normalize(value, validateEnergyCurveTrials) };
