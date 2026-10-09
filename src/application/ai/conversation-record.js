'use strict';

const { unicodeLength, serializedBytes, COLLABORATION_BUDGET } = require('./run-budget');
const { validatePlanningPreferenceCandidate } = require('../../core/ai-personalization-protocol');
const { validateMemoryProposal } = require('../../core/ai-memory-protocol');

const SNAPSHOT_VERSION = 1;
const MAX_INPUT_DRAFT_CHARS = 64000;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const SOURCE_KINDS = Object.freeze(['task', 'inbox', 'routine', 'planning-preference', 'memory', 'timeline', 'activity', 'energy', 'message']);
const PURPOSES = Object.freeze(['task', 'stuck', 'planning', 'review']);
const MODES = Object.freeze(['talk', 'small-step', 'plan']);
const STATUSES = Object.freeze(['idle', 'generating', 'responding', 'awaiting-confirmation', 'canceled', 'paused', 'failed']);

function closed(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value); }
function time(value) { return Number.isSafeInteger(value) && value >= 0; }
function text(value, max, empty = true) {
  return typeof value === 'string' && (empty || value.trim().length > 0) && unicodeLength(value) <= max;
}
function sourceRefsValid(refs) {
  return Array.isArray(refs) && refs.length <= 50 && refs.every(ref => (
    closed(ref, ['kind', 'id', 'revision']) && SOURCE_KINDS.includes(ref.kind) && id(ref.id)
    && (ref.revision === null || text(ref.revision, 200, false))
  ));
}
function proposalValid(proposal) {
  if (proposal === null) return true;
  if (!closed(proposal, ['id', 'version', 'kind', 'body']) || !id(proposal.id)
      || !Number.isSafeInteger(proposal.version) || proposal.version < 1
      || !['task-draft', 'change-set', 'memory-candidate', 'planning-preference-candidate'].includes(proposal.kind) || typeof proposal.body !== 'string'
      || Buffer.byteLength(proposal.body, 'utf8') > 64 * 1024) return false;
  try {
    const body = JSON.parse(proposal.body);
    if (proposal.kind === 'memory-candidate') validateMemoryProposal(body);
    if (proposal.kind === 'planning-preference-candidate') {
      if (!closed(body, ['planningPreference'])) return false;
      validatePlanningPreferenceCandidate(body.planningPreference);
    }
    return body !== null && typeof body === 'object' && !Array.isArray(body);
  }
  catch (_) { return false; }
}
function provenanceValid(provenance) {
  return provenance === null || (closed(provenance, ['source', 'reason', 'providerId'])
    && ['provider', 'local'].includes(provenance.source)
    && (provenance.reason === null || (typeof provenance.reason === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(provenance.reason)))
    && (provenance.source === 'local' ? provenance.providerId === null : id(provenance.providerId)));
}
function relatedEntityValid(entity) {
  return entity === null || (closed(entity, ['kind', 'id', 'version'])
    && ['task', 'inbox'].includes(entity.kind) && id(entity.id)
    && (entity.version === null || text(entity.version, 200, false)));
}
function retentionValid(retention) {
  return closed(retention, ['mode', 'days', 'pinned']) && ['ephemeral', 'saved'].includes(retention.mode)
    && Number.isSafeInteger(retention.days) && retention.days >= 1 && retention.days <= 3650
    && typeof retention.pinned === 'boolean';
}
function messageValid(message, index) {
  return closed(message, ['id', 'role', 'sequence', 'content', 'proposal', 'requestId', 'turnId',
    'segment', 'createdAt', 'sourceRefs', 'contextAllowed', 'provenance'])
    && id(message.id) && ['user', 'assistant', 'context'].includes(message.role)
    && message.sequence === index + 1 && text(message.content, COLLABORATION_BUDGET.maxOutputChars)
    && (message.content.trim().length > 0 || (message.role === 'assistant' && message.proposal !== null))
    && proposalValid(message.proposal) && (message.proposal === null || message.role === 'assistant')
    && id(message.requestId) && id(message.turnId) && time(message.segment) && time(message.createdAt)
    && sourceRefsValid(message.sourceRefs) && (message.role !== 'user' || message.sourceRefs.length === 0) && typeof message.contextAllowed === 'boolean'
    && provenanceValid(message.provenance) && (message.role === 'assistant' || message.provenance === null);
}
function summaryValid(summary, messageIds) {
  return closed(summary, ['id', 'segment', 'throughMessageId', 'coveredMessageIds', 'decisions',
    'unresolvedQuestions', 'sourceRefs', 'text', 'contextAllowed'])
    && id(summary.id) && time(summary.segment) && messageIds.has(summary.throughMessageId)
    && Array.isArray(summary.coveredMessageIds) && summary.coveredMessageIds.length > 0
    && summary.coveredMessageIds.length <= 201
    && new Set(summary.coveredMessageIds).size === summary.coveredMessageIds.length
    && summary.coveredMessageIds.every(value => messageIds.has(value))
    && summary.coveredMessageIds.at(-1) === summary.throughMessageId
    && [summary.decisions, summary.unresolvedQuestions].every(items => Array.isArray(items)
      && items.length <= 10 && items.every(item => closed(item, ['messageId', 'text'])
        && messageIds.has(item.messageId) && text(item.text, 500)))
    && sourceRefsValid(summary.sourceRefs) && text(summary.text, 4000)
    && typeof summary.contextAllowed === 'boolean';
}

