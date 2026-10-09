'use strict';

const { COLLABORATION_TASK, validateTaskDraft } = require('../../core/llm/contracts');
const { buildBoundedContext, normalizeRunBudget, serializedBytes } = require('./run-budget');
const { deriveConversationSummary } = require('./conversation-summary');
const { mergeSourceRefs } = require('./conversation-record');

function projectMessage(message) {
  return { id: message.id, role: message.role, content: message.content,
    proposal: message.proposal, sourceRefs: message.sourceRefs.filter(ref => ref.kind !== 'message'), contextAllowed: message.contextAllowed };
}
function availableReads(grant) {
  return grant ? { tools: [...grant.selection.tools], taskIds: [...grant.selection.taskIds], inboxIds: [...grant.selection.inboxIds],
    routineIds: [...(grant.selection.routineIds || [])], memoryIds: [...(grant.selection.memoryIds || [])],
    planningPreferences: grant.selection.planningPreferences === true,
    fromDay: grant.selection.fromDay, toDay: grant.selection.toDay }
    : { tools: [], taskIds: [], inboxIds: [], routineIds: [], memoryIds: [], planningPreferences: false, fromDay: null, toDay: null };
}
function buildCollaborationContext({ conversation, grant, data, limits, isContextMessageAllowed, latestUserId }) {
  const currentUserId = latestUserId || (conversation.messages.at(-1)?.role === 'user' ? conversation.messages.at(-1).id : null);
  const allowedMessage = message => {
    if (message.id === currentUserId && message.role === 'user') return true;
    if (typeof isContextMessageAllowed !== 'function') return true;
    try { return isContextMessageAllowed(message) === true; } catch (_) { return false; }
  };
  const freshSources = new Set(data.flatMap(read => read.sourceRefs || []).map(ref => JSON.stringify(ref)));
  const eligible = [], blocked = new Set(), seen = new Set();
  for (const message of conversation.messages) {
    const allowed = message.contextAllowed !== false && allowedMessage(message)
      && message.sourceRefs.every(ref => ref.kind === 'message'
        ? seen.has(ref.id) && !blocked.has(ref.id) : freshSources.has(JSON.stringify(ref)));
    seen.add(message.id);
    if (allowed) eligible.push(message); else blocked.add(message.id);
  }
  const earlier = eligible.slice(0, -12);
  const summaryMessages = earlier.slice(-6);
  const summarySelection = earlier.find(message => message.proposal?.id === conversation.selectedProposalId);
  if (summarySelection && !summaryMessages.includes(summarySelection)) summaryMessages.push(summarySelection);
  let summary = earlier.length ? deriveConversationSummary({ messages: earlier,
    selectedProposalId: conversation.selectedProposalId, id: 'rolling-context', segment: conversation.segment.index }) : null;
  if (summary) summary = { trust: 'untrusted-data', text: summary.text,
    throughMessageId: summary.throughMessageId, decisions: summary.decisions,
    unresolvedQuestions: summary.unresolvedQuestions, sourceRefs: mergeSourceRefs(summaryMessages.map(message => message.sourceRefs.filter(ref => ref.kind !== 'message'))) };
  // Keep the active draft available after many ordinary answers, without
  // resending the entire transcript. Canonical messages are never removed.
  const selected = eligible.find(message => message.proposal?.id === conversation.selectedProposalId)
    || (conversation.selectedProposalId ? null : eligible.findLast(message => message.proposal));
  if (selected) {
    summary = { ...summary, trust: 'untrusted-data', selectedDraft: selected.proposal, sourceRefs: mergeSourceRefs([
      summary?.sourceRefs || [], selected.sourceRefs.filter(ref => ref.kind !== 'message')]) };
  }
  const tools = availableReads(grant);
  const overhead = serializedBytes({ mode: conversation.mode, context: { trust: 'untrusted-data' }, availableReads: tools });
  if (limits.maxContextBytes <= overhead) return { ok: false, reason: 'context-budget' };
  const bounded = buildBoundedContext({ messages: eligible.slice(-12).map(projectMessage), summary, data,
    limits: normalizeRunBudget({ ...limits, maxContextBytes: limits.maxContextBytes - overhead }) });
  if (!bounded.ok) return bounded;
  const payload = COLLABORATION_TASK.buildInput({ mode: conversation.mode, context: bounded.context, availableReads: tools });
  const sourceRefs = mergeSourceRefs([payload.context.summary?.sourceRefs || [],
    ...payload.context.messages.map(message => message.sourceRefs || []), ...data.map(read => read.sourceRefs || [])]);
  const messageIds = [...new Set([...payload.context.messages.map(message => message.id),
    ...(payload.context.summary ? summaryMessages.map(message => message.id) : []), ...(selected ? [selected.id] : [])])];
  const messageRefs = messageIds.map(id => ({ kind: 'message', id, revision: null }));
  if (sourceRefs.length + messageRefs.length > 50) return { ok: false, reason: 'context-source-budget' };
  const bytes = serializedBytes(payload);
  if (bytes > limits.maxContextBytes) return { ok: false, reason: 'context-budget' };
  return { ok: true, payload, sourceRefs, messageRefs, bytes,
    coverage: { ...bounded.coverage, total: conversation.messages.length,
      omitted: conversation.messages.length - bounded.context.messages.length } };
}
function localCollaborationReply({ mode, message }) {
  // A narrow response to explicit present danger, not a stored assessment or
  // automatic risk label. Offline help must not turn this into a task draft.
  const explicitDanger = /(?:我(?:现在)?(?:想|要|准备|打算|计划)(?:自杀|伤害自己|结束生命)|I (?:want|plan|am going) to (?:kill myself|hurt myself|end my life)|I want to die)/i;
  if (explicitDanger.test(message)) return { type: 'answer',
    answer: /[\u3400-\u9fff]/.test(message)
      ? '先把任务放下。如果你现在可能伤害自己，可以先去有人陪伴的地方，远离可能伤害自己的物品，联系身边信任的人或当地紧急服务。你现在身边有人吗？'
      : 'We can leave the task aside. If you might hurt yourself now, move near another person and away from anything you could use to hurt yourself, and contact someone you trust or local emergency services. Is someone with you?',
    readRequest: null, changeProposal: null };
  if (mode === 'talk') return { type: 'answer', answer: '可以先把想说的留在这里，不必马上整理成任务。你更想说说哪里难受，还是找一个很小的下一步？',
    readRequest: null, changeProposal: null };
  const title = [...message.trim()].slice(0, 100).join('');
  const proposal = validateTaskDraft({ title,
    steps: [{ title: '写下一个两分钟内能开始的动作', dependsOn: null, safeStopAfter: true }],
    estimateMinutes: 2, energy: null, notes: '本地小办法，可直接改写；尚未保存为任务。' });
  return { type: 'changeProposal', answer: '本地小办法：先写下一个看得见的下一动作。可以修改这份草稿，也可以继续聊。',
    readRequest: null, changeProposal: proposal };
}

module.exports = { buildCollaborationContext, localCollaborationReply };
