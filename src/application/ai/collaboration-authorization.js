'use strict';

const COLLABORATION_KEYS = Object.freeze(['aiBreakdownEnabled', 'aiClarifyEnabled', 'aiMemoryEnabled', 'aiModel', 'aiBaseUrl']);
const REQUEST_KEYS = Object.freeze([...COLLABORATION_KEYS, 'aiImpulseEnergyEnabled', 'aiCaptureTriageEnabled', 'aiPetMealsEnabled']);
const REASONS = Object.freeze(['authorization-changed', 'provider-changed', 'credentials-changed']);

// One application authority owns admission and the existing provider generation.
// A write-in-progress blocks new admissions without revoking prior work.
function createCollaborationAuthorization({ capturePrivacyTargets, captureScopes, captureRunOwners,
  clearGrants, revokeSession, invalidateProposals = () => {}, invalidateRequests = () => {},
  notifyProviderChanged = () => {} } = {}) {
  for (const port of [capturePrivacyTargets, captureScopes, captureRunOwners, clearGrants,
    revokeSession, invalidateProposals, invalidateRequests, notifyProviderChanged]) {
    if (typeof port !== 'function') throw new TypeError('collaboration-authorization-ports-invalid');
  }
  let providerEpoch = 0, held = false, unavailable = false, closed = false;
  const isReadable = () => !closed && !unavailable;
  const captureAdmission = () => !held && isReadable() ? Object.freeze({ generation: providerEpoch }) : null;
  const isExistingCurrent = ticket => Boolean(ticket && ticket.generation === providerEpoch && isReadable());
  const isAdmissionCurrent = ticket => !held && isExistingCurrent(ticket);
  const refused = () => ({ ok: false, reason: unavailable || closed ? 'authorization-unavailable' : 'authorization-busy' });
  const unknownWarning = () => Object.freeze({ code: 'collaboration-authorization-incomplete',
    pendingConversations: null, unsavedConversations: null, unknownSaves: null,
    unconfirmedClosures: null, unconfirmedNotifications: null, authorityUnavailable: unavailable });

  function retire(reason, { requests = false, notify = false, privacy = true } = {}) {
    providerEpoch += 1;
    const warning = { code: 'collaboration-authorization-incomplete', pendingConversations: 0,
      unsavedConversations: 0, unknownSaves: 0, unconfirmedClosures: 0,
      unconfirmedNotifications: 0, authorityUnavailable: false };
    function add(key) { if (warning[key] !== null) warning[key] += 1; }
    function unknownTargets() {
      unavailable = true;
      for (const key of ['pendingConversations', 'unsavedConversations', 'unknownSaves', 'unconfirmedNotifications']) warning[key] = null;
    }
    let targets = [], scopes = [], runs = [], pendingCountKnown = true;
    try { targets = capturePrivacyTargets(); }
    catch (_) { pendingCountKnown = false; unknownTargets(); }
    try { scopes = captureScopes(); }
    catch (_) { unknownTargets(); }
    try { runs = captureRunOwners(); }
    catch (_) { pendingCountKnown = false; warning.unconfirmedClosures = null; unknownTargets(); }
    const byId = new Map(targets.map(target => [target.conversationId, target]));
    const ids = new Set([...byId.keys(), ...scopes.map(scope => scope.conversationId), ...runs.map(run => run.conversationId)]);
    // Count the actual session token before mark/revoke changes that witness.
    let canceled = pendingCountKnown ? 0 : null;
    for (const run of runs) {
      try { if (byId.get(run.conversationId)?.matchesActive(run.token) === true && canceled !== null) canceled += 1; }
      catch (_) { canceled = null; unavailable = true; }
    }
    try { clearGrants(); } catch (_) { unavailable = true; }
    for (const run of runs) {
      try { run.markInvalidated(reason); } catch (_) { unavailable = true; }
    }
    if (privacy) for (const target of targets) {
      try { target.markPending(); } catch (_) { unavailable = true; }
    }
    for (const run of runs) {
      try { if (run.closeExecution()?.ok !== true && warning.unconfirmedClosures !== null) warning.unconfirmedClosures += 1; }
      catch (_) { if (warning.unconfirmedClosures !== null) warning.unconfirmedClosures += 1; }
    }
    try { invalidateProposals(); } catch (_) { add('unconfirmedNotifications'); }
    if (requests) try { invalidateRequests(); } catch (_) { add('unconfirmedNotifications'); }
    if (notify) try { notifyProviderChanged(); } catch (_) { add('unconfirmedNotifications'); }
    const appliedConversationIds = [], pendingConversationIds = [];
    if (privacy) for (const conversationId of ids) {
      let result;
      try { result = byId.has(conversationId) ? byId.get(conversationId).revoke() : revokeSession(conversationId); }
      catch (_) { result = null; }
      const transition = result?.transition;
      if (transition?.applied === true) appliedConversationIds.push(conversationId);
      else {
        pendingConversationIds.push(conversationId);
        if (warning.pendingConversations !== null) warning.pendingConversations += 1;
      }
      if (transition?.notification === 'unconfirmed') add('unconfirmedNotifications');
      if (transition?.persistence === 'unsaved') add('unsavedConversations');
      if ((!transition || transition.persistence === 'unknown'
        || (transition.persistence === 'superseded' && result?.conversation?.retention?.mode !== 'ephemeral'))
        && warning.unknownSaves !== null) warning.unknownSaves += 1;
    }
    for (const scope of scopes) {
      try { scope.clear(); } catch (_) { unavailable = true; }
    }
    warning.authorityUnavailable = unavailable;
    const needsWarning = unavailable || Object.entries(warning).some(([key, value]) => key !== 'code' && key !== 'authorityUnavailable' && (value === null || value > 0));
    return { ok: true, canceled, conversationIds: [...ids],
      transitionReport: Object.freeze({ attemptedConversationIds: [...ids], appliedConversationIds, pendingConversationIds }),
      ...(needsWarning ? { authorizationWarning: Object.freeze(warning) } : {}) };
  }
  function safelyRetire(reason, options) {
    try { return retire(reason, options); }
    catch (_) { unavailable = true; return { ok: true, canceled: null, conversationIds: [],
      transitionReport: { attemptedConversationIds: null, appliedConversationIds: null, pendingConversationIds: null },
      authorizationWarning: unknownWarning() }; }
  }
  function invalidate(reason = 'authorization-changed') {
    if (!REASONS.includes(reason)) return { ok: false, reason: 'invalidation-reason-invalid' };
    if (held || closed) return refused();
    held = true;
    try { return safelyRetire(reason, { requests: true, notify: true }); }
    finally { held = false; }
  }
  function runSettings({ patch, readSettings, command }) {
    if (held || !isReadable()) return refused();
    held = true;
    let outcome = null;
    try {
      const before = readSettings();
      const result = command.execute({ patch }, { onSuccessBeforePublish(success) {
        try {
          const changed = key => Object.hasOwn(patch, key) && before[key] !== success.settings[key];
          const requests = REQUEST_KEYS.some(changed);
          if (COLLABORATION_KEYS.some(key => Object.hasOwn(patch, key))) outcome = safelyRetire('authorization-changed', { requests });
          else if (requests) {
            try { invalidateRequests(); }
            catch (_) { outcome = { authorizationWarning: Object.freeze({ code: 'collaboration-authorization-incomplete',
              pendingConversations: 0, unsavedConversations: 0, unknownSaves: 0, unconfirmedClosures: 0,
              unconfirmedNotifications: 1, authorityUnavailable: false }) }; }
          }
        } catch (_) { unavailable = true; outcome = { authorizationWarning: unknownWarning() }; }
      } });
      return result.ok ? { ok: true, settings: result.settings, ...(outcome?.authorizationWarning ? { authorizationWarning: outcome.authorizationWarning } : {}) } : result;
    } finally { held = false; }
  }
  function runCredential({ kind, commit, readStatus }) {
    if (held || !isReadable()) return refused();
    if (!['import', 'clear'].includes(kind)) return { ok: false, reason: 'credential-operation-invalid' };
    held = true;
    function status() { try { return readStatus(); } catch (_) { return { credentialStatus: 'unavailable' }; } }
    try {
      let committed;
      try {
        committed = commit();
        if (kind === 'import' && committed === false) throw new Error('credential-import-failed');
      } catch (_) { return { ok: false, reason: `credential-${kind}-failed`, ...status() }; }
      const retired = safelyRetire('credentials-changed', { requests: true, notify: true });
      return { ok: true, ...(kind === 'clear' ? { removed: committed } : {}), ...status(),
        ...(retired.authorizationWarning ? { authorizationWarning: retired.authorizationWarning } : {}) };
    } finally { held = false; }
  }
  function close() {
    if (closed) return { ok: true };
    closed = true;
    return safelyRetire('authorization-changed', { privacy: false });
  }
  return Object.freeze({ generation: () => providerEpoch, captureAdmission, isAdmissionCurrent,
    isExistingCurrent, isReadable, runSettings, runCredential, invalidate, close });
}

module.exports = { createCollaborationAuthorization };
