'use strict';

const { COLLABORATION_TASK, validateCollaborationResult } = require('../../core/llm/contracts');
const { normalizeRunBudget, unicodeLength } = require('./run-budget');
const { authorizeRead, selectedContextRequests } = require('./context-grants');
const { mergeSourceRefs } = require('./conversation-record');
const { buildCollaborationContext, localCollaborationReply } = require('./collaboration-context');
const { createRunExecution } = require('./run-execution');
const { rememberProposalValidationDetail, proposalValidationDetail } = require('../../core/llm/proposal-validation-detail');

const FAILURE_CODES = Object.freeze(['provider-credential-missing', 'provider-request-aborted',
  'provider-response-invalid-json', 'provider-response-html', 'provider-response-event-stream',
  'provider-response-empty', 'provider-response-missing-output', 'provider-response-too-large', 'provider-timeout',
  'provider-output-budget', 'provider-budget', 'read-budget', 'context-budget', 'context-source-budget',
  'tool-not-authorized', 'tool-args-invalid', 'tool-target-not-authorized', 'tool-fields-invalid',
  'tool-date-range-not-authorized', 'tool-limit-invalid', 'tool-query-invalid', 'tool-cursor-invalid',
  'tool-kinds-invalid', 'context-read-unavailable', 'memory-disabled', 'memory-selection-budget',
  'memory-context-budget', 'memory-context-invalid', 'memory-authority-unavailable']);
function failureField(error, key) {
  try { return Object.getOwnPropertyDescriptor(error, key)?.value; }
  catch (_) { return undefined; }
}
function safeFailure(error) {
  const reason = failureField(error, 'message'), stage = failureField(error, 'stage');
  if (FAILURE_CODES.includes(reason)) return reason;
  return stage === 'validate' || (typeof reason === 'string' && /^collaboration-/.test(reason))
    ? 'provider-invalid-output' : 'provider-unavailable';
}
function publicProvider(provider) {
  return { id: provider.fingerprint, model: typeof provider.model === 'string' ? provider.model : null,
    endpoint: typeof provider.endpoint === 'string' ? provider.endpoint : null };
}
function assertProviderPort(value) {
  if (!value || typeof value.fingerprint !== 'string' || !value.fingerprint || value.fingerprint.length > 200
      || typeof value.enabled !== 'boolean' || typeof value.configured !== 'boolean') {
    throw new TypeError('collaboration-provider-port-invalid');
  }
  return value;
}

function cleanupReport(value, missing = 'unconfirmed') {
  const states = ['not-acquired', 'released', 'unconfirmed'];
  let timer = missing, listener = missing;
  try {
    const timerValue = value?.timer, listenerValue = value?.listener;
    if (states.includes(timerValue)) timer = timerValue;
    if (states.includes(listenerValue)) listener = listenerValue;
  } catch (_) { /* Never copy a port's exception or arbitrary properties. */ }
  return Object.freeze({ ok: timer !== 'unconfirmed' && listener !== 'unconfirmed', timer, listener });
}

