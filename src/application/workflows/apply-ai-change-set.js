'use strict';
const { isDeepStrictEqual } = require('node:util');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');
const { entityFingerprint } = require('../ai/entity-fingerprint');
const { BUSINESS_WRITES, version, simulateChanges } = require('../ai/change-operations');

const APPLY_AI_CHANGE_SET_WRITES = Object.freeze([...BUSINESS_WRITES, 'aiCollaboration']);
const identityOf = change => Object.fromEntries(['ownerId', 'conversationId', 'changeSetId', 'proposalVersion',
  'applyGroupId', 'operationsHash', 'previewHash', 'disclosureHash'].map(key => [key, change[key]]));
const fail = reason => ({ ok: false, reason });
function eventCalendar(occurredAt, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23' }).formatToParts(new Date(occurredAt)).filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  return { timezone, utcOffsetMinutes: Math.round((localAsUtc - Math.floor(occurredAt / 1000) * 1000) / 60000),
    localDayKey: `${parts.year}-${parts.month}-${parts.day}` };
}
function createApplyChangeSetWorkflow(ports) {
  const { unitOfWork, ledger, now, readSnapshot, readRevision, normalizeState,
    validateConfirmation, validateAuthorization, buildEvents, getTimezone, ownerId, identityAvailable,
    publish = () => {}, reportEffectError = () => {}, durability = null } = ports;
  if (!unitOfWork?.run || !ledger?.appendReceipt || typeof normalizeState !== 'function'
    || typeof validateConfirmation !== 'function' || typeof buildEvents !== 'function') throw new TypeError('change-workflow-ports-invalid');
  function lookup(identity) {
    try { return { ok: true, receipt: ledger.findReceipt(readSnapshot().aiCollaboration, identity) }; }
    catch (error) { return error?.code === 'config-commit-outcome-unknown'
      ? { ok: false, reason: 'change-commit-outcome-unknown', retrySameIdentity: true, outcome: 'unknown' }
      : fail('change-receipt-conflict'); }
  }
  function response(receipt, replayed = false, committedState = null) {
    let state = committedState;
    try { state = readSnapshot(); } catch (_) { /* The durable receipt already proves success. */ }
    const proof = durability ? durability.verify() : { ok: true };
    if (!proof.ok) return { ok: false, reason: 'change-durability-uncertain', committed: true,
      receiptId: receipt.receiptId, receipt: structuredClone(receipt), retrySameIdentity: true };
    return { ok: true, receipt: structuredClone(receipt), replayed,
      receiptId: receipt.receiptId, appliedRevision: receipt.appliedRevision,
      historyStatus: !state || state.aiCollaboration.outbox.some(item => item.receiptId === receipt.receiptId) ? 'pending' : 'synced' };
  }
  function execute({ changeSet: change, confirmation }) {
    if (identityAvailable !== true || ownerId !== change?.ownerId) return fail('change-profile-unavailable');
    const identity = identityOf(change);
    const prior = lookup(identity);
    if (!prior.ok) return prior;
    if (prior.receipt) return response(prior.receipt, true);
    if (!validateConfirmation(confirmation, change)) return fail('change-confirmation-required');
    if (durability && (durability.status().available !== true || !durability.verify().ok)) return fail('authoritative-config-unavailable');
    const at = now();
    if (!Number.isSafeInteger(at) || at < change.createdAt || at >= change.expiresAt) return fail('change-proposal-expired');
    const authorized = validateAuthorization(change.authorization, change);
    if (authorized !== true && authorized?.ok !== true) return fail('change-authorization-invalid');
    let transaction;
    try {
      transaction = unitOfWork.run({ writes: APPLY_AI_CHANGE_SET_WRITES, expectedRevision: readRevision(),
        context: { now: at, durability: 'authoritative' }, transition: state => {
          if (change.targetVersions.some(ref => version(state, ref).fingerprint !== ref.fingerprint)) return fail('change-target-conflict');
          const consumed = new Set(state.aiCollaboration.receipts.filter(receipt => receipt.ownerId === ownerId
            && receipt.changeSetId === change.changeSetId).flatMap(receipt => receipt.results.map(item => item.opId)));
          if (change.operations.some(operation => consumed.has(operation.opId))) return fail('change-operation-consumed');
          if (change.revertsReceiptId) {
            const original = state.aiCollaboration.receipts.find(item => item.receiptId === change.revertsReceiptId);
            if (!original || original.ownerId !== ownerId || original.status !== 'applied' || !original.details?.undo
              || original.details.undo.expiresAt <= at) return fail('change-undo-unavailable');
          }
          const simulation = simulateChanges(state, change.operations, at, ports);
          if (!simulation.ok) return simulation;
          if (!isDeepStrictEqual(simulation.diff, change.diff)) return fail('change-preview-drift');
          if (!simulation.results.some(item => item.changed)) return fail('change-no-op');
          const receipt = {
            version: 1, receiptId: ports.idFactory('receipt'), commandId: `ai-command-${entityFingerprint(identity)}`,
            ...identity, commitSequence: state.aiCollaboration.nextCommitSequence, appliedRevision: readRevision() + 1,
            committedAt: at, confirmationExpiresAt: change.expiresAt, dedupeUntil: at + ledger.DEDUPE_TTL_MS,
            status: 'applied', revertsReceiptId: change.revertsReceiptId || null, revertedByReceiptId: null,
            results: simulation.results, details: { expiresAt: at + ledger.DETAILS_TTL_MS,
              diff: simulation.diff, evidenceRefs: change.evidenceRefs,
              undo: simulation.inverses.length && simulation.results.every(item => !['task.create', 'inbox.convert-task', 'inbox.keep'].includes(item.type))
                ? { expiresAt: at + ledger.DETAILS_TTL_MS, operations: simulation.inverses,
                  expectedPostVersions: [...new Map(simulation.results.flatMap(item => item.afterVersions)
                    .map(ref => [`${ref.kind}:${ref.id}`, ref])).values()] } : null },
            detailsRedacted: false, eventIds: []
          };
          const events = buildEvents({ receipt: structuredClone(receipt), changeSet: change,
            occurredAt: at, ...eventCalendar(at, getTimezone()) });
          if (!Array.isArray(events) || events.length === 0) return fail('change-events-unavailable');
          receipt.eventIds = events.map(event => event.id);
          const appended = ledger.appendReceipt(state.aiCollaboration, { receipt, events, now: at });
          if (!appended.ok) return fail(appended.reason || appended.code || 'change-ledger-unavailable');
          let nextLedger = appended.ledger;
          if (change.revertsReceiptId) {
            const marked = ledger.markReverted(nextLedger, { receiptId: change.revertsReceiptId,
              revertedByReceiptId: receipt.receiptId });
            if (!marked.ok) return fail(marked.reason || marked.code || 'change-undo-unavailable');
            nextLedger = marked.ledger;
          }
          for (const field of BUSINESS_WRITES) state[field] = simulation.state[field];
          state.aiCollaboration = nextLedger;
          if (!isDeepStrictEqual(normalizeState(state, { now: at }), state)) return fail('change-normalization-drift');
          return { ok: true, receiptId: receipt.receiptId, receipt };
        } });
    } catch (error) {
      const recovered = lookup(identity);
      const reason = ['receipt-capacity', 'outbox-capacity', 'ledger-capacity', 'commit-sequence-exhausted'].includes(error?.code)
        ? error.code : 'change-commit-failed';
      if (!recovered.ok || !recovered.receipt) {
        if (error?.code === 'config-commit-outcome-unknown') return { ok: false, reason: 'change-commit-outcome-unknown',
          retrySameIdentity: true, outcome: 'unknown' };
        return recovered.retrySameIdentity ? recovered : fail(reason);
      }
      const verified = response(recovered.receipt, true);
      if (!verified.ok) return verified;
      runPostCommitEffect(publish, { type: change.revertsReceiptId ? 'ai-change-reverted' : 'ai-change-applied',
        receiptId: recovered.receipt.receiptId, commandId: recovered.receipt.commandId,
        revision: recovered.receipt.appliedRevision }, reportEffectError);
      return response(recovered.receipt, true);
    }
    if (!transaction.ok) return fail(transaction.reason);
    const verified = response(transaction.receipt, false, transaction.state);
    if (!verified.ok) return verified;
    runPostCommitEffect(publish, { type: change.revertsReceiptId ? 'ai-change-reverted' : 'ai-change-applied',
      receiptId: transaction.receipt.receiptId, commandId: transaction.receipt.commandId,
      revision: transaction.revision }, reportEffectError);
    return response(transaction.receipt, false, transaction.state);
  }
  return Object.freeze({ execute, lookup, response });
}
module.exports = { APPLY_AI_CHANGE_SET_WRITES, createApplyChangeSetWorkflow, identityOf, eventCalendar };