function historyStructureValid(snapshot) {
  const segments = new Map();
  const turns = new Set();
  const requests = new Set();
  const answered = new Set();
  let currentSegment = 0;
  let previousAt = snapshot.createdAt;
  let latestUser = null;
  for (const message of snapshot.messages) {
    if (message.createdAt < previousAt || message.createdAt > snapshot.updatedAt
      || message.segment < currentSegment || message.segment > currentSegment + 1) return false;
    if (!segments.size && message.segment !== 0) return false;
    previousAt = message.createdAt;
    currentSegment = message.segment;
    const segment = segments.get(message.segment) || { turns: 0, bytes: 0, ids: [] };
    segment.bytes += serializedBytes(message);
    segment.ids.push(message.id);
    if (message.role === 'user') {
      if (turns.has(message.turnId) || requests.has(message.requestId)) return false;
      turns.add(message.turnId); requests.add(message.requestId);
      latestUser = message;
      segment.turns += 1;
    } else if (message.role === 'assistant') {
      if (!latestUser || latestUser.turnId !== message.turnId || latestUser.requestId !== message.requestId
        || answered.has(message.turnId)) return false;
      answered.add(message.turnId);
    }
    if (segment.turns > COLLABORATION_BUDGET.maxSegmentTurns || segment.bytes > COLLABORATION_BUDGET.maxSegmentBytes) return false;
    segments.set(message.segment, segment);
  }
  if (currentSegment !== snapshot.segment.index || snapshot.summaries.length !== snapshot.segment.index) return false;
  const summarySegments = new Set();
  const identities = new Set([snapshot.id, ...snapshot.messages.map(message => message.id)]);
  for (const summary of snapshot.summaries) {
    if (identities.has(summary.id) || summarySegments.has(summary.segment)
      || summary.segment >= snapshot.segment.index
      || JSON.stringify(segments.get(summary.segment)?.ids) !== JSON.stringify(summary.coveredMessageIds)) return false;
    identities.add(summary.id); summarySegments.add(summary.segment);
  }
  return true;
}

