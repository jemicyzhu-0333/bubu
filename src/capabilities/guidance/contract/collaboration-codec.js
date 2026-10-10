'use strict';
const { createCapabilityCodec } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');

function object(validation, keys) {
  const value = validation.requireObject();
  if (value) validation.rejectUnknown(value, keys);
  return value;
}
function conversationId(validation, value) { return validation.validateId(value.conversationId, 'conversationId'); }
function messageIdentity(validation, value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value)) validation.fail('messageId is invalid');
  return value;
}
function choice(validation, value, allowed, field, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) validation.fail(`${field} is invalid`);
  return value;
}
function boundedText(validation, value, field, maximum, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || [...value].length > maximum || (!optional && !value.trim())) {
    validation.fail(`${field} is invalid`); return '';
  }
  return value;
}
const codec = createCapabilityCodec({
  'ai:conversation-start': validation => {
    const value = object(validation, ['purpose', 'mode', 'taskId', 'retentionMode']);
    if (!value) return;
    return { purpose: choice(validation, value.purpose, ['task', 'stuck', 'planning', 'review'], 'purpose', 'task'),
      mode: choice(validation, value.mode, ['talk', 'small-step', 'plan'], 'mode', 'talk'),
      taskId: value.taskId ? validation.validateId(value.taskId, 'taskId') : null,
      retentionMode: choice(validation, value.retentionMode, ['ephemeral', 'saved'], 'retentionMode', 'ephemeral') };
  },
  'ai:conversation-list': validation => {
    const value = object(validation, ['cursor']);
    if (!value) return;
    return { cursor: value.cursor == null ? null : boundedText(validation, value.cursor, 'cursor', 300) };
  },
  'ai:conversation-open': validation => {
    const value = object(validation, ['conversationId']);
    return value ? { conversationId: conversationId(validation, value) } : undefined;
  },
  'ai:conversation-proposal-status': validation => {
    const value = object(validation, ['conversationId', 'proposalIds']);
    if (!value) return;
    if (!Array.isArray(value.proposalIds) || value.proposalIds.length > 50
      || new Set(value.proposalIds).size !== value.proposalIds.length) {
      validation.fail('proposalIds must be a unique array of at most 50 IDs'); return;
    }
    return { conversationId: conversationId(validation, value),
      proposalIds: value.proposalIds.map(id => validation.validateId(id, 'proposalId')) };
  },
  'ai:conversation-scope': validation => {
    const value = object(validation, ['conversationId', 'focusSummary', 'taskIds', 'inboxIds', 'routineIds', 'memoryIds', 'planningPreferences']);
    if (!value) return;
    if (typeof value.focusSummary !== 'boolean') validation.fail('focusSummary must be boolean');
    const selected = {};
    if (value.planningPreferences !== undefined && typeof value.planningPreferences !== 'boolean') validation.fail('planningPreferences must be boolean');
    if (value.planningPreferences !== undefined) selected.planningPreferences = value.planningPreferences;
    for (const key of ['taskIds', 'inboxIds', 'routineIds', 'memoryIds']) {
      if (value[key] === undefined) continue;
      if (!Array.isArray(value[key]) || value[key].length > (key === 'memoryIds' ? 8 : 50) || new Set(value[key]).size !== value[key].length) {
        validation.fail(`${key} is invalid`); continue;
      }
      selected[key] = value[key].map(entry => validation.validateId(entry, key));
    }
    return { conversationId: conversationId(validation, value), focusSummary: value.focusSummary, ...selected };
  },
  'ai:conversation-mode': validation => {
    const value = object(validation, ['conversationId', 'mode']);
    return value ? { conversationId: conversationId(validation, value),
      mode: choice(validation, value.mode, ['talk', 'small-step', 'plan'], 'mode') } : undefined;
  },
  'ai:conversation-turn': validation => {
    const value = object(validation, ['conversationId', 'scopeGrantId', 'message', 'messageId', 'selectedProposalId']);
    return value ? { conversationId: conversationId(validation, value),
      scopeGrantId: validation.validateId(value.scopeGrantId, 'scopeGrantId'),
      message: boundedText(validation, value.message, 'message', 8000),
      ...(value.messageId !== undefined ? { messageId: messageIdentity(validation, value.messageId) } : {}),
      ...(value.selectedProposalId !== undefined ? { selectedProposalId: value.selectedProposalId === null
        ? null : validation.validateId(value.selectedProposalId, 'selectedProposalId') } : {}) } : undefined;
  },
  'ai:conversation-pause': validation => {
    const value = object(validation, ['conversationId', 'inputDraft', 'selectedProposalId', 'scrollTop']);
    if (!value) return;
    if (value.scrollTop !== undefined && (!Number.isFinite(value.scrollTop) || value.scrollTop < 0 || value.scrollTop > 10000000)) {
      validation.fail('scrollTop is invalid');
    }
    return { conversationId: conversationId(validation, value),
      inputDraft: boundedText(validation, value.inputDraft, 'inputDraft', 64000, true),
      selectedProposalId: value.selectedProposalId ? validation.validateId(value.selectedProposalId, 'selectedProposalId') : null,
      scrollTop: value.scrollTop || 0 };
  },
  'ai:conversation-cancel': validation => {
    const value = object(validation, ['conversationId']);
    return value ? { conversationId: conversationId(validation, value) } : undefined;
  },
  'ai:conversation-retention': validation => {
    const value = object(validation, ['conversationId', 'mode', 'retentionDays', 'pinned', 'inputDraft', 'selectedProposalId', 'scrollTop']);
    if (!value) return;
    const retentionDays = value.retentionDays === undefined ? 30 : value.retentionDays;
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) validation.fail('retentionDays is invalid');
    if (value.pinned !== undefined && typeof value.pinned !== 'boolean') validation.fail('pinned is invalid');
    if (value.scrollTop !== undefined && (!Number.isFinite(value.scrollTop) || value.scrollTop < 0 || value.scrollTop > 10000000)) {
      validation.fail('scrollTop is invalid');
    }
    return { conversationId: conversationId(validation, value),
      mode: choice(validation, value.mode, ['ephemeral', 'saved'], 'mode'), retentionDays, pinned: value.pinned === true,
      ...(value.inputDraft !== undefined ? { inputDraft: boundedText(validation, value.inputDraft, 'inputDraft', 64000, true) } : {}),
      ...(value.selectedProposalId !== undefined ? { selectedProposalId: value.selectedProposalId === null
        ? null : validation.validateId(value.selectedProposalId, 'selectedProposalId') } : {}),
      ...(value.scrollTop !== undefined ? { scrollTop: value.scrollTop } : {}) };
  },
  'ai:conversation-delete': validation => {
    const value = object(validation, ['conversationId', 'expectedRevision']);
    if (!value) return;
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) validation.fail('expectedRevision is invalid');
    return { conversationId: conversationId(validation, value), expectedRevision: value.expectedRevision };
  }
});
const surfaces = Object.fromEntries(codec.channels.map(channel => [channel, ['popover']]));
const ipcRoutes = describeRoutes('guidance', codec, surfaces, ['ai:conversation-list', 'ai:conversation-open', 'ai:conversation-proposal-status']);
module.exports = { ipcRoutes };
