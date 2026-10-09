'use strict';

// ARCHITECTURE「日常与能量」: this layer expresses a chosen plan, never a report
// about the person. Its only write path is planningPreferences.
const { addDaysToKey, localDayKey, localDayStart } = require('../../../core/calendar');
const { id } = require('../../../core/ai-change-protocol');
const v = require('../contract/planning-state');
const UNDO_TTL = 7 * 86400000;
function scopeExpiry(scope, now) {
  if (scope === 'saved') return null;
  return localDayStart(addDaysToKey(localDayKey(now), scope === 'today' ? 1 : 7));
}
function preferenceInputValid(input) {
  return v.exact(input, ['id', 'startMinute', 'endMinute', 'demand', 'scope'])
    && (input.id === null || id(input.id)) && v.integer(input.startMinute, 0, 1439)
    && v.integer(input.endMinute, 1, 1440) && input.endMinute > input.startMinute
    && ['low', 'medium', 'high'].includes(input.demand) && v.SCOPES.includes(input.scope);
}
function previewPlanningPreference(state, { input, now, preferenceId } = {}) {
  if (!preferenceInputValid(input) || !v.timestamp(now) || !id(preferenceId)) return { ok: false, reason: 'planning-preference-invalid' };
  const store = state.planningPreferences;
  v.validatePlanningPreferences(store);
  if (store.receipts.length >= v.MAX_PLANNING_RECEIPTS) return { ok: false, reason: 'planning-receipts-full' };
  const before = input.id === null ? null : store.items.find(item => item.id === input.id);
  if (input.id !== null && !before) return { ok: false, reason: 'planning-preference-missing' };
  if (!before && store.items.length >= v.MAX_PREFERENCES) return { ok: false, reason: 'planning-preferences-full' };
  const after = { id: before?.id || preferenceId, version: (before?.version || 0) + 1,
    startMinute: input.startMinute, endMinute: input.endMinute, demand: input.demand, scope: input.scope,
    createdAt: before?.createdAt ?? now, updatedAt: now, expiresAt: scopeExpiry(input.scope, now), source: 'user-confirmed' };
  if (!before && (store.items.some(item => item.id === after.id) || store.receipts.some(receipt => receipt.preferenceId === after.id))) return { ok: false, reason: 'planning-preference-id-conflict' };
  return { ok: true, sourceVersion: store.version, before: before || null, after };
}
function confirmPlanningPreference(state, { preview, now, receiptId, origin = null } = {}) {
  const store = state.planningPreferences;
  v.validatePlanningPreferences(store);
  if (!preview?.ok || !id(receiptId) || !v.timestamp(now) || !v.preferenceValid(preview.after) || !v.preferenceOriginValid(origin)
    || now < preview.after.updatedAt || preview.after.expiresAt !== null && now >= preview.after.expiresAt) return { ok: false, reason: 'planning-preview-invalid' };
  if (store.receipts.length >= v.MAX_PLANNING_RECEIPTS) return { ok: false, reason: 'planning-receipts-full' };
  if (store.receipts.some(receipt => receipt.receiptId === receiptId)) return { ok: false, reason: 'planning-receipt-id-conflict' };
  if (origin && store.receipts.some(receipt => receipt.origin?.conversationId === origin.conversationId
    && receipt.origin.proposalId === origin.proposalId)) return { ok: false, reason: 'planning-proposal-already-reviewed' };
  if (store.version !== preview.sourceVersion) return { ok: false, reason: 'planning-preference-changed' };
  const actual = store.items.find(item => item.id === preview.after.id) || null;
  if (JSON.stringify(actual) !== JSON.stringify(preview.before)) return { ok: false, reason: 'planning-preference-changed' };
  const version = store.version + 1;
  const after = structuredClone(preview.after);
  const items = actual ? store.items.map(item => item.id === after.id ? after : item) : [...store.items, after];
  const receipt = { receiptId, preferenceId: after.id, beforeVersion: actual?.version ?? null, afterVersion: after.version,
    committedAt: now, origin: structuredClone(origin), revertedAt: null, revertedVersion: null };
  state.planningPreferences = { version, items, receipts: [...store.receipts, receipt], undo: { id: receiptId, appliedVersion: version,
    before: structuredClone(preview.before), after: structuredClone(after), expiresAt: now + UNDO_TTL } };
  return { ok: true, changed: true, version, receiptId, before: preview.before, after, receipt: structuredClone(receipt) };
}
function undoPlanningPreference(state, { receiptId, now, expectedVersion } = {}) {
  const store = state.planningPreferences;
  v.validatePlanningPreferences(store);
  const undo = store.undo;
  const receipt = store.receipts.find(value => value.receiptId === receiptId);
  if (!v.timestamp(now) || !undo || undo.id !== receiptId || now >= undo.expiresAt || !receipt || now < receipt.committedAt) return { ok: false, reason: 'planning-undo-unavailable' };
  if (expectedVersion !== store.version || undo.appliedVersion !== store.version) return { ok: false, reason: 'planning-preference-changed' };
  const restored = undo.before ? { ...structuredClone(undo.before), version: undo.after.version + 1, updatedAt: now } : null;
  const items = restored ? store.items.map(item => item.id === undo.after.id ? restored : item)
    : store.items.filter(item => item.id !== undo.after.id);
  const receipts = store.receipts.map(receipt => receipt.receiptId === receiptId
    ? { ...receipt, revertedAt: now, revertedVersion: restored?.version ?? null } : receipt);
  state.planningPreferences = { version: store.version + 1, items, undo: null, receipts };
  return { ok: true, changed: true, version: state.planningPreferences.version, receiptId };
}
function lookupPlanningPreferenceReceipt(state, { receiptId, origin, now } = {}) {
  const byReceipt = id(receiptId) && origin === undefined;
  const byOrigin = receiptId === undefined && origin !== null && v.preferenceOriginValid(origin);
  if ((!byReceipt && !byOrigin) || !v.timestamp(now)) return { ok: false, reason: 'planning-receipt-query-invalid' };
  const store = state.planningPreferences;
  v.validatePlanningPreferences(store);
  const receipt = store.receipts.find(item => byReceipt ? item.receiptId === receiptId
    : item.origin?.conversationId === origin.conversationId && item.origin.proposalId === origin.proposalId);
  if (!receipt) return { ok: false, reason: 'planning-receipt-not-found' };
  const item = store.items.find(value => value.id === receipt.preferenceId);
  const current = receipt.revertedAt === null && item?.version === receipt.afterVersion;
  const undo = store.undo;
  return { ok: true, receipt: structuredClone(receipt), status: receipt.revertedAt === null ? 'applied' : 'reverted',
    currentVersion: item?.version ?? null, current: Boolean(current), active: Boolean(current && item.updatedAt <= now && (item.expiresAt === null || now < item.expiresAt)),
    storeVersion: store.version, undo: undo?.id === receipt.receiptId && now < undo.expiresAt
      ? { receiptId: undo.id, expectedVersion: undo.appliedVersion, expiresAt: undo.expiresAt } : null };
}
function planningPreferencesAt(state, now) {
  if (!v.timestamp(now)) return [];
  return structuredClone((state.planningPreferences?.items || [])
    .filter(item => item.updatedAt <= now && (item.expiresAt === null || now < item.expiresAt)));
}
module.exports = { scopeExpiry, preferenceInputValid, previewPlanningPreference, confirmPlanningPreference,
  undoPlanningPreference, planningPreferencesAt, lookupPlanningPreferenceReceipt };
