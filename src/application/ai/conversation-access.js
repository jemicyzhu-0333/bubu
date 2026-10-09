'use strict';
const { entityFingerprint } = require('./entity-fingerprint');
const { localDayKey } = require('../../core/calendar');
const { exactKeys, validateSelection, selectedContextRequests } = require('./context-grants');
const { createContextChoices, contextRecords } = require('./context-choices');

// Application use cases for explicit context selection and shared entry points.
// The bootstrap supplies repositories and provider identity, never business data.
function createConversationAccess({ sessions, grants, reads, getProvider, readSnapshot, now, memoryRecall, admission }) {
  const scopes = new Map();
  const choices = createContextChoices({ sessions, readSnapshot, memoryRecall });
  function pendingScope(conversation) {
    return { ok: true, conversation, localOnly: true, reason: 'conversation-context-pending', scopeGrantId: null, contextPreview: [],
      selection: { taskIds: [], inboxIds: [], routineIds: [], memoryIds: [], planningPreferences: false, focusSummary: false },
      disclosure: { provider: null, fields: [], sourceRefs: [], availability: 'local-only', focusSummary: false } };
  }
  function parseScope(conversation, input = {}) {
    if (!exactKeys(input, ['taskIds', 'inboxIds', 'routineIds', 'memoryIds', 'planningPreferences', 'focusSummary', 'fromDay', 'toDay'])
      || (input.planningPreferences !== undefined && typeof input.planningPreferences !== 'boolean')
      || (input.focusSummary !== undefined && typeof input.focusSummary !== 'boolean')) {
      return { ok: false, reason: 'scope-fields-invalid' };
    }
    const at = now();
    if (!Number.isFinite(at)) return { ok: false, reason: 'scope-clock-invalid' };
    const dayKey = localDayKey(at);
    if ((input.fromDay !== undefined && input.fromDay !== dayKey)
      || (input.toDay !== undefined && input.toDay !== dayKey)) return { ok: false, reason: 'scope-date-range-invalid' };
    const taskIds = input.taskIds === undefined
      ? (conversation.relatedEntity?.kind === 'task' ? [conversation.relatedEntity.id] : []) : input.taskIds;
    const inboxIds = input.inboxIds === undefined ? [] : input.inboxIds;
    const routineIds = input.routineIds === undefined ? [] : input.routineIds;
    const memoryIds = input.memoryIds === undefined ? [] : input.memoryIds;
    const tools = [...(taskIds?.length ? ['task.read', 'task.search'] : []),
      ...(inboxIds?.length ? ['inbox.search'] : []), ...(routineIds?.length ? ['routine.search'] : []),
      ...(memoryIds?.length ? ['memory.search'] : []),
      ...(input.planningPreferences ? ['planning.preferences.read'] : []), ...(input.focusSummary ? ['activity.distribution'] : [])];
    const parsed = validateSelection({ tools, taskIds, inboxIds, routineIds, memoryIds, planningPreferences: input.planningPreferences, fromDay: dayKey, toDay: dayKey });
    return parsed.ok ? { ...parsed, scope: { taskIds: parsed.selection.taskIds, inboxIds: parsed.selection.inboxIds,
      routineIds: parsed.selection.routineIds, memoryIds: parsed.selection.memoryIds, planningPreferences: input.planningPreferences === true, focusSummary: input.focusSummary === true, fromDay: dayKey, toDay: dayKey } } : parsed;
  }
  function prepareScope(conversation, input = {}, ticket) {
    if (conversation.contextEligibilityPending === true) return pendingScope(conversation);
    const admissionTicket = ticket === undefined ? admission?.captureAdmission() : ticket;
    const target = sessions.capturePrivacyTargets?.().find(item => item.conversationId === conversation.id);
    const current = () => (!admission || admission.isAdmissionCurrent(admissionTicket))
      && (target ? target.matchesAuthorization(conversation.authGeneration) : !admission);
    const stale = () => ({ ...pendingScope(conversation), reason: 'authorization-changed' });
    let refused = false;
    function guarded(operation) {
      function check() {
        if (!current()) refused = true;
        if (refused) throw new Error('authorization-changed');
      }
      check();
      try { return operation(); }
      finally { check(); }
    }
    if (!current()) return stale();
    const provider = getProvider(conversation);
    if (!current()) return stale();
    if (provider.purposeAllowed === false) return { ok: false, reason: 'clarify-disabled', conversation };
    const parsed = parseScope(conversation, input);
    if (!current()) return stale();
    if (!parsed.ok) return parsed;
    const snapshot = readSnapshot();
    if (!current()) return stale();
    for (const [kind, field] of [['task', 'taskIds'], ['inbox', 'inboxIds'], ['routine', 'routineIds']]) {
      const selected = parsed.selection[field];
      if (!selected.length) continue;
      const records = contextRecords(snapshot, kind);
      if (records === null) return { ok: false, reason: 'context-source-unavailable', conversation };
      const missing = selected.filter(id => !records.some(item => item.id === id));
      if (missing.length) {
        grants.revoke(conversation.id);
        sessions.revoke({ conversationId: conversation.id, sourceRefs: missing.map(id => ({ kind, id, revision: null })) });
        return { ok: false, reason: kind === 'routine' ? 'scope-routine-not-allowed' : 'conversation-target-missing', conversation };
      }
    }
    if (parsed.selection.memoryIds.length) {
      if (snapshot?.settings?.aiMemoryEnabled !== true) return { ok: false, reason: 'memory-disabled', conversation };
      let selected;
      try {
        const select = guarded(() => memoryRecall?.selected);
        selected = typeof select === 'function'
          ? guarded(() => select.call(memoryRecall, parsed.selection.memoryIds, guarded))
          : { ok: false, reason: 'memory-authority-unavailable' };
      } catch (_) { selected = { ok: false, reason: 'memory-authority-unavailable' }; }
      if (refused || !current()) return stale();
      if (!selected.ok) return { ...selected, conversation };
    }
    const issued = grants.issue({ conversationId: conversation.id, purpose: conversation.purpose,
      providerId: provider.fingerprint, authorizationGeneration: conversation.authGeneration, selection: parsed.selection, admissionTicket });
    if (!issued.ok) return issued;
    if (!current()) return stale();
    const contextPreview = [];
    for (const request of selectedContextRequests(issued.grant)) {
      if (!current()) return stale();
      try {
        const execute = guarded(() => reads.execute);
        contextPreview.push(guarded(() => execute.call(reads, { grant: issued.grant, request }, guarded)));
      } catch (error) {
        if (refused || !current()) return stale();
        throw error;
      }
      if (!current()) return stale();
    }
    const failure = contextPreview.find(result => !result.ok);
    if (failure) { grants.revoke(conversation.id); return failure; }
    if (!current()) return stale();
    scopes.set(conversation.id, { ...parsed.scope, grantId: issued.grant.id });
    return { ok: true, conversation, scopeGrantId: issued.grant.id, contextPreview, selection: structuredClone(parsed.scope),
      disclosure: { provider: { model: provider.model, endpoint: provider.endpoint }, focusSummary: parsed.scope.focusSummary,
        fields: [...new Set(contextPreview.flatMap(item => item.disclosure?.fields || []))],
        sourceRefs: contextPreview.flatMap(item => item.sourceRefs || []),
        availability: contextPreview.some(item => item.availability !== 'available') ? 'partial' : 'available' } };
  }
  function savedScope(conversationId) {
    const { grantId, ...scope } = scopes.get(conversationId) || {};
    // The authorization window stays today-only across midnight.
    delete scope.fromDay; delete scope.toDay;
    return scope;
  }
  function start(payload) {
    const ticket = admission?.captureAdmission();
    const allowed = () => !admission || admission.isAdmissionCurrent(ticket);
    if (!allowed()) return { ok: false, reason: 'authorization-busy' };
    if (getProvider({ purpose: payload.purpose }).purposeAllowed === false) return { ok: false, reason: 'clarify-disabled' };
    if (!allowed()) return { ok: false, reason: 'authorization-changed' };
    const task = payload.taskId ? (readSnapshot().tasks || []).find(item => item.id === payload.taskId) : null;
    if (!allowed()) return { ok: false, reason: 'authorization-changed' };
    if (payload.taskId && !task) return { ok: false, reason: 'task-not-found' };
    const result = sessions.start({ purpose: payload.purpose, mode: payload.mode,
      relatedEntity: task ? { kind: 'task', id: task.id, version: entityFingerprint(task) } : null });
    if (!result.ok) return result;
    if (!allowed()) return { ...pendingScope(result.conversation), reason: 'authorization-changed' };
    let conversation = result.conversation;
    if (payload.retentionMode === 'saved') {
      const saved = sessions.setRetention({ conversationId: conversation.id, mode: 'saved', retentionDays: 30 });
      conversation = saved.conversation || conversation;
      if (!saved.ok) return { ...saved, conversation };
      if (!allowed()) return { ...pendingScope(conversation), reason: 'authorization-changed' };
    }
    return prepareScope(conversation, {}, ticket);
  }
  function open(payload) {
    const ticket = admission?.captureAdmission();
    const result = sessions.get(payload);
    if (!result.ok) return result;
    if (result.conversation.contextEligibilityPending === true
      || (admission && !admission.isAdmissionCurrent(ticket))) return pendingScope(result.conversation);
    const provider = getProvider(result.conversation);
    if (admission && !admission.isAdmissionCurrent(ticket)) return { ...pendingScope(result.conversation), reason: 'authorization-changed' };
    if (provider.purposeAllowed === false || provider.enabled === false) {
      grants.revoke(payload.conversationId); scopes.delete(payload.conversationId);
      return { ...result, localOnly: true, scopeGrantId: null, contextPreview: [],
        selection: { taskIds: [], inboxIds: [], routineIds: [], memoryIds: [], planningPreferences: false, focusSummary: false },
        disclosure: { provider: null, fields: [], sourceRefs: [], availability: 'local-only', focusSummary: false } };
    }
    return prepareScope(result.conversation, {}, ticket);
  }
  function scopeNotIssued(retired) {
    return { ok: false, reason: 'scope-not-issued', conversation: retired.conversation || null,
      scopeGrantId: null, transition: retired.transition };
  }
  function completeScope(retired, conversationId, capturedScope, input, replace = false, ticket) {
    if (!retired.ok) return retired;
    const applied = retired.transition?.applied === true;
    if (!retired.conversation || retired.transition?.persistence === 'superseded'
      || scopes.get(conversationId) !== capturedScope
      || (admission && !admission.isAdmissionCurrent(ticket))) {
      if (scopes.get(conversationId) === capturedScope) scopes.delete(conversationId);
      return scopeNotIssued(retired);
    }
    if (replace) { grants.revoke(conversationId); scopes.delete(conversationId); }
    try {
      const prepared = prepareScope(retired.conversation, input, ticket);
      if (applied && (!prepared.ok || !prepared.scopeGrantId)) return scopeNotIssued({ ...retired,
        conversation: prepared.conversation || retired.conversation });
      return { ...prepared, ...(retired.transition ? { transition: retired.transition } : {}) };
    } catch (error) {
      if (applied) return scopeNotIssued(retired);
      throw error;
    }
  }
  function setScope(payload) {
    const ticket = admission?.captureAdmission();
    if (admission && !admission.isAdmissionCurrent(ticket)) return { ok: false, reason: 'authorization-busy' };
    if (!exactKeys(payload, ['conversationId', 'taskIds', 'inboxIds', 'routineIds', 'memoryIds', 'planningPreferences', 'focusSummary', 'fromDay', 'toDay'])) {
      return { ok: false, reason: 'scope-fields-invalid' };
    }
    const found = sessions.get({ conversationId: payload.conversationId });
    if (!found.ok) return found;
    if (admission && !admission.isAdmissionCurrent(ticket)) return { ok: false, reason: 'authorization-changed' };
    const { conversationId, ...input } = payload;
    const parsed = parseScope(found.conversation, input);
    if (!parsed.ok) return parsed;
    if (admission && !admission.isAdmissionCurrent(ticket)) return { ok: false, reason: 'authorization-changed' };
    const capturedScope = scopes.get(conversationId);
    const revoked = sessions.revoke({ conversationId });
    return completeScope(revoked, conversationId, capturedScope, parsed.scope, true, ticket);
  }
  function setMode(payload) {
    const ticket = admission?.captureAdmission();
    const capturedScope = scopes.get(payload.conversationId);
    const input = savedScope(payload.conversationId);
    const changed = sessions.setMode(payload);
    return completeScope(changed, payload.conversationId, capturedScope, input, false, ticket);
  }
  function pause(payload) {
    grants.revoke(payload.conversationId);
    scopes.delete(payload.conversationId);
    return sessions.pause(payload);
  }
  function prepareDelete(payload) {
    const prepared = sessions.prepareDelete(payload);
    if (!prepared.ok) return prepared;
    grants.revoke(payload.conversationId); scopes.delete(payload.conversationId);
    return prepared;
  }
  function remove(payload) {
    const prepared = prepareDelete(payload);
    if (!prepared.ok) return prepared;
    return sessions.delete(payload);
  }
  function cancel(payload) {
    const ticket = admission?.captureAdmission();
    const capturedScope = scopes.get(payload.conversationId);
    const input = savedScope(payload.conversationId);
    const result = sessions.cancel(payload);
    return completeScope(result, payload.conversationId, capturedScope, input, false, ticket);
  }
  function captureScopes() {
    return [...scopes].map(([conversationId, scope]) => Object.freeze({ conversationId,
      clear() { if (scopes.get(conversationId) === scope) scopes.delete(conversationId); } }));
  }
  function invalidateScopes() { return admission ? admission.invalidate('authorization-changed')
    : { ok: false, reason: 'authorization-unavailable' }; }
  return Object.freeze({ start, open, setScope, setMode, pause, prepareDelete, remove, cancel, invalidateScopes, captureScopes, ...choices });
}
module.exports = { createConversationAccess };
