'use strict';

// ARCHITECTURE「AI 与 LLM」: grants are created only by the trusted application
// route. Model output may ask for reads but cannot create, widen or renew one.
const { COLLABORATION_TASK } = require('../../core/llm/contracts');
const TOOL_NAMES = Object.freeze(['task.read', 'task.search', 'activity.distribution',
  'inbox.search', 'routine.search', 'memory.search', 'planning.preferences.read', 'energy.read', 'timeline.query']);
const PURPOSES = Object.freeze(['task', 'stuck', 'planning', 'review']);
const GRANT_TTL_MS = 30 * 60 * 1000;
const MAX_SCOPE_IDS = 50;
const MAX_MEMORY_IDS = 8;
const { MAX_CURSOR_OFFSET, cursorOffset } = require('../../core/ai-read-cursor');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/;

function dayNumber(value) {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.getTime() / 86400000 : null;
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}
function ids(value) {
  return Array.isArray(value) && value.length <= MAX_SCOPE_IDS
    && value.every(id => typeof id === 'string' && ID.test(id))
    && new Set(value).size === value.length;
}
function validRange(fromDay, toDay, maxDays = 30) {
  const from = dayNumber(fromDay), to = dayNumber(toDay);
  return from !== null && to !== null && to >= from && to - from < maxDays;
}

function validateSelection(selection) {
  if (!exactKeys(selection, ['tools', 'taskIds', 'inboxIds', 'routineIds', 'memoryIds', 'planningPreferences', 'fromDay', 'toDay'])) {
    return { ok: false, reason: 'scope-fields-invalid' };
  }
  if (!Array.isArray(selection.tools) || selection.tools.length > TOOL_NAMES.length
      || selection.tools.some(name => !TOOL_NAMES.includes(name))
      || new Set(selection.tools).size !== selection.tools.length) {
    return { ok: false, reason: 'scope-tools-invalid' };
  }
  for (const field of ['taskIds', 'inboxIds', 'routineIds', 'memoryIds']) {
    if (!ids(selection[field] === undefined ? [] : selection[field])) return { ok: false, reason: 'scope-ids-invalid' };
  }
  if ((selection.memoryIds || []).length > MAX_MEMORY_IDS) return { ok: false, reason: 'memory-selection-budget' };
  if (selection.planningPreferences !== undefined && typeof selection.planningPreferences !== 'boolean') return { ok: false, reason: 'scope-fields-invalid' };
  if (!validRange(selection.fromDay, selection.toDay)) return { ok: false, reason: 'scope-date-range-invalid' };
  return { ok: true, selection: { tools: [...selection.tools], taskIds: [...(selection.taskIds || [])],
    inboxIds: [...(selection.inboxIds || [])], routineIds: [...(selection.routineIds || [])], memoryIds: [...(selection.memoryIds || [])],
    planningPreferences: selection.planningPreferences === true, fromDay: selection.fromDay, toDay: selection.toDay } };
}

function createContextGrants({ ownerId, now, idFactory, admission } = {}) {
  if (!ID.test(ownerId || '') || typeof now !== 'function' || typeof idFactory !== 'function') {
    throw new TypeError('scope-grant-ports-invalid');
  }
  const grants = new Map();
  function issue({ conversationId, purpose, providerId, authorizationGeneration, selection, admissionTicket } = {}) {
    const ticket = admissionTicket === undefined ? admission?.captureAdmission() : admissionTicket;
    const current = () => !admission || admission.isAdmissionCurrent(ticket);
    if (!current()) return { ok: false, reason: 'authorization-busy' };
    if (!ID.test(conversationId || '') || !PURPOSES.includes(purpose)
        || typeof providerId !== 'string' || !providerId || providerId.length > 2048
        || !Number.isSafeInteger(authorizationGeneration) || authorizationGeneration < 0) {
      return { ok: false, reason: 'scope-context-invalid' };
    }
    const parsed = validateSelection(selection);
    if (!parsed.ok) return parsed;
    const at = now();
    if (!current()) return { ok: false, reason: 'authorization-changed' };
    const id = idFactory('grant');
    if (!current()) return { ok: false, reason: 'authorization-changed' };
    if (!Number.isFinite(at) || !ID.test(id) || grants.has(id)) return { ok: false, reason: 'scope-identity-invalid' };
    const grant = Object.freeze({ id, ownerId, conversationId, purpose, providerId, authorizationGeneration,
      createdAt: at, expiresAt: at + GRANT_TTL_MS, selection: Object.freeze({ ...parsed.selection,
        tools: Object.freeze(parsed.selection.tools), taskIds: Object.freeze(parsed.selection.taskIds),
        inboxIds: Object.freeze(parsed.selection.inboxIds), routineIds: Object.freeze(parsed.selection.routineIds), memoryIds: Object.freeze(parsed.selection.memoryIds) }) });
    // A fresh selection supersedes the previous grant, so narrow selections
    // cannot be bypassed by retaining the old id.
    for (const [key, prior] of grants) {
      if (prior.conversationId === conversationId || prior.expiresAt <= at) grants.delete(key);
    }
    grants.set(id, grant);
    return { ok: true, grant: structuredClone(grant) };
  }
  function resolve({ scopeGrantId, conversationId, providerId, authorizationGeneration } = {}) {
    if (admission && !admission.isReadable()) return { ok: false, reason: 'scope-grant-invalid' };
    const grant = grants.get(scopeGrantId);
    const at = now();
    // The clock is an injected port: it may retire or replace this membership.
    if ((admission && !admission.isReadable()) || !Number.isFinite(at) || !grant || grants.get(scopeGrantId) !== grant
        || grant.ownerId !== ownerId || grant.conversationId !== conversationId
        || grant.providerId !== providerId || grant.authorizationGeneration !== authorizationGeneration
        || at < grant.createdAt || grant.expiresAt <= at) return { ok: false, reason: 'scope-grant-invalid' };
    return { ok: true, grant };
  }
  function revoke(conversationId) {
    for (const [id, grant] of grants) if (grant.conversationId === conversationId) grants.delete(id);
  }
  return Object.freeze({ issue, resolve, revoke, clear: () => grants.clear() });
}

