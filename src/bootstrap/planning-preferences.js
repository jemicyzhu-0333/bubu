'use strict';
const { preferences, guidance } = require('../capabilities');
const { createPlanEnergyPreferenceWorkflow } = require('../application/workflows/plan-energy-preference');
const { createConsentEnergyHistoryWorkflow } = require('../application/workflows/consent-energy-history');
const { createTrialEnergyCurveWorkflow } = require('../application/workflows/trial-energy-curve');
const { buildPlanningGuidanceView } = require('../application/queries/planning-guidance-view');
const { buildEnergyCurveSource, buildEnergyTrialComparison, capturePlanningEstimate } = require('../application/queries/energy-curve-view');
const { runPostCommitEffect } = require('../shared/post-commit-effects');
const { localDayKey } = require('../core/calendar');
const { BASELINE_EDITABLE_BOUNDS } = require('../content/energy-effects.mjs');
const { createPlanningProposalReview } = require('../application/ai/planning-proposal-review');

// Local-only planning controls, independent of AI enablement, credentials or
// Provider availability. Every write still goes through its canonical workflow.
function createPlanningPreferences({ unitOfWork, readSnapshot, clock, idFactory, getPomodoro = () => null,
  publishChange = () => {}, publishFact = () => {}, reportEffectError = () => {},
  getConversation, validateContextVersions, isContextMessageAllowed, durability = null } = {}) {
  if (typeof readSnapshot !== 'function' || !clock || typeof clock.now !== 'function'
    || typeof getPomodoro !== 'function') throw new TypeError('planning controls require snapshot, clock and projection ports');
  function inputs(snapshot, now) {
    const settings = preferences.normalizeSettings(snapshot.settings);
    return { snapshot, settings, now, at: now, dayKey: localDayKey(now),
      workStartHour: preferences.workSchedule.getWorkHours(settings).start, pomodoro: getPomodoro() };
  }
  function publish(fact) {
    try { publishFact(fact); } finally { publishChange({ energy: true, recommendations: true }); }
  }
  function verifyUncommitted(slice, version) {
    if (typeof durability?.verify !== 'function' || durability.verify()?.ok !== true) return false;
    return readSnapshot()?.[slice]?.version === version;
  }
  const ports = { unitOfWork, snapshot: readSnapshot, clock, idFactory, publish, reportEffectError, verifyUncommitted };
  const proposals = createPlanningProposalReview({ getConversation, validateContextVersions, isContextMessageAllowed, readSnapshot, clock });
  const preference = createPlanEnergyPreferenceWorkflow({ ...ports, validateProvenance: proposals.validate });
  const history = createConsentEnergyHistoryWorkflow(ports);
  const trial = createTrialEnergyCurveWorkflow({ ...ports,
    sourceFor: (snapshot, now) => buildEnergyCurveSource(inputs(snapshot, now)),
    comparisonFor: (snapshot, value, now) => buildEnergyTrialComparison({ ...inputs(snapshot, now), trial: value }) });
  function get() {
    const snapshot = readSnapshot(), now = clock.now();
    const input = inputs(snapshot, now);
    const view = buildPlanningGuidanceView(input);
    const source = buildEnergyCurveSource(input);
    const parameters = view.editableParameters.map(parameter => {
      const [minimum, maximum] = BASELINE_EDITABLE_BOUNDS[parameter];
      return { parameter, current: source?.baseline[parameter] ?? null, minimum, maximum,
        maximumStep: Math.floor((maximum - minimum) * 0.02) };
    });
    const preferenceUndo = snapshot.planningPreferences.undo;
    const trialUndo = snapshot.energyCurveTrials.undo;
    return { ok: true, view: { ...view, parameters, storedPreferences: structuredClone(snapshot.planningPreferences.items),
      receiptCount: snapshot.planningPreferences.receipts.length, receiptCapacity: guidance.planningState.MAX_PLANNING_RECEIPTS,
      preferenceUndo: preferenceUndo && now < preferenceUndo.expiresAt
        ? { receiptId: preferenceUndo.id, expectedVersion: preferenceUndo.appliedVersion, expiresAt: preferenceUndo.expiresAt } : null,
      trialUndo: trialUndo && now < trialUndo.expiresAt
        ? { trialId: trialUndo.id, expectedVersion: trialUndo.appliedVersion, expiresAt: trialUndo.expiresAt } : null,
      collectionEnabled: snapshot.energySelfReports.consentEnabled, retainedReportCount: snapshot.energySelfReports.events.length } };
  }
  function register(registerIpc) {
    registerIpc('planning:get', () => get());
    registerIpc('planning:preview-cancel', (_event, { kind, previewId }) => ({ preference, history, trial })[kind].cancel({ previewId }));
    registerIpc('planning:proposal-preview', (_event, request) => {
      const resolved = proposals.prepare(request);
      return resolved.ok ? preference.preview(resolved.input, { preferenceId: resolved.preferenceId,
        provenance: resolved.provenance, replacePreviewId: request.replacePreviewId }) : resolved;
    });
    registerIpc('planning:preference-preview', (_event, value) => preference.preview(value));
    registerIpc('planning:preference-confirm', (_event, value) => preference.confirm(value));
    registerIpc('planning:preference-undo', (_event, value) => preference.undo(value));
    registerIpc('planning:history-preview', (_event, value) => history.preview(value));
    registerIpc('planning:history-confirm', (_event, value) => {
      const result = history.confirm(value);
      if (result.ok && result.changed) {
        runPostCommitEffect(publishChange, { energy: true, recommendations: true },
          error => reportEffectError(error, 'planning:history-confirm'));
      }
      return result;
    });
    registerIpc('planning:trial-preview', (_event, value) => trial.preview(value));
    registerIpc('planning:trial-confirm', (_event, value) => trial.confirm(value));
    registerIpc('planning:trial-undo', (_event, value) => trial.undo(value));
  }
  return Object.freeze({ register, get,
    receipt: request => guidance.planningPreferences.lookupPlanningPreferenceReceipt(readSnapshot(), { ...request, now: clock.now() }),
    captureEstimate: (snapshot, at) => capturePlanningEstimate(inputs(snapshot, at)) });
}
module.exports = { createPlanningPreferences };
