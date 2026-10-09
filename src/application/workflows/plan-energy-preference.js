'use strict';
const { planningPreferences } = require('../../capabilities/guidance');
const { createGuidancePreviewStore } = require('../ai/guidance-preview-store');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const PLAN_ENERGY_PREFERENCE_WRITES = Object.freeze(['planningPreferences']);
function createPlanEnergyPreferenceWorkflow({ unitOfWork, snapshot, clock, idFactory, publish = () => {}, reportEffectError = () => {},
  validateProvenance = () => false, verifyUncommitted = () => false } = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof snapshot !== 'function') throw new TypeError('planning preference requires UoW and snapshot');
  const tickets = createGuidancePreviewStore({ clock, idFactory });
  function preview(input, { preferenceId, provenance, replacePreviewId } = {}) {
    const state = snapshot();
    if (provenance && !validateProvenance(provenance, state)) return { ok: false, reason: 'planning-proposal-source-changed' };
    if (replacePreviewId) {
      const previous = tickets.get(replacePreviewId);
      if (!provenance || !previous || previous.result || JSON.stringify(previous.value.provenance) !== JSON.stringify(provenance)) {
        return { ok: false, reason: 'planning-proposal-preview-conflict' };
      }
    }
    const result = planningPreferences.previewPlanningPreference(state, { input, now: clock.now(), preferenceId: preferenceId || idFactory() });
    if (!result.ok) return result;
    if (replacePreviewId) tickets.cancel(replacePreviewId);
    return tickets.put({ ...result, ...(provenance ? { provenance } : {}) });
  }
  function confirm({ previewId } = {}) {
    const previous = tickets.outcome(previewId, preview => verifyUncommitted('planningPreferences', preview.sourceVersion));
    if (previous) return previous;
    const ticket = tickets.start(previewId);
    if (!ticket) return { ok: false, reason: 'guidance-preview-expired' };
    if (ticket.result) return ticket.result;
    const now = clock.now();
    const result = unitOfWork.run({ writes: PLAN_ENERGY_PREFERENCE_WRITES, context: { now },
      transition: state => ticket.value.provenance && !validateProvenance(ticket.value.provenance, state)
        ? { ok: false, reason: 'planning-proposal-source-changed' }
        : planningPreferences.confirmPlanningPreference(state, { preview: ticket.value, now, receiptId: previewId,
          origin: ticket.value.provenance ? { conversationId: ticket.value.provenance.conversationId, proposalId: ticket.value.provenance.proposalId } : null }) });
    if (!result.ok) {
      const response = { ok: false, reason: result.reason, ...(ticket.attempted ? { uncertain: true } : { committed: false }) };
      if (!ticket.attempted) tickets.complete(previewId, response);
      return response;
    }
    const response = { ok: true, changed: result.committed, version: result.version, receiptId: result.receiptId, after: result.after, receipt: result.receipt };
    tickets.complete(previewId, response);
    if (result.committed) runPostCommitEffect(publish, { type: 'planning.preference.changed', action: 'confirmed',
      receiptId: result.receiptId, oldVersion: ticket.value.sourceVersion, newVersion: result.version, occurredAt: now }, reportEffectError);
    return response;
  }
  function undo({ receiptId, expectedVersion } = {}) {
    const now = clock.now();
    const result = unitOfWork.run({ writes: PLAN_ENERGY_PREFERENCE_WRITES, context: { now },
      transition: state => planningPreferences.undoPlanningPreference(state, { receiptId, expectedVersion, now }) });
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.committed) runPostCommitEffect(publish, { type: 'planning.preference.changed', action: 'undone', receiptId,
      oldVersion: expectedVersion, newVersion: result.version, occurredAt: now }, reportEffectError);
    return { ok: true, changed: result.committed, version: result.version };
  }
  function cancel({ previewId } = {}) { return tickets.cancel(previewId); }
  return Object.freeze({ preview, confirm, undo, cancel });
}
module.exports = { PLAN_ENERGY_PREFERENCE_WRITES, createPlanEnergyPreferenceWorkflow };
