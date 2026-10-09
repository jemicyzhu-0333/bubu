'use strict';
const { energyCurveTrials } = require('../../capabilities/guidance');
const { createGuidancePreviewStore } = require('../ai/guidance-preview-store');
const { entityFingerprint } = require('../ai/entity-fingerprint');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const TRIAL_ENERGY_CURVE_WRITES = Object.freeze(['energyCurveTrials']);
function createTrialEnergyCurveWorkflow({ unitOfWork, snapshot, clock, idFactory, sourceFor, comparisonFor,
  publish = () => {}, reportEffectError = () => {}, verifyUncommitted = () => false } = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof snapshot !== 'function'
    || typeof sourceFor !== 'function' || typeof comparisonFor !== 'function') throw new TypeError('curve trial requires UoW, snapshot and deterministic query ports');
  const tickets = createGuidancePreviewStore({ clock, idFactory });
  function preview(input) {
    const now = clock.now();
    const state = snapshot();
    const result = energyCurveTrials.previewCurveTrial(state, { input, now, trialId: idFactory(), source: sourceFor(state, now) });
    if (!result.ok) return result;
    const comparison = comparisonFor(state, result.trial, now);
    if (!comparison) return { ok: false, reason: 'curve-comparison-unavailable' };
    return tickets.put({ ...result, comparison, comparisonSourceVersion: entityFingerprint(state) });
  }
  function confirm({ previewId } = {}) {
    const previous = tickets.outcome(previewId, preview => verifyUncommitted('energyCurveTrials', preview.sourceVersion));
    if (previous) return previous;
    const ticket = tickets.start(previewId);
    if (!ticket) return { ok: false, reason: 'guidance-preview-expired' };
    if (ticket.result) return ticket.result;
    const now = clock.now();
    const result = unitOfWork.run({ writes: TRIAL_ENERGY_CURVE_WRITES, context: { now }, transition: state => {
      if (entityFingerprint(state) !== ticket.value.comparisonSourceVersion) return { ok: false, reason: 'curve-comparison-changed' };
      return energyCurveTrials.confirmCurveTrial(state, { preview: ticket.value, now, source: sourceFor(state, now) });
    } });
    if (!result.ok) {
      const response = { ok: false, reason: result.reason, ...(ticket.attempted ? { uncertain: true } : { committed: false }) };
      if (!ticket.attempted) tickets.complete(previewId, response);
      return response;
    }
    const response = { ok: true, changed: result.committed, version: result.version, trial: result.trial };
    tickets.complete(previewId, response);
    if (result.committed) runPostCommitEffect(publish, { ...result.fact, occurredAt: now }, reportEffectError);
    return response;
  }
  function undo({ trialId, expectedVersion } = {}) {
    const now = clock.now();
    const result = unitOfWork.run({ writes: TRIAL_ENERGY_CURVE_WRITES, context: { now }, transition: state =>
      energyCurveTrials.undoCurveTrial(state, { trialId, expectedVersion, now }) });
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.committed) runPostCommitEffect(publish, { ...result.fact, occurredAt: now }, reportEffectError);
    return { ok: true, changed: result.committed, version: result.version };
  }
  function cancel({ previewId } = {}) { return tickets.cancel(previewId); }
  return Object.freeze({ preview, confirm, undo, cancel });
}
module.exports = { TRIAL_ENERGY_CURVE_WRITES, createTrialEnergyCurveWorkflow };