// No task writer, IPC dispatcher, SQL port, or commit callback exists here.
// The only mutation is canonical conversation history through its owner.
function createCollaborationTurns({ sessions, grants, reads, getProvider, now, validateContextVersions, isContextMessageAllowed, onContextSent, onMessageAccepted,
  limits: overrides = {}, schedule, cancelSchedule, admission } = {}) {
  if (!sessions || !grants || !reads || typeof getProvider !== 'function' || typeof now !== 'function') {
    throw new TypeError('collaboration-turn-ports-invalid');
  }
  if (validateContextVersions !== undefined && typeof validateContextVersions !== 'function') {
    throw new TypeError('collaboration-context-version-port-invalid');
  }
  if (isContextMessageAllowed !== undefined && typeof isContextMessageAllowed !== 'function') {
    throw new TypeError('collaboration-message-context-port-invalid');
  }
  const limits = normalizeRunBudget(overrides);
  const activeTurns = new Map();
  function invalidateAll({ reason = 'authorization-changed' } = {}) {
    if (!['authorization-changed', 'provider-changed', 'credentials-changed'].includes(reason)) {
      return { ok: false, reason: 'invalidation-reason-invalid' };
    }
    return admission ? admission.invalidate(reason) : { ok: false, reason: 'authorization-unavailable' };
  }

  async function run({ conversationId, message, messageId, scopeGrantId, selectedProposalId } = {}) {
    const admissionTicket = admission?.captureAdmission();
    if (admission && !admission.isAdmissionCurrent(admissionTicket)) return { ok: false, reason: 'authorization-busy' };
    if (typeof message !== 'string' || !message.trim()) return { ok: false, reason: 'message-required' };
    if (unicodeLength(message) > limits.maxMessageChars) return { ok: false, reason: 'message-too-long' };
    const found = sessions.get({ conversationId });
    if (!found.ok) return found;
    let provider;
    try { provider = assertProviderPort(getProvider(found.conversation)); } catch (_) { return { ok: false, reason: 'provider-configuration-unavailable' }; }
    if (provider.purposeAllowed === false) return { ok: false, reason: 'clarify-disabled', conversation: found.conversation };
    const begun = sessions.beginTurn({ conversationId, message, messageId, providerId: provider.fingerprint,
      authorizationGeneration: found.conversation.authGeneration, selectedProposalId, admissionTicket });
    if (!begun.ok || begun.replayed) return begun;
    const priorOwner = activeTurns.get(conversationId);
    let execution = null, cleanup = null, setupCleanup = null;
    let acceptedResult = null, finalDisclosure = null;
    let validateMemorySelection = null;
    const sent = { fields: [], sourceRefs: [], messageRefs: [], reads: [], coverage: null, bytes: 0 };
    const latestUserId = begun.acceptedMessageId || begun.conversation?.messages.at(-1)?.id;
    const messageContext = { conversationId, latestUserId, turnId: begun.token.turnId, invokeSource: invokeOwnedSource };
    const messageAllowed = item => {
      if (item.id === latestUserId && item.role === 'user') return true;
      if (!isContextMessageAllowed) return true;
      let allowed = false;
      try { allowed = isContextMessageAllowed(item, messageContext) === true; } catch (_) {}
      assertOwnerCurrent();
      return allowed;
    };
    const readResults = [];
    const usageReports = [];
    let remote = false;
    let invalidated = null;
    let globallyRetired = false;
    const activeTurn = Object.freeze({ conversationId, token: begun.token,
      markInvalidated(reason) { globallyRetired = true; invalidated = reason; },
      closeExecution() {
        if (!execution) return cleanupReport(null);
        return closeOwner();
      } });

    // Caller-side fences do not make session ports internally reentrancy-safe.
    // Global authorization transitions retain their existing separate policy.
    function ownerCurrent(requireExecution = true) {
      const aborted = begun.signal.aborted;
      const executionAborted = requireExecution && execution?.signal.aborted;
      return !aborted && !executionAborted && !acceptedResult && !globallyRetired
        && (!admission || admission.isExistingCurrent(admissionTicket))
        && activeTurns.get(conversationId) === activeTurn;
    }
    function assertOwnerCurrent() {
      if (!ownerCurrent()) throw new Error(invalidated || 'turn-canceled');
    }
    function invokeOwnedSource(operation) {
      assertOwnerCurrent();
      try { return operation(); }
      finally { assertOwnerCurrent(); }
    }
    function cancelOwned() {
      try {
        if (!ownerCurrent(false)) return 'not-current';
        return sessions.cancel({ conversationId })?.ok === true ? 'canceled' : 'unconfirmed';
      } catch (_) { return 'unconfirmed'; }
    }
    function closeOwner() {
      if (cleanup) return cleanup;
      cleanup = cleanupReport(null);
      try {
        cleanup = execution ? cleanupReport(execution.dispose())
          : setupCleanup || cleanupReport(null, 'not-acquired');
      } catch (_) { /* Accepted results cannot become cleanup retries. */ }
      finally {
        if (activeTurns.get(conversationId) === activeTurn) activeTurns.delete(conversationId);
      }
      return cleanup;
    }
    function finalize(result) { return { ...result, cleanup: closeOwner() }; }

    function resolveGrant() {
      const resolved = grants.resolve({ conversationId, scopeGrantId, providerId: provider.fingerprint,
        authorizationGeneration: begun.token.authGeneration });
      assertOwnerCurrent();
      return resolved;
    }
    function checkSourceVersions(refs) {
      if (!validateContextVersions || !refs.length) return;
      let current = false;
      try { current = validateContextVersions(refs, invokeOwnedSource) === true; } catch (_) { /* Fail closed. */ }
      assertOwnerCurrent();
      if (current) return;
      invalidated = 'target-changed';
      grants.revoke(conversationId);
      assertOwnerCurrent();
      sessions.revoke({ conversationId, sourceRefs: refs });
      throw new Error(invalidated);
    }
    function checkMessageSources(refs) {
      if (!refs.length || !isContextMessageAllowed) return;
      const valid = refs.every(ref => {
        const item = begun.conversation.messages.find(message => message.id === ref.id);
        return item && messageAllowed(item);
      });
      assertOwnerCurrent();
      if (valid) return;
      invalidated = 'context-forgotten';
      grants.revoke(conversationId);
      assertOwnerCurrent();
      sessions.revoke({ conversationId, sourceRefs: refs });
      throw new Error(invalidated);
    }
    function checkMemorySelection() {
      if (!validateMemorySelection) return;
      let valid = false;
      try { valid = validateMemorySelection(invokeOwnedSource)?.ok === true; } catch (_) { /* Fail closed. */ }
      assertOwnerCurrent();
      if (valid) return;
      invalidated = 'target-changed';
      grants.revoke(conversationId);
      assertOwnerCurrent();
      sessions.revoke({ conversationId });
      throw new Error(invalidated);
    }
    function checkFresh(requireGrant = remote) {
      execution.check();
      assertOwnerCurrent();
      const current = sessions.get({ conversationId });
      assertOwnerCurrent();
      const active = current.ok ? assertProviderPort(getProvider(current.conversation)) : provider;
      assertOwnerCurrent();
      let reason = null;
      if (!current.ok || current.conversation.authGeneration !== begun.token.authGeneration) reason = 'turn-canceled';
      else if (active.fingerprint !== provider.fingerprint) reason = 'provider-changed';
      else if (active.purposeAllowed === false || active.enabled !== provider.enabled || active.configured !== provider.configured) reason = 'authorization-changed';
      else if (requireGrant && !resolveGrant().ok) reason = 'scope-grant-invalid';
      if (reason) {
        invalidated = reason;
        if (reason !== 'turn-canceled') {
          grants.revoke(conversationId);
          assertOwnerCurrent();
          sessions.revoke({ conversationId });
        }
        throw new Error(reason);
      }
      checkSourceVersions(sent.sourceRefs);
      checkMessageSources(sent.messageRefs);
      // Full-selection evidence is last, including selected query non-hits.
      checkMemorySelection();
      assertOwnerCurrent();
    }
    function disclosure(source) {
      if (finalDisclosure) return finalDisclosure;
      const counts = execution ? execution.counts() : { reads: null, providerCalls: null };
      const providerAttempts = counts.providerCalls;
      let tokenUsage = null;
      try {
        if (providerAttempts > 0 && usageReports.length === providerAttempts
          && usageReports.every(usage => usage && ['inputTokens', 'outputTokens', 'totalTokens']
            .every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0))) {
          const summed = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          for (const usage of usageReports) for (const key of Object.keys(summed)) summed[key] += usage[key];
          if (Object.values(summed).every(Number.isSafeInteger)) tokenUsage = summed;
        }
      } catch (_) { /* Malformed observational reports remain unknown. */ }
      let elapsedMs = null;
      if (execution) {
        try {
          const sampled = execution.usage();
          if (Number.isFinite(sampled.elapsedMs)) elapsedMs = sampled.elapsedMs;
        } catch (_) { /* Observation failure preserves exact known counts. */ }
      }
      let disclosedProvider = null;
      try { if (source === 'provider' || providerAttempts > 0) disclosedProvider = publicProvider(provider); } catch (_) {}
      finalDisclosure = { provider: disclosedProvider,
        fields: [...sent.fields], sourceRefs: [...sent.sourceRefs], reads: [...sent.reads],
        coverage: sent.coverage, bytes: sent.bytes, tokenUsage,
        usage: { ...counts, elapsedMs, tokens: tokenUsage?.totalTokens ?? null } };
      return finalDisclosure;
    }
    function finish(reply, source, reason = null, providerReason = null) {
      checkFresh(source === 'provider');
      if (reply.changeProposal?.operations && source === 'provider') {
        const unreadTarget = reply.changeProposal.operations.some(operation => {
          if (operation.type === 'task.create') return false;
          const kind = operation.type.split('.')[0];
          return !sent.sourceRefs.some(ref => ref.kind === kind && ref.id === operation.entityId);
        });
        if (unreadTarget) throw new Error('collaboration-change-target-not-read');
      }
      const planningPreference = reply.changeProposal?.planningPreference;
      if (planningPreference && planningPreference.id !== null && source === 'provider'
        && !sent.sourceRefs.some(ref => ref.kind === 'planning-preference' && ref.id === planningPreference.id)) {
        throw new Error('collaboration-planning-preference-target-not-read');
      }
      const memoryChange = reply.changeProposal?.memoryChange;
      if (memoryChange && source === 'provider') {
        const grant = resolveGrant().grant;
        const targetRead = readResults.some(result => result.tool === 'memory.search' && result.availability === 'available'
          && result.items.some(item => item.id === memoryChange.id && result.sourceRefs.some(ref =>
            ref.kind === 'memory' && ref.id === item.id && ref.revision === item.version)));
        if (!grant?.selection.memoryIds.includes(memoryChange.id) || !targetRead
          || !sent.sourceRefs.some(ref => ref.kind === 'memory' && ref.id === memoryChange.id)) {
          throw new Error('collaboration-memory-target-not-read');
        }
      }
      const proposalKind = reply.changeProposal ? (reply.changeProposal.operations ? 'change-set'
        : reply.changeProposal.memoryCandidate || memoryChange ? 'memory-candidate'
          : planningPreference ? 'planning-preference-candidate' : 'task-draft') : null;
      const proposal = reply.changeProposal ? { id: begun.token.requestId, version: 1,
        kind: proposalKind, body: JSON.stringify(reply.changeProposal) } : null;
      const responseFields = { answer: reply.answer, proposal: reply.changeProposal, proposalKind, source, reason,
        ...(providerReason ? { providerReason } : {}),
        provider: source === 'provider' ? publicProvider(provider) : null };
      if (source === 'provider') checkFresh(true);
      else assertOwnerCurrent();
      const completed = sessions.completeTurn({ token: begun.token, providerId: provider.fingerprint,
        admissionTicket,
        content: reply.answer, proposal, sourceRefs: source === 'provider' ? mergeSourceRefs([sent.sourceRefs, sent.messageRefs]) : [],
        provenance: { source, reason, providerId: source === 'provider' ? provider.fingerprint : null } });
      if (!completed.ok) {
        cancelOwned();
        return completed;
      }
      acceptedResult = { ...completed, ...responseFields };
      if (typeof onMessageAccepted === 'function') {
        try { onMessageAccepted({ conversationId, messageId: completed.acceptedMessageId || completed.conversation?.messages.at(-1)?.id }); } catch (_) {}
      }
      acceptedResult.disclosure = disclosure(source);
      return acceptedResult;
    }
    async function requestReply(grant) {
      const context = buildCollaborationContext({ conversation: begun.conversation, grant, data: readResults, limits, latestUserId, isContextMessageAllowed: messageAllowed });
      if (!context.ok) throw new Error(context.reason);
      checkFresh();
      const before = execution.counts().providerCalls;
      const refs = mergeSourceRefs([sent.sourceRefs, context.sourceRefs]);
      const messageRefs = mergeSourceRefs([sent.messageRefs, context.messageRefs]);
      if (refs.length + messageRefs.length > 50) throw new Error('context-source-budget');
      checkSourceVersions(refs);
      function beforeAttempt(controls) {
        controls.assertOpen();
        assertOwnerCurrent();
        checkSourceVersions(refs);
        checkMessageSources(messageRefs);
        controls.beforeProviderAttempt();
        controls.assertOpen();
        assertOwnerCurrent();
        sent.fields = [...COLLABORATION_TASK.fields];
        sent.sourceRefs = refs;
        sent.messageRefs = messageRefs;
        sent.coverage = context.coverage;
        sent.bytes = context.bytes;
        if (typeof onContextSent === 'function') {
          try { onContextSent(refs); } catch (_) { /* Preserve committed attempt/usage bookkeeping. */ }
        }
        assertOwnerCurrent();
        // Trusted usage observation can change semantic eligibility, even when
        // it throws. No observer or sampled-clock callback follows this check.
        checkFresh();
        controls.assertOpen();
        assertOwnerCurrent();
        sent.reads = readResults.map(result => ({ tool: result.tool, fields: [...result.disclosure.fields],
          sourceRefs: [...result.sourceRefs], availability: result.availability, coverage: result.coverage,
          truncated: result.truncated }));
      }
      // Native client invokes beforeRequest for every real HTTP attempt. Other
      // injected clients must follow that contract; missing it is rejected.
      const raw = await execution.wait(controls => provider.client.run('collaborate', context.payload,
        { signal: controls.signal, beforeRequest: () => beforeAttempt(controls), maxOutputChars: limits.maxOutputChars,
          maxRepairAttempts: limits.maxRepairAttempts, onUsage: usage => { if (controls.isOpen() && ownerCurrent()) usageReports.push(usage); } }));
      checkFresh();
      if (execution.counts().providerCalls === before) throw new Error('provider-attempt-contract-invalid');
      let reply;
      try { reply = validateCollaborationResult(raw); }
      catch (error) {
        error.stage = 'validate';
        rememberProposalValidationDetail(error, 'collaborate');
        throw error;
      }
      if (unicodeLength(JSON.stringify(reply)) > limits.maxOutputChars) throw new Error('provider-output-budget');
      return reply;
    }

    async function executeRead(grant, request) {
      checkFresh();
      const allowed = authorizeRead(grant, request);
      if (!allowed.ok) throw new Error(allowed.reason);
      execution.consumeRead();
      const result = await execution.wait(() => {
        checkFresh();
        const execute = invokeOwnedSource(() => reads.execute);
        return invokeOwnedSource(() => execute.call(reads, { grant, request }, invokeOwnedSource));
      });
      checkFresh();
      if (!result?.ok) throw new Error(result?.reason || 'context-read-unavailable');
      readResults.push(result);
    }
    async function readSelectedContext(grant) {
      for (const request of selectedContextRequests(grant)) {
        await executeRead(grant, request);
        checkFresh();
      }
    }

    try {
      const aborted = begun.signal.aborted;
      if (!aborted && (!admission || admission.isExistingCurrent(admissionTicket))
        && activeTurns.get(conversationId) === priorOwner) activeTurns.set(conversationId, activeTurn);
      if (typeof onMessageAccepted === 'function') {
        try { onMessageAccepted({ conversationId, messageId: latestUserId }); } catch (_) {}
      }
      execution = createRunExecution({ now, limits, signal: begun.signal, schedule, cancelSchedule,
        assertCurrent: () => checkFresh() });
      assertOwnerCurrent();
      remote = provider.enabled && provider.configured && typeof provider.client?.run === 'function';
      if (!remote) return finalize(finish(localCollaborationReply({ mode: begun.conversation.mode, message }), 'local',
        !provider.enabled ? 'ai-disabled' : 'provider-not-configured'));
      checkFresh();
      const grant = resolveGrant().grant;
      const prepareSelection = reads.prepareMemorySelection;
      assertOwnerCurrent();
      if (typeof prepareSelection !== 'function') throw new Error('context-read-unavailable');
      const selection = prepareSelection.call(reads, { grant }, invokeOwnedSource);
      assertOwnerCurrent();
      if (!selection?.ok) throw new Error(selection?.reason || 'context-read-unavailable');
      const validator = selection.validate;
      assertOwnerCurrent();
      if (typeof validator !== 'function') throw new Error('context-read-unavailable');
      validateMemorySelection = validator;
      checkFresh();
      await readSelectedContext(grant);
      checkFresh();
      for (;;) {
        const grant = resolveGrant().grant;
        const reply = await requestReply(grant);
        checkFresh();
        if (reply.type !== 'readRequest') return finalize(finish(reply, 'provider'));
        await executeRead(grant, reply.readRequest);
        checkFresh();
      }
    } catch (error) {
      if (acceptedResult) return finalize(acceptedResult);
      if (!execution) {
        let setupStage = 'unknown';
        try {
          if (['ports', 'freshness', 'budget', 'listener', 'clock', 'schedule'].includes(error?.setupStage)) setupStage = error.setupStage;
          setupCleanup = cleanupReport(error?.cleanup, 'not-acquired');
        } catch (_) { setupCleanup = cleanupReport(null); }
        const setupRecovery = cancelOwned();
        let conversation = null;
        try { conversation = sessions.get({ conversationId }).conversation || null; } catch (_) {}
        return finalize({ ok: false, reason: 'run-setup-failed', setupStage, setupRecovery,
          conversation, disclosure: disclosure('local') });
      }
      // Cancellation/revocation/deadline cannot turn into an accepted answer,
      // even when a transport resolves successfully after its abort signal.
      if (invalidated || execution.signal.aborted || !execution.budgetStatus().ok || begun.signal.aborted) {
        cancelOwned();
        return finalize({ ok: false, reason: invalidated || (!execution.budgetStatus().ok || failureField(error, 'message') === 'turn-deadline' ? 'turn-deadline' : 'turn-canceled'),
          conversation: sessions.get({ conversationId }).conversation, disclosure: disclosure('local') });
      }
      try {
        checkFresh();
        const detail = proposalValidationDetail(error);
        return finalize(finish(localCollaborationReply({ mode: begun.conversation.mode, message }), 'local', safeFailure(error),
          detail ? `provider-invalid-output|${detail}` : null));
      } catch (_) {
        if (acceptedResult) return finalize(acceptedResult);
        cancelOwned();
        return finalize({ ok: false, reason: invalidated || 'turn-canceled',
          conversation: sessions.get({ conversationId }).conversation, disclosure: disclosure('local') });
      }
    } finally {
      closeOwner();
    }
  }
  return Object.freeze({ run, invalidateAll, captureRunOwners: () => [...activeTurns.values()] });
}

module.exports = { createCollaborationTurns };
