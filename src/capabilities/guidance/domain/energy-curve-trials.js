'use strict';

// ARCHITECTURE「日常与能量」: a trial is a reversible, expiring interpretation
// overlay. It does not rewrite observations, reports, routine effects or profile.
const { id, jsonValue } = require('../../../core/ai-change-protocol');
const { BASELINE_EDITABLE_BOUNDS } = require('../../../content/energy-effects.mjs');
const { selfReportCoverage } = require('./energy-self-reports');
const { scopeExpiry } = require('./planning-preferences');
const v = require('../contract/planning-state');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function curveSource({ profile = null, baseline } = {}) {
  if (!v.baselineValid(baseline) || !jsonValue(profile)) return null;
  const version = canonical({ modelVersion: 'energy-curve:1', profile, baseline });
  if (version.length > 4096) return null;
  return { version, baseline: structuredClone(baseline) };
}
function sourceValid(source) {
  return v.exact(source, ['version', 'baseline']) && v.baselineValid(source.baseline)
    && typeof source.version === 'string' && source.version.length > 0 && source.version.length <= 4096;
}
function previewCurveTrial(state, { input, now, trialId, source } = {}) {
  v.validateEnergyCurveTrials(state.energyCurveTrials);
  if (!v.exact(input, ['parameter', 'to', 'scope']) || !v.TRIAL_PARAMETERS.includes(input.parameter)
    || !['today', '7days'].includes(input.scope) || !v.timestamp(now) || !id(trialId)
    || !sourceValid(source)) return { ok: false, reason: 'curve-trial-invalid' };
  const coverage = selfReportCoverage(state, now);
  if (!coverage.eligible) return { ok: false, reason: coverage.reason, coverage };
  const active = state.energyCurveTrials.active;
  if (active && now < active.expiresAt) return { ok: false, reason: 'curve-trial-active' };
  const from = source.baseline[input.parameter];
  const [min, max] = BASELINE_EDITABLE_BOUNDS[input.parameter];
  const maximumStep = (max - min) * 0.02;
  if (!Number.isInteger(input.to) || input.to < min || input.to > max || input.to === from
    || Math.abs(input.to - from) > maximumStep) return { ok: false, reason: 'curve-trial-step-outside-limit', maximumStep };
  const trial = { id: trialId, version: state.energyCurveTrials.version + 1,
    parameter: input.parameter, from, to: input.to, scope: input.scope, startsAt: now,
    expiresAt: scopeExpiry(input.scope, now), sourceVersion: source.version,
    sourceBaseline: structuredClone(source.baseline), sourceReportsVersion: coverage.version,
    evidenceRefs: coverage.evidenceRefs,
    coverage: { sampleCount: coverage.sampleCount, coveredDays: coverage.coveredDays, firstAt: coverage.firstAt, lastAt: coverage.lastAt } };
  return { ok: true, sourceVersion: state.energyCurveTrials.version, trial, coverage, maximumStep,
    uncertainty: 'nonmedical-estimate;coverage-is-an-engineering-gate-not-validation;no-causal-or-efficacy-claim',
    changedParameters: [{ parameter: trial.parameter, before: trial.from, after: trial.to }],
    comparisonBaseline: { ...source.baseline, [trial.parameter]: trial.to } };
}
function confirmCurveTrial(state, { preview, now, source } = {}) {
  const store = state.energyCurveTrials;
  v.validateEnergyCurveTrials(store);
  if (!preview?.ok || !v.timestamp(now) || !v.trialValid(preview.trial) || !sourceValid(source)
    || now < preview.trial.startsAt || now >= preview.trial.expiresAt) return { ok: false, reason: 'curve-preview-invalid' };
  if (store.version !== preview.sourceVersion || source.version !== preview.trial.sourceVersion
    || canonical(source.baseline) !== canonical(preview.trial.sourceBaseline)) return { ok: false, reason: 'curve-source-changed' };
  const coverage = selfReportCoverage(state, now);
  if (!coverage.eligible || coverage.version !== preview.trial.sourceReportsVersion
    || canonical(coverage.evidenceRefs) !== canonical(preview.trial.evidenceRefs)) return { ok: false, reason: 'self-report-history-changed' };
  const trial = { ...structuredClone(preview.trial), startsAt: now };
  state.energyCurveTrials = { version: store.version + 1, active: trial,
    undo: { id: trial.id, appliedVersion: store.version + 1, expiresAt: trial.expiresAt } };
  return { ok: true, changed: true, version: state.energyCurveTrials.version, trial,
    fact: { type: 'energy.profile.changed', action: 'trial-confirmed', oldVersion: store.version,
      newVersion: state.energyCurveTrials.version, evidenceRefs: trial.evidenceRefs, trialId: trial.id } };
}
function undoCurveTrial(state, { trialId, expectedVersion, now } = {}) {
  const store = state.energyCurveTrials;
  v.validateEnergyCurveTrials(store);
  if (!v.timestamp(now) || !store.active || !store.undo || store.active.id !== trialId
    || now >= store.undo.expiresAt) return { ok: false, reason: 'curve-undo-unavailable' };
  if (expectedVersion !== store.version) return { ok: false, reason: 'curve-source-changed' };
  state.energyCurveTrials = { version: store.version + 1, active: null, undo: null };
  return { ok: true, changed: true, version: state.energyCurveTrials.version,
    fact: { type: 'energy.profile.changed', action: 'trial-undone', oldVersion: store.version,
      newVersion: state.energyCurveTrials.version, evidenceRefs: store.active.evidenceRefs, trialId } };
}
function curveTrialStatus(state, { source, now } = {}) {
  const trial = state.energyCurveTrials?.active;
  if (!trial) return { active: false, reason: 'no-curve-trial', trial: null };
  if (!v.timestamp(now) || now < trial.startsAt || now >= trial.expiresAt) return { active: false, reason: 'curve-trial-expired', trial: structuredClone(trial) };
  if (!sourceValid(source) || source.version !== trial.sourceVersion
    || canonical(source.baseline) !== canonical(trial.sourceBaseline)) return { active: false, reason: 'curve-source-changed', trial: structuredClone(trial) };
  if (!state.energySelfReports?.consentEnabled || !trial.evidenceRefs.every(ref => state.energySelfReports.events.some(event => event.id === ref))) {
    return { active: false, reason: 'curve-trial-evidence-unavailable', trial: structuredClone(trial) };
  }
  return { active: true, reason: null, trial: structuredClone(trial),
    overlay: { baseline: { ...source.baseline, [trial.parameter]: trial.to }, startsAt: trial.startsAt, expiresAt: trial.expiresAt } };
}
module.exports = { curveSource, sourceValid, previewCurveTrial, confirmCurveTrial, undoCurveTrial, curveTrialStatus };