// The repository validates the complete candidate before its single CAS write.
// Runtime grants/controllers are intentionally absent from this storage contract.
function validateConversationSnapshot(snapshot) {
  try {
    if (!closed(snapshot, ['version', 'id', 'ownerId', 'revision', 'purpose', 'mode', 'relatedEntity',
      'createdAt', 'updatedAt', 'status', 'retention', 'messages', 'summaries', 'inputDraft',
      'selectedProposalId', 'scrollTop', 'segment', 'softNoticeShown']) || snapshot.version !== SNAPSHOT_VERSION
      || !id(snapshot.id) || !id(snapshot.ownerId) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
      || !PURPOSES.includes(snapshot.purpose) || !MODES.includes(snapshot.mode) || !relatedEntityValid(snapshot.relatedEntity)
      || !time(snapshot.createdAt) || !time(snapshot.updatedAt) || snapshot.updatedAt < snapshot.createdAt
      || !STATUSES.includes(snapshot.status) || !retentionValid(snapshot.retention)
      || !text(snapshot.inputDraft, MAX_INPUT_DRAFT_CHARS)
      || !Number.isFinite(snapshot.scrollTop) || snapshot.scrollTop < 0 || snapshot.scrollTop > 1e7
      || typeof snapshot.softNoticeShown !== 'boolean' || !Array.isArray(snapshot.messages)
      || snapshot.messages.length > 100000 || !snapshot.messages.every(messageValid)) return false;
    const messageIds = new Set(snapshot.messages.map(message => message.id));
    if (messageIds.size !== snapshot.messages.length || !Array.isArray(snapshot.summaries)
      || snapshot.summaries.length > 1000 || !snapshot.summaries.every(summary => summaryValid(summary, messageIds))) return false;
    if (snapshot.selectedProposalId !== null && !snapshot.messages.some(message => message.proposal?.id === snapshot.selectedProposalId)) return false;
    if (!closed(snapshot.segment, ['index', 'turns', 'bytes']) || !time(snapshot.segment.index)
      || !time(snapshot.segment.turns) || snapshot.segment.turns > COLLABORATION_BUDGET.maxSegmentTurns
      || !time(snapshot.segment.bytes) || snapshot.segment.bytes > COLLABORATION_BUDGET.maxSegmentBytes) return false;
    const current = snapshot.messages.filter(message => message.segment === snapshot.segment.index);
    if (snapshot.messages.some(message => message.segment > snapshot.segment.index)
      || current.filter(message => message.role === 'user').length !== snapshot.segment.turns
      || current.reduce((sum, message) => sum + serializedBytes(message), 0) !== snapshot.segment.bytes) return false;
    return historyStructureValid(snapshot) && serializedBytes(snapshot) <= MAX_SNAPSHOT_BYTES;
  } catch (_) { return false; }
}
// A snapshot replacement may append history or invalidate derived context; it
// cannot quietly rewrite an earlier message or turn withdrawn context back on.
function isConversationSuccessor(previous, next) {
  if (previous.id !== next.id || previous.ownerId !== next.ownerId || previous.createdAt !== next.createdAt
    || previous.purpose !== next.purpose || JSON.stringify(previous.relatedEntity) !== JSON.stringify(next.relatedEntity)
    || previous.updatedAt > next.updatedAt || previous.messages.length > next.messages.length) return false;
  return previous.messages.every((message, index) => {
    const candidate = next.messages[index];
    if (!candidate || (!message.contextAllowed && candidate.contextAllowed)) return false;
    const before = { ...message, contextAllowed: true };
    const after = { ...candidate, contextAllowed: true };
    return JSON.stringify(before) === JSON.stringify(after);
  });
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function mergeSourceRefs(groups) {
  const refs = new Map();
  for (const group of groups) for (const ref of group) refs.set(JSON.stringify(ref), ref);
  return [...refs.values()];
}

module.exports = { SNAPSHOT_VERSION, MAX_INPUT_DRAFT_CHARS, MAX_SNAPSHOT_BYTES, PURPOSES, MODES, id, time, text,
  sourceRefsValid, proposalValid, provenanceValid, relatedEntityValid, retentionValid, validateConversationSnapshot, isConversationSuccessor,
  clone, immutable, mergeSourceRefs };
