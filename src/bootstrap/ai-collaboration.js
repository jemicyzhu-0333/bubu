'use strict';
const { createCollaborationSessions } = require('../application/ai/conversation-sessions');
const { createContextGrants } = require('../application/ai/context-grants');
const { createContextReads } = require('../application/ai/context-reads');
const { createMemoryRecall } = require('../application/ai/memory-recall');
const { createCollaborationTurns } = require('../application/ai/collaboration-turns');
const { entityFingerprint } = require('../application/ai/entity-fingerprint');
const { createConversationAccess } = require('../application/ai/conversation-access');
const { createCollaborationAuthorization } = require('../application/ai/collaboration-authorization');
const { createMemoryManagement } = require('./memory-management');
const { createConversationProposalStatus } = require('../application/queries/conversation-proposal-status');
const { createAiConfirmedChanges } = require('./ai-confirmed-changes');
const { createApiClient, DEFAULT_AI_BASE_URL } = require('../core/llm');

function createAiCollaboration({ storage, readSnapshot, factStore, credentialStore, getSettings, requestScope,
  onProviderChanged = () => {}, trace, timeoutMs, negotiation, now, idFactory, lifecycle, changePorts, stateRepository, memoryAuthority, publishChange, clientFactory = createApiClient } = {}) {
  const unavailable = () => ({ ok: false, reason: storage.reason || 'conversation-storage-unavailable' });
  const repository = storage.repository || Object.freeze({ load: unavailable, listPage: unavailable,
    saveSnapshot: unavailable, delete: unavailable, pruneRetention: unavailable });
  const admission = createCollaborationAuthorization({
    capturePrivacyTargets: () => sessions.capturePrivacyTargets(), captureScopes: () => access.captureScopes(),
    captureRunOwners: () => turns.captureRunOwners(), clearGrants: () => grants.clear(),
    revokeSession: conversationId => sessions.revoke({ conversationId }),
    invalidateProposals: () => changes.invalidate(), invalidateRequests: () => requestScope?.invalidate(),
    notifyProviderChanged: onProviderChanged
  });
  const sessions = createCollaborationSessions({ ownerId: storage.ownerId, repository,
    now, idFactory: (_sequence, kind) => idFactory(kind), maxCached: 20, admission });
  const grants = createContextGrants({ ownerId: storage.ownerId, now, idFactory, admission });
  let memoryManagement = null;
  const memory = memoryAuthority?.service;
  const memoryRecall = createMemoryRecall({ contextReader: memory?.contextReader });
  const reads = createContextReads({ grants, readSnapshot, now, memoryRecall,
    timeline: { available: Boolean(factStore?.healthy && factStore?.timeline?.queryRange),
      readRange: ({ fromDay, toDay }) => factStore.timeline.queryRange({ fromDayKey: fromDay, toDayKey: toDay }) } });
  function getProvider(conversation = {}) {
    const settings = getSettings();
    const purposeAllowed = conversation.purpose === 'stuck' || settings.aiClarifyEnabled === true;
    const enabled = settings.aiBreakdownEnabled === true && purposeAllowed;
    const configured = Boolean(credentialStore.status().configured && settings.aiModel);
    const fingerprint = entityFingerprint({ providerEpoch: admission.generation(), enabled, purposeAllowed, configured, model: settings.aiModel || '',
      endpoint: settings.aiBaseUrl || DEFAULT_AI_BASE_URL });
    let client = null;
    if (enabled && configured) {
      try { client = clientFactory({ baseUrl: settings.aiBaseUrl || DEFAULT_AI_BASE_URL,
        model: settings.aiModel, timeoutMs, trace, negotiation, getCredential: () => credentialStore.get() }); }
      catch (_) { /* An invalid provider remains local and cannot widen a grant. */ }
    }
    return { enabled, purposeAllowed, configured: configured && Boolean(client), fingerprint, client,
      model: settings.aiModel || null, endpoint: client?.endpoint || settings.aiBaseUrl || DEFAULT_AI_BASE_URL };
  }
  const turns = createCollaborationTurns({ sessions, grants, reads, getProvider, now, admission,
    validateContextVersions: (sourceRefs, invokeSource) => reads.validateContextVersions(sourceRefs, invokeSource),
    isContextMessageAllowed: (message, context) => !memoryManagement || memoryManagement.isContextMessageAllowed(message, context),
    onMessageAccepted: identity => memoryManagement?.rememberAcceptedMessage(identity),
    onContextSent: refs => {
      if (!memory?.available) return;
      const references = refs.filter(ref => ref.kind === 'memory').flatMap(ref => {
        const value = memory.getVersion({ id: ref.id });
        return value.ok && entityFingerprint({ id: value.id, version: value.version }) === ref.revision
          ? [{ id: value.id, version: value.version }] : [];
      });
      if (references.length) memory.usage({ references, at: now() });
    } });

  const access = createConversationAccess({ sessions, grants, reads, getProvider, readSnapshot, now, memoryRecall, admission });
  const changes = createAiConfirmedChanges({ storage, sessions, grants, reads, getProvider, readSnapshot,
    factStore, now, idFactory, lifecycle, changePorts, durability: stateRepository?.authoritativeWrites });
  const proposalStatus = createConversationProposalStatus({ sessions, ownerId: storage.ownerId,
    identityAvailable: storage.identityAvailable === true, readSnapshot, memory, now, durability: stateRepository?.authoritativeWrites });
  const invalidateConversation = payload => changes.invalidate(payload.conversationId);

  async function legacyTurn(payload) {
    const opened = payload.conversationId ? access.open({ conversationId: payload.conversationId })
      : access.start({ purpose: 'task', mode: 'small-step', retentionMode: 'ephemeral' });
    if (!opened.ok) return opened;
    const result = await turns.run({ conversationId: opened.conversation.id,
      scopeGrantId: opened.scopeGrantId, message: payload.message });
    if (!result.ok) return result;
    return { ...result, conversationId: result.conversation?.id || opened.conversation.id,
      status: result.proposal ? 'ready' : 'need-more', question: result.answer || null,
      provider: result.source, fallback: result.source === 'local' };
  }
  function invalidateAll() {
    return admission.invalidate('authorization-changed');
  }
  function register(registerIpc, { updatePreferencesCommand, readEnvironmentCredential = () => process.env.FOCUSPIX_AI_API_KEY } = {}) {
    if (memoryAuthority && !memoryManagement) memoryManagement = createMemoryManagement({ authority: memoryAuthority,
      collaboration: { sessions, reads, invalidateScopes: () => { grants.clear(); changes.invalidate(); } }, now, lifecycle, publishChange });
    memoryManagement?.register(registerIpc);
    registerIpc('ai:credential-status', () => credentialStore.status());
    registerIpc('ai:credential-import', (_event, payload) => {
      const secret = payload?.secret || readEnvironmentCredential();
      if (!secret) return { ok: false, reason: 'environment-credential-missing', ...credentialStore.status() };
      return admission.runCredential({ kind: 'import', commit: () => credentialStore.set(secret),
        readStatus: () => credentialStore.status() });
    });
    registerIpc('ai:clear-credential', () => {
      return admission.runCredential({ kind: 'clear', commit: () => credentialStore.clear(),
        readStatus: () => credentialStore.status() });
    });
    if (updatePreferencesCommand) registerIpc('settings:update', (_event, patch) => {
      return admission.runSettings({ patch, readSettings: getSettings, command: updatePreferencesCommand });
    });
    registerIpc('ai:draft-turn', (_event, payload) => legacyTurn(payload));
    registerIpc('ai:draft-discard', (_event, payload) => { invalidateConversation(payload); return access.pause(payload); });
    registerIpc('ai:conversation-start', (_event, payload) => access.start(payload));
    registerIpc('ai:conversation-list', (_event, payload) => sessions.list(payload));
    registerIpc('ai:conversation-open', (_event, payload) => access.open(payload));
    registerIpc('ai:conversation-scope', (_event, payload) => { invalidateConversation(payload); return access.setScope(payload); });
    registerIpc('ai:conversation-context-choices', (_event, payload) => access.getConversationContextChoices(payload));
    registerIpc('ai:change-preview', (_event, payload) => changes.preview(payload));
    registerIpc('ai:change-confirm', (_event, payload) => changes.confirm(payload));
    registerIpc('ai:change-cancel', (_event, payload) => changes.cancel(payload));
    registerIpc('ai:change-receipt', (_event, payload) => changes.getReceipt(payload));
    registerIpc('ai:conversation-receipts', (_event, payload) => changes.listReceipts(payload));
    registerIpc('ai:conversation-proposal-status', (_event, payload) => proposalStatus(payload));
    registerIpc('ai:change-undo-preview', (_event, payload) => changes.previewUndo(payload));
    registerIpc('ai:conversation-mode', (_event, payload) => { invalidateConversation(payload); return access.setMode(payload); });
    registerIpc('ai:conversation-turn', (_event, payload) => turns.run(payload));
    registerIpc('ai:conversation-pause', (_event, payload) => { invalidateConversation(payload); return access.pause(payload); });
    registerIpc('ai:conversation-cancel', (_event, payload) => { invalidateConversation(payload); return access.cancel(payload); });
    registerIpc('ai:conversation-retention', (_event, payload) => sessions.setRetention(payload));
    registerIpc('ai:conversation-delete', (_event, payload) => {
      const prepared = access.prepareDelete(payload);
      if (!prepared.ok) return prepared;
      invalidateConversation(payload);
      const privacy = changes.redactConversation(payload);
      if (!privacy.ok) return privacy;
      const removed = access.remove(payload);
      return { ...removed, receiptDetailsRedacted: privacy.changed === true };
    });
  }
  function dispose() { admission.close(); requestScope?.close(); sessions.dispose(); storage.close(); }
  if (lifecycle) lifecycle.register('ai:collaboration', dispose);
  return Object.freeze({ register, dispose, sessions, grants, reads, turns, getProvider, changes, ...access, invalidateAll,
    isContextMessageAllowed: (message, context) => memoryManagement?.isContextMessageAllowed(message, context) === true });
}
module.exports = { createAiCollaboration };
