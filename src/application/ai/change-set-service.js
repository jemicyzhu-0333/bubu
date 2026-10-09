'use strict';
const { isDeepStrictEqual } = require('node:util');
const { closed, id, text, jsonValue, validateCandidateOperations } = require('../../core/ai-change-protocol');
const { entityFingerprint } = require('./entity-fingerprint');
const { targetRefs, version, simulateChanges } = require('./change-operations');
const { createApplyChangeSetWorkflow } = require('../workflows/apply-ai-change-set');

const MAX_PREVIEWS = 50;
const fail = reason => ({ ok: false, reason });
const copy = value => structuredClone(value);
const referenceValid = ref => closed(ref, ['kind', 'id', 'revision'])
  && ['task', 'recurrenceSeries', 'inbox', 'routine', 'message', 'summary', 'event', 'activity', 'timeline', 'energy', 'memory', 'planning-preference'].includes(ref.kind)
  && id(ref.id) && (ref.revision === null || id(ref.revision));
function authorizationValid(value) {
  return closed(value, ['scopeGrantId', 'generation', 'providerFingerprint']) && id(value.scopeGrantId)
    && Number.isSafeInteger(value.generation) && value.generation >= 0
    && typeof value.providerFingerprint === 'string' && value.providerFingerprint.length > 0 && value.providerFingerprint.length <= 2048;
}
function metadataValid(candidate) {
  return id(candidate.conversationId) && ['task', 'stuck', 'planning', 'review'].includes(candidate.purpose)
    && authorizationValid(candidate.authorization)
    && (candidate.rationale === undefined || candidate.rationale === '' || text(candidate.rationale, 2000))
    && (candidate.evidenceRefs === undefined || Array.isArray(candidate.evidenceRefs)
      && candidate.evidenceRefs.length <= 50 && candidate.evidenceRefs.every(referenceValid)
      && new Set(candidate.evidenceRefs.map(ref => `${ref.kind}:${ref.id}:${ref.revision}`)).size === candidate.evidenceRefs.length)
    && (candidate.warnings === undefined || Array.isArray(candidate.warnings) && candidate.warnings.length <= 20
      && candidate.warnings.every(warning => text(warning, 500)));
}
function createChangeSetService(ports) {
  const { ownerId, identityAvailable, readSnapshot, readRevision, now, idFactory, ledger,
    validateAuthorization, getTimezone } = ports;
  if (!id(ownerId) || typeof validateAuthorization !== 'function' || typeof getTimezone !== 'function') throw new TypeError('change-service-ports-invalid');
  const previews = new Map(), confirmations = new WeakMap();
  const issuedIds = new Set();
  function nextId(kind) {
    for (let attempt = 0; attempt < 64; attempt++) {
      const value = idFactory(kind);
      if (id(value) && !issuedIds.has(value)) { issuedIds.add(value); return value; }
    }
    throw new Error('change-id-unavailable');
  }
  const workflow = createApplyChangeSetWorkflow({ ...ports,
    validateConfirmation: (token, change) => confirmations.get(token) === change });
  function authorized(candidate) {
    const result = validateAuthorization(candidate.authorization, candidate);
    return result === true || result?.ok === true;
  }
  function allocateOperation(candidate, previous) {
    const opId = candidate.opId || nextId('operation');
    const operation = { ...copy(candidate), opId, allocatedIds: [] };
    const kinds = ['task.create', 'inbox.convert-task'].includes(operation.type)
      ? ['task', ...(operation.input.steps || []).map(() => 'step')]
      : operation.type === 'task.steps' ? operation.steps.filter(step => step.op === 'add').map(() => 'step') : [];
    operation.allocatedIds = kinds.map((kind, index) => {
      const old = previous?.allocatedIds[index];
      return old?.kind === kind ? copy(old) : { kind, id: nextId(kind) };
    });
    if (!id(opId) || operation.allocatedIds.some(item => !id(item.id))) throw new Error('change-id-invalid');
    if (operation.type === 'routine.schedule') operation.timezone = getTimezone();
    return operation;
  }
  function storePreview(candidate, operations, previous = null, revertsReceiptId = null) {
    if (!previous && previews.size >= MAX_PREVIEWS) return fail('change-preview-capacity');
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0 || at + ledger.CONFIRMATION_TTL_MS > 8.64e15) return fail('change-clock-invalid');
    if (previous?.proposalVersion === Number.MAX_SAFE_INTEGER) return fail('change-version-exhausted');
    const snapshot = readSnapshot();
    if (snapshot.aiCollaboration.receipts.some(receipt => receipt.ownerId !== ownerId)) return fail('change-profile-mismatch');
    const targetVersions = [...new Map(operations.flatMap(op => targetRefs(snapshot, op))
      .map(ref => [`${ref.kind}:${ref.id}`, version(snapshot, ref)])).values()];
    if (targetVersions.some(ref => ref.fingerprint === null)) return fail('change-target-missing');
    for (const operation of operations) operation.expectedVersion = targetVersions.find(ref => ref.id === operation.entityId)?.fingerprint || null;
    const simulation = simulateChanges(snapshot, operations, at, ports);
    if (!simulation.ok) return simulation;
    if (!simulation.results.some(result => result.changed)) return fail('change-no-op');
    const changeSetId = previous?.changeSetId || candidate.canonicalChangeSetId || nextId('change');
    if (!previous && previews.has(changeSetId)) return fail('change-proposal-identity-conflict');
    const applyGroupId = previous?.applyGroupId || nextId('group');
    if (!id(changeSetId) || !id(applyGroupId)) return fail('change-id-invalid');
    const warnings = copy(candidate.warnings || []);
    const reversibility = simulation.inverses.length && simulation.results.every(item =>
      !['task.create', 'inbox.convert-task', 'inbox.keep'].includes(item.type)) ? 'available' : 'unavailable';
    const operationsHash = entityFingerprint({ operations, targetVersions });
    const previewHash = entityFingerprint({ diff: simulation.diff, warnings, reversibility });
    const disclosureHash = entityFingerprint({ authorization: candidate.authorization, purpose: candidate.purpose,
      targets: targetVersions, evidenceRefs: candidate.evidenceRefs || [], fields: simulation.diff.map(item =>
        ({ entityRef: item.entityRef, fields: [...item.fields, ...item.derivedChanges].map(field => field.field) })) });
    const change = { version: 1, ownerId, changeSetId, proposalVersion: (previous?.proposalVersion || 0) + 1,
      conversationId: candidate.conversationId, purpose: candidate.purpose, createdAt: at,
      expiresAt: at + ledger.CONFIRMATION_TTL_MS, baseRevision: readRevision(), authorization: copy(candidate.authorization),
      targetVersions, operations, applyGroupId, operationsHash, previewHash, disclosureHash,
      applyGroups: [{ applyGroupId, store: 'config', opIds: operations.map(op => op.opId), operationsHash,
        previewHash, preview: simulation.diff }], rationale: candidate.rationale || '', evidenceRefs: copy(candidate.evidenceRefs || []),
      warnings, reversibility, diff: simulation.diff, revertsReceiptId };
    previews.set(changeSetId, change);
    return { ok: true, changeSet: copy(change) };
  }
  function prepare(candidate) {
    try {
      if (identityAvailable !== true) return fail('change-profile-unavailable');
      if (ports.durability && ports.durability.status().available !== true) return fail('authoritative-config-unavailable');
      if (!jsonValue(candidate) || !closed(candidate, ['conversationId', 'purpose', 'authorization', 'operations', 'rationale', 'evidenceRefs',
        'warnings', 'changeSetId', 'expectedProposalVersion', 'canonicalChangeSetId']) || !metadataValid(candidate)
        || (candidate.canonicalChangeSetId !== undefined && !id(candidate.canonicalChangeSetId))) return fail('change-candidate-invalid');
      const parsed = validateCandidateOperations(candidate.operations);
      if (!parsed.ok) return parsed;
      if (!authorized(candidate)) return fail('change-authorization-invalid');
      const previous = candidate.changeSetId ? previews.get(candidate.changeSetId) : null;
      if (candidate.changeSetId && (!previous || previous.conversationId !== candidate.conversationId
        || previous.proposalVersion !== candidate.expectedProposalVersion)) return fail('change-proposal-version-conflict');
      if (!previous && candidate.expectedProposalVersion !== undefined) return fail('change-candidate-invalid');
      const operations = parsed.operations.map(op => {
        const old = previous?.operations.find(item => item.opId === op.opId);
        if (op.opId && !old) throw new Error('change-op-id-invalid');
        return allocateOperation(op, old);
      });
      if (previous) {
        const consumed = new Set(readSnapshot().aiCollaboration.receipts.filter(receipt => receipt.ownerId === ownerId
          && receipt.changeSetId === previous.changeSetId).flatMap(receipt => receipt.results.map(item => item.opId)));
        if (operations.some(operation => consumed.has(operation.opId))) return fail('change-operation-consumed');
      }
      return storePreview(candidate, operations, previous);
    } catch (_) { return fail('change-candidate-invalid'); }
  }
  function get({ conversationId, changeSetId }) {
    const change = previews.get(changeSetId);
    return change?.conversationId === conversationId ? { ok: true, changeSet: copy(change) } : fail('change-proposal-missing');
  }
  function confirm(request) {
    if (!closed(request, ['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash'])
      || !id(request.conversationId) || !id(request.changeSetId) || !id(request.applyGroupId)
      || !Number.isSafeInteger(request.proposalVersion) || request.proposalVersion < 1
      || ['operationsHash', 'previewHash', 'disclosureHash'].some(field => !/^[a-f0-9]{64}$/.test(request[field]))) return fail('change-confirmation-invalid');
    if (identityAvailable !== true) return fail('change-profile-unavailable');
    const prior = workflow.lookup({ ownerId, ...request });
    if (!prior.ok) return prior;
    if (prior.receipt) return workflow.response(prior.receipt, true);
    const change = previews.get(request.changeSetId);
    if (!change || !Object.keys(request).every(key => isDeepStrictEqual(request[key], change[key]))) return fail('change-proposal-version-conflict');
    const token = Object.freeze({});
    confirmations.set(token, change);
    try { return workflow.execute({ changeSet: change, confirmation: token }); }
    finally { confirmations.delete(token); }
  }
  function prepareUndo({ receiptId, conversationId, authorization }) {
    if (identityAvailable !== true) return fail('change-profile-unavailable');
    if (!id(receiptId) || !id(conversationId) || !authorizationValid(authorization)) return fail('change-undo-invalid');
    const receipt = readSnapshot().aiCollaboration.receipts.find(item => item.receiptId === receiptId && item.ownerId === ownerId);
    if (!receipt || receipt.conversationId !== conversationId || receipt.status !== 'applied' || !receipt.details?.undo || receipt.details.undo.expiresAt <= now()) return fail('change-undo-unavailable');
    const candidate = { conversationId, purpose: 'review', authorization, evidenceRefs: [], warnings: [], rationale: '' };
    if (!authorized(candidate)) return fail('change-authorization-invalid');
    const snapshot = readSnapshot();
    if (receipt.details.undo.expectedPostVersions.some(ref => version(snapshot, ref).fingerprint !== ref.fingerprint)) return fail('change-target-conflict');
    const operations = receipt.details.undo.operations.map(op => ({ ...copy(op), opId: nextId('operation'), allocatedIds: [] }));
    return storePreview(candidate, operations, null, receiptId);
  }
  function cancel({ conversationId, changeSetId }) {
    const entry = previews.get(changeSetId);
    if (!entry || entry.conversationId !== conversationId) return fail('change-proposal-missing');
    previews.delete(changeSetId);
    return { ok: true };
  }
  return Object.freeze({ prepare, get, confirm, prepareUndo, cancel });
}
module.exports = { MAX_PREVIEWS, createChangeSetService, authorizationValid };
