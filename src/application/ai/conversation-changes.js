'use strict';

const { closed, id, jsonValue, validateCandidateOperations } = require('../../core/ai-change-protocol');
const { entityFingerprint } = require('./entity-fingerprint');
const { version } = require('./change-operations');
const { selectedContextRequests } = require('./context-grants');
const { cursorOffset } = require('../../core/ai-read-cursor');
const { routines } = require('../../capabilities');

const MAX_PENDING_CHANGES = 50;
const LOCAL_UNDO_TTL_MS = 15 * 60 * 1000;
const CONFIRM_KEYS = Object.freeze(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
  'operationsHash', 'previewHash', 'disclosureHash']);
const fail = reason => ({ ok: false, reason });
const copy = value => structuredClone(value);
function safePayload(value, keys) { return jsonValue(value) && closed(value, keys); }
function sourceIdentity(message) {
  return entityFingerprint({ messageId: message.id, proposal: message.proposal,
    provenance: message.provenance, sourceRefs: message.sourceRefs });
}

// The constructor's factory receives this adapter's private authorization check,
// resolving composition without a setter or a broad service registry.
function createConversationChanges({ service, createService, sessions, grants, reads, getProvider,
  readSnapshot, ownerId, identityAvailable, now, idFactory, durability = null } = {}) {
  if (!sessions?.get || !grants?.resolve || typeof getProvider !== 'function'
    || typeof readSnapshot !== 'function' || typeof now !== 'function' || typeof idFactory !== 'function'
    || !id(ownerId)) throw new TypeError('conversation-change-ports-invalid');
  const bindings = new Map(), localGrants = new Map(), issuedLocalIds = new Set();
  let localPreparing = null, localSequence = 0;
  function ownedConversation(conversationId) {
    if (identityAvailable !== true) return fail('change-profile-unavailable');
    const loaded = sessions.get({ conversationId });
    return loaded?.ok && loaded.conversation?.ownerId === ownerId ? loaded : fail(loaded?.reason || 'change-conversation-owner-mismatch');
  }
  function canonicalSource(conversation, proposalId) {
    const found = conversation.messages.filter(message => message.role === 'assistant' && message.proposal?.id === proposalId);
    if (found.length !== 1 || found[0].proposal.kind !== 'change-set') return fail('change-proposal-missing');
    const message = found[0];
    try {
      if (Buffer.byteLength(message.proposal.body, 'utf8') > 64 * 1024) return fail('change-proposal-invalid');
      const body = JSON.parse(message.proposal.body);
      if (!safePayload(body, ['operations']) || !Object.hasOwn(body, 'operations')) return fail('change-proposal-invalid');
      const parsed = validateCandidateOperations(body.operations);
      if (!parsed.ok || parsed.operations.some(operation => operation.opId !== undefined)) return fail('change-proposal-invalid');
      return { ok: true, message, operations: parsed.operations, sourceHash: sourceIdentity(message) };
    } catch (_) { return fail('change-proposal-invalid'); }
  }
  function currentRemote(conversationId, authorization) {
    const loaded = ownedConversation(conversationId);
    if (!loaded.ok) return loaded;
    const conversation = loaded.conversation, provider = getProvider(conversation);
    if (!provider?.enabled || !provider.configured || provider.purposeAllowed === false
      || authorization.providerFingerprint !== provider.fingerprint || authorization.generation !== conversation.authGeneration) {
      return fail('change-authorization-invalid');
    }
    const resolved = grants.resolve({ scopeGrantId: authorization.scopeGrantId, conversationId,
      providerId: provider.fingerprint, authorizationGeneration: conversation.authGeneration });
    if (!resolved?.ok || resolved.grant.ownerId !== ownerId || resolved.grant.purpose !== conversation.purpose) return fail('change-authorization-invalid');
    return { ok: true, conversation, provider, grant: resolved.grant };
  }
  function targetsAllowed(operations, grant) {
    const state = readSnapshot();
    return Array.isArray(operations) && operations.every(operation => {
      const selected = grant.selection;
      if (operation.type === 'task.create') return true;
      if (['task.update', 'task.steps'].includes(operation.type)) return selected.taskIds.includes(operation.entityId)
        && selected.tools.some(tool => ['task.read', 'task.search'].includes(tool));
      if (['inbox.convert-task', 'inbox.keep'].includes(operation.type)) return selected.inboxIds.includes(operation.entityId)
        && selected.tools.includes('inbox.search');
      if (operation.type === 'routine.schedule') return (selected.routineIds || []).includes(operation.entityId)
        && selected.tools.includes('routine.search') && state.routines.some(routine => routine.id === operation.entityId
          && routines.scheduleEditing.ORDINARY_KINDS.includes(routine.kind));
      return false;
    });
  }
  function sourceEvidenceValid(message, remote) {
    const sourceRefs = message.sourceRefs || [];
    if (!sourceRefs.length) return message.contextAllowed !== false;
    if (typeof reads?.execute !== 'function') return false;
    const evidence = [];
    for (const request of selectedContextRequests(remote.grant)) {
      const result = reads.execute({ grant: remote.grant, request });
      if (!result?.ok || result.availability !== 'available') return false;
      evidence.push(...result.sourceRefs);
    }
    return sourceRefs.every(ref => ref.kind === 'message'
      ? remote.conversation.messages.some(item => item.id === ref.id && item.contextAllowed)
      : evidence.some(current => current.kind === ref.kind && current.id === ref.id && current.revision === ref.revision));
  }
  function receiptState(receiptId) {
    if (identityAvailable !== true) return fail('change-profile-unavailable');
    const state = readSnapshot(), receipt = state.aiCollaboration.receipts.find(item => item.receiptId === receiptId && item.ownerId === ownerId);
    return receipt ? { ok: true, receipt, state } : fail('change-receipt-missing');
  }
  function undoAvailable(receipt, state) {
    const undo = receipt.details?.undo;
    return (!durability || durability.verify().ok) && receipt.status === 'applied' && !receipt.detailsRedacted && Boolean(undo) && now() < undo.expiresAt
      && undo.expectedPostVersions.every(ref => version(state, ref).fingerprint === ref.fingerprint);
  }
  function visibleReceipt(receipt) {
    const projected = copy(receipt);
    if (projected.details && now() >= projected.details.expiresAt) {
      projected.details = null;
      projected.detailsRedacted = true;
    }
    return projected;
  }
  function receiptProjection(receipt, state) {
    const projected = visibleReceipt(receipt);
    const durable = !durability || durability.verify().ok;
    return { ok: true, receipt: projected, receiptId: receipt.receiptId, durability: durable ? 'confirmed' : 'unconfirmed',
      historyStatus: !durable ? 'pending' : state.aiCollaboration.outbox.some(entry => entry.receiptId === receipt.receiptId) ? 'pending' : 'synced',
      undoAvailable: durable && undoAvailable(projected, state) };
  }
  function validateLocal(authorization, candidate, local) {
    const at = now();
    if (at < local.createdAt || at >= local.expiresAt || authorization.generation !== local.generation
      || authorization.providerFingerprint !== local.fingerprint || candidate.conversationId !== local.conversationId
      || candidate.purpose !== 'review') return false;
    const current = receiptState(local.receiptId);
    if (!current.ok || !undoAvailable(current.receipt, current.state)
      || entityFingerprint(current.receipt.details.undo) !== local.undoHash) return false;
    if (localPreparing === local && !candidate.operations) return true;
    return candidate.revertsReceiptId === local.receiptId && candidate.changeSetId === local.changeSetId
      && candidate.operationsHash === local.operationsHash && candidate.previewHash === local.previewHash
      && candidate.disclosureHash === local.disclosureHash;
  }
  function validateAuthorization(authorization, candidate) {
    try {
      if (identityAvailable !== true || !authorization || !candidate) return false;
      const local = localGrants.get(authorization.scopeGrantId);
      if (local) return validateLocal(authorization, candidate, local);
      const remote = currentRemote(candidate.conversationId, authorization);
      if (!remote.ok || candidate.purpose !== remote.conversation.purpose || !targetsAllowed(candidate.operations, remote.grant)) return false;
      const binding = candidate.changeSetId ? bindings.get(candidate.changeSetId) : null;
      if (!binding) return !candidate.changeSetId;
      if (binding.local || binding.conversationId !== candidate.conversationId) return false;
      const source = canonicalSource(remote.conversation, binding.proposalId);
      return source.ok && source.sourceHash === binding.sourceHash
        && sourceEvidenceValid(source.message, remote)
        && (source.message.provenance?.source !== 'provider' || source.message.provenance.providerId === remote.provider.fingerprint);
    } catch (_) { return false; }
  }
  const changes = service || (typeof createService === 'function' ? createService(validateAuthorization) : null);
  if (!changes || !['prepare', 'confirm', 'cancel', 'get', 'prepareUndo'].every(method => typeof changes[method] === 'function')) {
    throw new TypeError('conversation-change-service-required');
  }
  function preview(payload) {
    try {
      if (!safePayload(payload, ['conversationId', 'scopeGrantId', 'proposalId', 'operations', 'changeSetId', 'expectedProposalVersion'])
        || ![payload.conversationId, payload.scopeGrantId, payload.proposalId].every(id)) return fail('change-preview-invalid');
      const loaded = ownedConversation(payload.conversationId);
      if (!loaded.ok) return loaded;
      const provider = getProvider(loaded.conversation);
      const authorization = { scopeGrantId: payload.scopeGrantId, generation: loaded.conversation.authGeneration, providerFingerprint: provider.fingerprint };
      const remote = currentRemote(payload.conversationId, authorization);
      if (!remote.ok) return remote;
      const source = canonicalSource(remote.conversation, payload.proposalId);
      const canonicalChangeSetId = `change-${entityFingerprint({ ownerId, conversationId: payload.conversationId, proposalId: payload.proposalId })}`;
      const consumed = readSnapshot().aiCollaboration.receipts.find(receipt => receipt.ownerId === ownerId
        && receipt.conversationId === payload.conversationId && receipt.changeSetId === canonicalChangeSetId);
      if (consumed) return { ...receiptProjection(consumed, readSnapshot()), alreadyApplied: true };
      if (!source.ok) return source;
      if (!sourceEvidenceValid(source.message, remote)) return fail('change-source-not-authorized');
      if (source.message.provenance?.source === 'provider' && source.message.provenance.providerId !== provider.fingerprint) return fail('change-proposal-provider-changed');
      if (!payload.changeSetId && bindings.has(canonicalChangeSetId)) {
        if (payload.operations !== undefined) return fail('change-proposal-version-conflict');
        return { ...changes.get({ conversationId: payload.conversationId, changeSetId: canonicalChangeSetId }), proposalId: payload.proposalId };
      }
      const prior = payload.changeSetId ? bindings.get(payload.changeSetId) : null;
      if (payload.changeSetId && (!prior || prior.local || prior.conversationId !== payload.conversationId
        || prior.proposalId !== payload.proposalId || prior.sourceHash !== source.sourceHash)) return fail('change-proposal-identity-conflict');
      if (!prior && (payload.expectedProposalVersion !== undefined || bindings.size >= MAX_PENDING_CHANGES)) return fail('change-preview-capacity');
      const parsed = validateCandidateOperations(payload.operations === undefined ? source.operations : payload.operations);
      if (!parsed.ok) return parsed;
      if (!targetsAllowed(parsed.operations, remote.grant)) return fail('change-target-not-authorized');
      if (parsed.operations.some(operation => operation.opId !== undefined) && !prior) return fail('change-operation-identity-invalid');
      const prepared = changes.prepare({ conversationId: payload.conversationId, purpose: remote.conversation.purpose,
        authorization, canonicalChangeSetId, operations: parsed.operations, evidenceRefs: copy(source.message.sourceRefs || []),
        ...(prior ? { changeSetId: payload.changeSetId, expectedProposalVersion: payload.expectedProposalVersion } : {}) });
      if (!prepared.ok) return prepared;
      bindings.set(prepared.changeSet.changeSetId, { conversationId: payload.conversationId, proposalId: payload.proposalId,
        sourceHash: source.sourceHash, local: false });
      return { ...prepared, proposalId: payload.proposalId };
    } catch (_) { return fail('change-preview-unavailable'); }
  }
  function release(changeSetId) {
    const binding = bindings.get(changeSetId);
    if (!binding) return;
    try { changes.cancel({ conversationId: binding.conversationId, changeSetId }); } catch (_) { /* Invalidation still revokes the adapter authority. */ }
    if (binding.local) localGrants.delete(binding.localGrantId);
    bindings.delete(changeSetId);
  }
  function confirm(payload) {
    if (!safePayload(payload, CONFIRM_KEYS) || !CONFIRM_KEYS.every(key => Object.hasOwn(payload, key))) return fail('change-confirmation-invalid');
    let current;
    try { current = readSnapshot().aiCollaboration.receipts.find(receipt => receipt.ownerId === ownerId
      && CONFIRM_KEYS.every(key => receipt[key] === payload[key])); }
    catch (_) { return { ok: false, reason: 'change-commit-outcome-unknown', retrySameIdentity: true, outcome: 'unknown' }; }
    // Reading a committed result remains possible after restart or permission withdrawal.
    if (current && identityAvailable === true) {
      if (durability && !durability.verify().ok) return { ok: false, reason: 'change-durability-uncertain',
        committed: true, receiptId: current.receiptId, retrySameIdentity: true };
      return { ...receiptProjection(current, readSnapshot()), replayed: true };
    }
    const binding = bindings.get(payload.changeSetId);
    if (!binding || binding.conversationId !== payload.conversationId) return fail('change-proposal-missing');
    const prepared = changes.get({ conversationId: payload.conversationId, changeSetId: payload.changeSetId });
    if (!prepared?.ok || !validateAuthorization(prepared.changeSet.authorization, prepared.changeSet)) return fail('change-authorization-invalid');
    const result = changes.confirm(payload);
    if (!result.ok) return result;
    release(payload.changeSetId);
    try {
      const stored = receiptState(result.receiptId);
      if (stored.ok) return { ...receiptProjection(stored.receipt, stored.state), replayed: result.replayed };
    } catch (_) { /* A committed receipt must not become a retryable UI failure. */ }
    return { ...result, receipt: visibleReceipt(result.receipt), undoAvailable: false };
  }
  function cancel(payload) {
    if (!safePayload(payload, CONFIRM_KEYS) || !CONFIRM_KEYS.every(key => Object.hasOwn(payload, key))) return fail('change-cancel-invalid');
    const binding = bindings.get(payload.changeSetId);
    if (!binding || binding.conversationId !== payload.conversationId) return fail('change-proposal-missing');
    const current = changes.get(payload);
    if (!current.ok || !CONFIRM_KEYS.every(key => current.changeSet[key] === payload[key])) return fail('change-proposal-version-conflict');
    release(payload.changeSetId);
    return { ok: true };
  }
  function getReceipt(payload) {
    if (!safePayload(payload, ['receiptId']) || !id(payload.receiptId)) return fail('change-receipt-query-invalid');
    const found = receiptState(payload.receiptId);
    return found.ok ? receiptProjection(found.receipt, found.state) : found;
  }
  function listReceipts(payload) {
    if (identityAvailable !== true) return fail('change-profile-unavailable');
    if (!safePayload(payload, ['conversationId', 'cursor', 'limit']) || !id(payload.conversationId)) return fail('change-receipt-query-invalid');
    const limit = payload.limit === undefined ? 20 : payload.limit;
    const offset = cursorOffset(payload.cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || offset === null) return fail('change-receipt-query-invalid');
    const state = readSnapshot();
    const rows = state.aiCollaboration.receipts.filter(receipt => receipt.ownerId === ownerId
      && receipt.conversationId === payload.conversationId)
      .sort((a, b) => b.commitSequence - a.commitSequence);
    const items = rows.slice(offset, offset + limit);
    return { ok: true, items: items.map(receipt => receiptProjection(receipt, state)),
      nextCursor: rows.length > offset + limit ? `offset:${offset + limit}` : null };
  }
  function previewUndo(payload) {
    if (!safePayload(payload, ['conversationId', 'receiptId', 'scopeGrantId']) || !id(payload.receiptId)
      || payload.conversationId !== undefined && !id(payload.conversationId)
      || payload.scopeGrantId !== undefined && !id(payload.scopeGrantId)) return fail('change-undo-invalid');
    const found = receiptState(payload.receiptId);
    if (!found.ok) return found;
    if (payload.conversationId !== undefined && payload.conversationId !== found.receipt.conversationId) return fail('change-conversation-owner-mismatch');
    if (!undoAvailable(found.receipt, found.state)) return fail('change-undo-unavailable');
    if (bindings.size >= MAX_PENDING_CHANGES) return fail('change-preview-capacity');
    let grantId;
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = idFactory('local-undo');
      if (id(candidate) && !issuedLocalIds.has(candidate)) { grantId = candidate; issuedLocalIds.add(candidate); break; }
    }
    if (!grantId) return fail('change-id-unavailable');
    const at = now();
    const local = { receiptId: found.receipt.receiptId, conversationId: found.receipt.conversationId,
      createdAt: at, expiresAt: Math.min(at + LOCAL_UNDO_TTL_MS, found.receipt.details.undo.expiresAt),
      generation: ++localSequence, undoHash: entityFingerprint(found.receipt.details.undo) };
    local.fingerprint = `local-undo:${entityFingerprint({ ownerId, receiptId: local.receiptId, generation: local.generation, undoHash: local.undoHash })}`;
    localGrants.set(grantId, local);
    localPreparing = local;
    let prepared;
    try { prepared = changes.prepareUndo({ receiptId: local.receiptId, conversationId: local.conversationId,
      authorization: { scopeGrantId: grantId, generation: local.generation, providerFingerprint: local.fingerprint } }); }
    finally { localPreparing = null; }
    if (!prepared.ok) { localGrants.delete(grantId); return prepared; }
    const change = prepared.changeSet;
    Object.assign(local, { changeSetId: change.changeSetId, operationsHash: change.operationsHash,
      previewHash: change.previewHash, disclosureHash: change.disclosureHash });
    bindings.set(change.changeSetId, { conversationId: local.conversationId, local: true, localGrantId: grantId });
    return prepared;
  }
  function invalidate(conversationId) {
    let invalidated = 0;
    for (const [changeSetId, binding] of bindings) {
      if (conversationId === undefined || conversationId === binding.conversationId) { release(changeSetId); invalidated++; }
    }
    return { ok: true, invalidated };
  }
  return Object.freeze({ preview, confirm, cancel, getReceipt, listReceipts, previewUndo, invalidate, validateAuthorization });
}
module.exports = { MAX_PENDING_CHANGES, LOCAL_UNDO_TTL_MS, createConversationChanges };
