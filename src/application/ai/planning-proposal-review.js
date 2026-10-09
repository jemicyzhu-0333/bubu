'use strict';
const { validatePlanningPreferenceCandidate } = require('../../core/ai-personalization-protocol');
const { entityFingerprint } = require('./entity-fingerprint');
const { sourceRefsValid } = require('./conversation-record');
const { planningPreferences } = require('../../capabilities/guidance');

// Resolve only an owned canonical message. Renderer edits can change the draft
// values, but never its target, source lineage or authority to use those sources.
function createPlanningProposalReview({ getConversation, validateContextVersions, isContextMessageAllowed, readSnapshot, clock } = {}) {
  function load({ conversationId, proposalId }, { validateSources = true } = {}) {
    try {
      if (![getConversation, validateContextVersions, isContextMessageAllowed].every(port => typeof port === 'function')) {
        return { ok: false, reason: 'planning-proposal-unavailable' };
      }
      const loaded = getConversation({ conversationId });
      if (!loaded?.ok || loaded.conversation?.id !== conversationId) return { ok: false, reason: 'planning-proposal-unavailable' };
      const matches = loaded.conversation.messages.filter(item => item.role === 'assistant' && item.proposal?.id === proposalId);
      const message = matches.length === 1 ? matches[0] : null;
      if (!message || message.proposal.kind !== 'planning-preference-candidate' || !sourceRefsValid(message.sourceRefs)
        || validateSources && (message.contextAllowed !== true || isContextMessageAllowed(message, { conversationId }) !== true
        || validateContextVersions(message.sourceRefs) !== true)) return { ok: false, reason: 'planning-proposal-source-changed' };
      const body = JSON.parse(message.proposal.body);
      if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'planningPreference')) throw new Error('invalid candidate');
      const input = validatePlanningPreferenceCandidate(body.planningPreference);
      if (input.id !== null && !message.sourceRefs.some(ref => ref.kind === 'planning-preference' && ref.id === input.id && typeof ref.revision === 'string')) {
        return { ok: false, reason: 'planning-proposal-target-not-read' };
      }
      return { ok: true, input, provenance: { conversationId, proposalId, messageId: message.id,
        proposalVersion: message.proposal.version, proposalHash: entityFingerprint(message.proposal), sourceRefs: structuredClone(message.sourceRefs) } };
    } catch (_) { return { ok: false, reason: 'planning-proposal-invalid' }; }
  }
  function currentTarget(input, provenance, state) {
    if (input.id === null) return true;
    const target = state.planningPreferences.items.find(item => item.id === input.id);
    return Boolean(target && target.updatedAt <= clock.now() && (target.expiresAt === null || clock.now() < target.expiresAt)
      && provenance.sourceRefs.some(ref => ref.kind === 'planning-preference' && ref.id === target.id && ref.revision === entityFingerprint(target)));
  }
  function prepare(request) {
    const owned = load(request, { validateSources: false });
    if (!owned.ok) return owned;
    const previous = planningPreferences.lookupPlanningPreferenceReceipt(readSnapshot(), {
      origin: { conversationId: request.conversationId, proposalId: request.proposalId }, now: clock.now() });
    if (previous.ok) return { ok: false, reason: 'planning-proposal-already-reviewed',
      preferenceId: previous.receipt.preferenceId, receiptId: previous.receipt.receiptId, status: previous.status };
    const result = load(request);
    if (!result.ok) return result;
    let input;
    try { input = request.input === undefined ? result.input : validatePlanningPreferenceCandidate(request.input); }
    catch (_) { return { ok: false, reason: 'planning-proposal-invalid' }; }
    if (input.id !== result.input.id) return { ok: false, reason: 'planning-proposal-target-mismatch' };
    const state = readSnapshot();
    if (!currentTarget(result.input, result.provenance, state)) return { ok: false, reason: 'planning-proposal-source-changed' };
    const preferenceId = `planning-proposal:${entityFingerprint([request.conversationId, request.proposalId])}`;
    if (input.id === null && state.planningPreferences.items.some(item => item.id === preferenceId)) {
      return { ok: false, reason: 'planning-proposal-already-reviewed', preferenceId };
    }
    return { ok: true, input, preferenceId, provenance: result.provenance };
  }
  function validate(provenance, state) {
    const result = load(provenance);
    return result.ok && entityFingerprint(result.provenance) === entityFingerprint(provenance)
      && currentTarget(result.input, provenance, state);
  }
  return Object.freeze({ prepare, validate });
}
module.exports = { createPlanningProposalReview };
