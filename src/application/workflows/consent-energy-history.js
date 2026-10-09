'use strict';
const { energySelfReports, planningState } = require('../../capabilities/guidance');
const { createGuidancePreviewStore } = require('../ai/guidance-preview-store');
const CONSENT_ENERGY_HISTORY_WRITES = Object.freeze(['energySelfReports']);
function createConsentEnergyHistoryWorkflow({ unitOfWork, snapshot, clock, idFactory, verifyUncommitted = () => false } = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function' || typeof snapshot !== 'function') throw new TypeError('history consent requires UoW and snapshot');
  const tickets = createGuidancePreviewStore({ clock, idFactory });
  function preview(input) {
    if (!planningState.exact(input, ['enabled', 'clearHistory']) || typeof input.enabled !== 'boolean'
      || typeof input.clearHistory !== 'boolean') return { ok: false, reason: 'self-report-consent-invalid' };
    const store = snapshot().energySelfReports;
    planningState.validateEnergySelfReports(store);
    return tickets.put({ ok: true, ...input, expectedVersion: store.version,
      deletionCount: input.clearHistory ? store.events.length : 0, currentConsent: store.consentEnabled,
      collectionSource: 'explicit-current-user-self-report', historicalBackfill: false,
      deletesLegacyLatestCheckIn: false, externalTransmission: false });
  }
  function confirm({ previewId } = {}) {
    const previous = tickets.outcome(previewId, preview => verifyUncommitted('energySelfReports', preview.expectedVersion));
    if (previous) return previous;
    const ticket = tickets.start(previewId);
    if (!ticket) return { ok: false, reason: 'guidance-preview-expired' };
    if (ticket.result) return ticket.result;
    const now = clock.now();
    const result = unitOfWork.run({ writes: CONSENT_ENERGY_HISTORY_WRITES, context: { now },
      transition: state => energySelfReports.setSelfReportConsent(state, { ...ticket.value, now }) });
    if (!result.ok) {
      const response = { ok: false, reason: result.reason, ...(ticket.attempted ? { uncertain: true } : { committed: false }) };
      if (!ticket.attempted) tickets.complete(previewId, response);
      return response;
    }
    const response = { ok: true, changed: result.committed, version: result.version };
    tickets.complete(previewId, response);
    return response;
  }
  function cancel({ previewId } = {}) { return tickets.cancel(previewId); }
  return Object.freeze({ preview, confirm, cancel });
}
module.exports = { CONSENT_ENERGY_HISTORY_WRITES, createConsentEnergyHistoryWorkflow };