function authorizeRead(grant, request) {
  if (!exactKeys(request, ['name', 'args']) || !TOOL_NAMES.includes(request.name)
      || !grant.selection.tools.includes(request.name)) return { ok: false, reason: 'tool-not-authorized' };
  const args = request.args;
  const perToolKeys = {
    'task.read': ['id', 'fields'], 'task.search': ['query', 'fields', 'limit', 'cursor'],
    'inbox.search': ['query', 'limit', 'cursor'], 'routine.search': ['query', 'limit', 'cursor'], 'memory.search': ['query', 'limit', 'cursor'],
    'activity.distribution': ['fromDay', 'toDay'], 'energy.read': [], 'planning.preferences.read': [],
    'timeline.query': ['fromDay', 'toDay', 'kinds', 'limit', 'cursor']
  };
  if (!exactKeys(args, perToolKeys[request.name])) return { ok: false, reason: 'tool-args-invalid' };
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) {
    return { ok: false, reason: 'tool-limit-invalid' };
  }
  if (args.query !== undefined && (typeof args.query !== 'string' || [...args.query].length > 200)) {
    return { ok: false, reason: 'tool-query-invalid' };
  }
  if (cursorOffset(args.cursor) === null) {
    return { ok: false, reason: 'tool-cursor-invalid' };
  }
  try { COLLABORATION_TASK.validateReadRequest(request, { allowDefaults: true }); } catch (error) {
    const reason = error.message.match(/^collaboration-read-(fields|kinds|id|range|limit)-invalid$/)?.[1];
    return { ok: false, reason: ['fields', 'kinds', 'limit'].includes(reason) ? `tool-${reason}-invalid` : 'tool-args-invalid' };
  }
  if (request.name === 'task.read' && !grant.selection.taskIds.includes(args.id)) {
    return { ok: false, reason: 'tool-target-not-authorized' };
  }
  if (args.fromDay !== undefined || args.toDay !== undefined || ['activity.distribution', 'timeline.query'].includes(request.name)) {
    if (!validRange(args.fromDay, args.toDay) || args.fromDay < grant.selection.fromDay
        || args.toDay > grant.selection.toDay) return { ok: false, reason: 'tool-date-range-not-authorized' };
  }
  return { ok: true };
}

function selectedContextRequests(grant) {
  const selection = grant.selection, requests = [];
  if (selection.taskIds.length && selection.tools.includes('task.search')) {
    requests.push({ name: 'task.search', args: { limit: MAX_SCOPE_IDS } });
  } else if (selection.tools.includes('task.read')) {
    for (const id of selection.taskIds) requests.push({ name: 'task.read', args: { id } });
  }
  for (const [field, name] of [['inboxIds', 'inbox.search'], ['routineIds', 'routine.search']]) {
    if (selection[field]?.length && selection.tools.includes(name)) requests.push({ name, args: { limit: MAX_SCOPE_IDS } });
  }
  if (selection.memoryIds?.length && selection.tools.includes('memory.search')) {
    requests.push({ name: 'memory.search', args: { limit: MAX_MEMORY_IDS } });
  }
  if (selection.planningPreferences && selection.tools.includes('planning.preferences.read')) {
    requests.push({ name: 'planning.preferences.read', args: {} });
  }
  if (selection.tools.includes('activity.distribution')) requests.push({ name: 'activity.distribution',
    args: { fromDay: selection.fromDay, toDay: selection.toDay } });
  return requests;
}

module.exports = { TOOL_NAMES, PURPOSES, GRANT_TTL_MS, MAX_SCOPE_IDS, MAX_MEMORY_IDS, dayNumber, validRange,
  exactKeys, selectedContextRequests, validateSelection, createContextGrants, authorizeRead, cursorOffset, MAX_CURSOR_OFFSET };
