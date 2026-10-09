'use strict';
const { prepareEmptyMemorySelection } = require('../../test-support/memory-recall-fixture');
const { createCollaborationAuthorization } = require('../../src/application/ai/collaboration-authorization');

// Synthetic ports only. This fixture does not simulate the collaboration loop:
// the test supplies the actual production createCollaborationTurns factory.
const answer = (text = 'Synthetic answer') => ({ type: 'answer', answer: text,
  readRequest: null, changeProposal: null });
const readRequest = (name = 'task.read', args = { id: 'task-1', fields: ['id', 'title'] }) => ({
  type: 'readRequest', answer: null, readRequest: { name, args }, changeProposal: null
});
const candidate = changeProposal => ({ type: 'changeProposal', answer: 'Synthetic candidate',
  readRequest: null, changeProposal });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(createCollaborationTurns, options = {}) {
  const trace = [], details = [], sent = [], controls = [], completions = [];
  const listeners = new Set(), timers = new Map();
  let at = 1000, sequence = 0, active = null, generation = 0, timerSequence = 0, clockReads = 0;
  let grantValid = true, sourceValid = true, messageValid = true, clockFailure = null;
  const record = { id: 'conversation-1', purpose: 'stuck', mode: options.mode || 'talk',
    authGeneration: 0, status: 'idle', selectedProposalId: null,
    segment: { index: 0 }, messages: structuredClone(options.messages || []) };
  const note = (event, value) => { trace.push(event); if (value !== undefined) details.push({ event, value: structuredClone(value) }); };
  const snapshot = () => structuredClone(record);
  function signalPort(controller) {
    return {
      get aborted() {
        if (options.signalRead) options.signalRead(api);
        return controller.signal.aborted;
      },
      addEventListener(type, listener, settings) {
        note('signal.add'); listeners.add(listener); controller.signal.addEventListener(type, listener, settings);
      },
      removeEventListener(type, listener) {
        note('signal.remove'); listeners.delete(listener); controller.signal.removeEventListener(type, listener);
      }
    };
  }
  function abort(reason, invalidate) {
    const previous = active;
    active = null;
    if (invalidate) record.authGeneration += 1;
    if (previous) previous.controller.abort(reason);
  }
  const sessions = {
    get() { note('sessions.get'); return { ok: true, conversation: snapshot() }; },
    beginTurn(request) {
      note('sessions.begin', request);
      abort('turn-superseded', false);
      const turnId = `turn-${++sequence}`;
      const token = { conversationId: record.id, turnId, requestId: `request-${sequence}`,
        authGeneration: record.authGeneration, providerId: request.providerId };
      const controller = new AbortController();
      active = { token, controller };
      record.messages.push({ id: `user-${sequence}`, role: 'user', content: request.message,
        proposal: null, sourceRefs: [], contextAllowed: true });
      record.status = 'generating';
      return { ok: true, conversation: snapshot(), token, signal: signalPort(controller) };
    },
    completeTurn(request) {
      note('sessions.complete', request); completions.push(structuredClone(request));
      if (options.beforeComplete) options.beforeComplete(request, api);
      if (!active || active.controller.signal.aborted
        || Object.keys(active.token).some(key => active.token[key] !== request.token[key])
        || request.token.authGeneration !== record.authGeneration) {
        return { ok: false, reason: 'conversation-turn-stale' };
      }
      record.messages.push({ id: `assistant-${sequence}`, role: 'assistant', content: request.content,
        proposal: request.proposal, sourceRefs: request.sourceRefs, contextAllowed: true, provenance: request.provenance });
      record.status = request.proposal ? 'awaiting-confirmation' : 'responding';
      active = null; // Genuine owner completion does not abort the captured signal.
      if (options.afterComplete) options.afterComplete(api);
      return { ok: true, conversation: snapshot() };
    },
    cancel(request) {
      note('sessions.cancel', request);
      if (options.cancel) {
        const result = options.cancel(request, api);
        if (result !== undefined) return result;
      }
      abort('canceled', true); record.status = 'canceled'; return { ok: true, conversation: snapshot() };
    },
    revoke(request) { note('sessions.revoke', request); abort('conversation-revoked', true); record.status = 'paused'; return { ok: true, conversation: snapshot() }; }
  };
  const selection = { tools: [], taskIds: [], inboxIds: [], routineIds: [], memoryIds: [],
    planningPreferences: false, fromDay: '2026-10-08', toDay: '2026-10-08', ...options.selection };
  const grant = { id: 'grant-1', ownerId: 'owner-1', conversationId: record.id, purpose: record.purpose,
    providerId: 'provider-1', authorizationGeneration: 0, selection };
  const grants = {
    resolve(request) {
      note('grants.resolve', request);
      if (options.grantResolve) options.grantResolve(request, api);
      return grantValid && request.scopeGrantId === grant.id && request.providerId === grant.providerId
        && request.authorizationGeneration === grant.authorizationGeneration
        ? { ok: true, grant } : { ok: false, reason: 'scope-grant-invalid' };
    },
    revoke(id) { note('grants.revoke', id); if (options.grantRevoke) options.grantRevoke(id, api); grantValid = false; },
    clear() { note('grants.clear'); grantValid = false; }
  };
  const provider = { fingerprint: 'provider-1', enabled: options.enabled !== false,
    configured: options.configured !== false, purposeAllowed: options.purposeAllowed !== false,
    model: 'synthetic-model', endpoint: 'https://synthetic.invalid/v1', client: {
      run(name, payload, callbacks) {
        generation += 1;
        note('provider.run', { name, payload, maxOutputChars: callbacks.maxOutputChars,
          maxRepairAttempts: callbacks.maxRepairAttempts });
        controls.push(callbacks);
        const attempt = () => { callbacks.beforeRequest(); note('provider.attempt'); sent.push(structuredClone(payload)); };
        const report = usage => { note('provider.usage', usage); callbacks.onUsage(usage); };
        const value = options.reply ? options.reply({ generation, payload, callbacks, attempt, report, api }) : (attempt(), answer());
        note('provider.return');
        return value;
      }
    } };
  const reads = { prepareMemorySelection(request, invokeOwnedSource) {
    return options.prepareMemorySelection ? options.prepareMemorySelection(request, api, invokeOwnedSource)
      : prepareEmptyMemorySelection(request);
  }, execute(request, invokeOwnedSource) {
    note('reads.execute', request);
    if (options.read) return options.read(request, api, invokeOwnedSource);
    return { ok: true, tool: request.request.name, trust: 'untrusted-data', availability: 'available',
      items: [{ id: 'task-1', version: 'v1', title: 'SYNTHETIC_SELECTED' }],
      sourceRefs: [{ kind: 'task', id: 'task-1', revision: 'v1' }],
      disclosure: { fields: ['id', 'title'] }, coverage: { returned: 1 }, truncated: false };
  } };
  const now = () => {
    note('clock');
    clockReads += 1;
    if (clockFailure) { const error = clockFailure; clockFailure = null; throw error; }
    if (options.clock) return options.clock({ at, clockReads, api });
    return at;
  };
  const schedule = (callback, delay) => {
    note('schedule', delay);
    if (options.onSchedule) options.onSchedule(api);
    if (options.scheduleFailure) throw new Error('SYNTHETIC_PRIVATE_SCHEDULER_ERROR');
    const handle = timerSequence++;
    timers.set(handle, callback);
    return handle;
  };
  const cancelSchedule = handle => {
    note('schedule.cancel', handle);
    if (options.cancelScheduleFailure) throw new Error('SYNTHETIC_PRIVATE_CANCEL_ERROR');
    timers.delete(handle);
  };
  const admission = createCollaborationAuthorization({
    capturePrivacyTargets: () => [{ conversationId: record.id,
      matchesActive: token => active?.token === token, markPending() {},
      revoke() { const result = sessions.revoke({ conversationId: record.id }); return { ...result,
        transition: { applied: true, notification: 'signal-aborted', persistence: 'ephemeral' } }; } }],
    captureScopes: () => [], captureRunOwners: () => turns.captureRunOwners(),
    clearGrants: () => grants.clear(), revokeSession: id => sessions.revoke({ conversationId: id })
  });
  const turns = createCollaborationTurns({ sessions, grants, reads, now, schedule, cancelSchedule, admission,
    limits: options.limits,
    getProvider() { note('provider.get'); if (options.providerGet) options.providerGet(api); return { ...provider }; },
    validateContextVersions(refs) { note('sources.check', refs); if (options.sourceCheck) return options.sourceCheck(refs, api); return sourceValid; },
    isContextMessageAllowed(item) {
      note('messages.check', item.id);
      if (options.messageCheck) return options.messageCheck(item, api);
      return messageValid;
    },
    onContextSent(refs) { note('context.sent', refs); if (options.contextSent) options.contextSent(refs, api); },
    onMessageAccepted(value) { note('message.accepted', value); if (options.onAccepted) options.onAccepted(value, api); }
  });
  const api = { turns, sessions, grants, provider, trace, details, sent, controls, completions, listeners, timers,
    run: message => turns.run({ conversationId: record.id, message: message || 'SYNTHETIC_CURRENT', scopeGrantId: grant.id }),
    snapshot, hasActive: () => active !== null,
    expireGrant: () => { grantValid = false; },
    invalidateSource: () => { sourceValid = false; },
    forgetMessages: () => { messageValid = false; },
    advance: milliseconds => { at += milliseconds; },
    failNextClock: () => { clockFailure = new Error('SYNTHETIC_PRIVATE_CLOCK_ERROR'); },
    deadline: () => { const callback = timers.values().next().value; if (callback) callback(); }
  };
  return api;
}

module.exports = { answer, readRequest, candidate, deferred, fixture };
