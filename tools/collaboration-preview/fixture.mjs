import { createPopoverDraftConversation } from '../../src/surfaces/popover/features/draft-conversation.mjs';
import { installSyntheticChanges } from './change-fixture.mjs';
import { installSyntheticProposalStatuses } from './proposal-status-fixture.mjs';

// Deterministic synthetic records. No Electron bridge, network or persistence.
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const messages = [];
for (let i = 1; i <= 31; i += 1) {
  messages.push({ id: `u${i}`, role: 'user', sequence: messages.length + 1, content: i === 31 ? '先保留这一版，明天还能从这里继续吗？' : `第 ${i} 轮：报告的下一步再小一点。` });
  messages.push({ id: `a${i}`, role: 'assistant', sequence: messages.length + 1,
    content: '可以先只打开报告，把读者最需要知道的一件事写下来。', provenance: { source: 'provider', providerId: 'synthetic', reason: null },
    proposal: i % 5 === 0 ? { id: `p${i}`, version: i / 5, kind: 'task-draft', body: JSON.stringify({ title: '整理报告',
      steps: [{ title: '打开报告，写下一句读者需要知道的事实', dependsOn: null, safeStopAfter: true }],
      notes: '这个预览使用合成数据；没有调用模型或保存任务。', estimateMinutes: 5, energy: 'low' }) } : null });
}
let record = { id: 'synthetic-conversation', revision: 1, purpose: 'stuck', mode: 'small-step', relatedEntity: { kind: 'task', id: 'synthetic-task' },
  status: 'paused', retention: { mode: 'ephemeral', days: 30, pinned: false }, saveState: 'ephemeral', messages,
  inputDraft: '这一句还没发送，关闭再回来也保留。', selectedProposalId: 'p30', scrollTop: 999999 };
let focusSummary = false;
const response = () => ({ ok: true, conversation: structuredClone(record), scopeGrantId: 'synthetic-grant',
  disclosure: { fields: ['messages', 'task.title', ...(focusSummary ? ['recordedFocusMinutes'] : [])], focusSummary },
  contextPreview: [{ availability: 'available', items: [{ id: 'synthetic-task', title: '整理报告', steps: [{ title: '打开报告', done: false }] }], sourceRefs: [{ kind: 'task', id: 'synthetic-task' }] },
    ...(focusSummary ? [{ availability: 'available', items: [{ recordedFocusMinutes: 25, sessionCount: 1 }], coverage: '仅已记录片段；其他时段未知' }] : [])] });
const surfaceClient = {
  async startConversation() { return response(); }, async getConversation() { focusSummary = false; return response(); },
  async listConversations() { return { ok: true, items: [{ ...record, displayTitle: '合成示例：整理报告 · 31 轮' }], nextCursor: null }; },
  async setConversationScope(args) { focusSummary = args.focusSummary; return response(); },
  async setConversationMode(args) { record.mode = args.mode; return response(); },
  async setConversationRetention(args) {
    record.retention = { mode: args.mode, days: args.retentionDays || 30, pinned: args.pinned || false };
    record.saveState = args.mode === 'saved' ? 'unsaved' : 'ephemeral';
    return { ...response(), ok: args.mode !== 'saved', reason: 'save-failed' };
  },
  async pauseConversation(args) { Object.assign(record, args); return response(); }, async cancelConversation() { return response(); },
  async conversationTurn(args) {
    record.messages.push({ id: `u${record.messages.length}`, role: 'user', content: args.message, proposal: null });
    record.messages.push({ id: `a${record.messages.length}`, role: 'assistant', content: '这是合成预览回复，完整历史仍然保留。', proposal: null });
    return { ...response(), source: 'local', reason: 'synthetic-preview' };
  }
};
installSyntheticChanges({ surfaceClient, record, response });
installSyntheticProposalStatuses({ surfaceClient, record });
const feature = createPopoverDraftConversation({ document, $, escapeHTML, surfaceClient, fallbackReasonText: () => '合成预览',
  adoptProposal: () => { $('#taskCreateMask').classList.remove('hidden'); },
  stageStuckProposal: proposal => { $('#stuckMask').classList.remove('hidden'); $('#shrinkNextAction').value = proposal.steps[0].title; return { ok: true }; },
  restoreModalFocus: target => target?.focus(), isAiClarifyEnabled: () => true, showEntryStatus() {} });
feature.mount();
$('#btnStuckCollaborate').addEventListener('click', () => void feature.open({ purpose: 'stuck', mode: 'small-step', taskId: 'synthetic-task' }));
$('#stuckMask').classList.remove('hidden');
await feature.open({ purpose: 'stuck', mode: 'small-step', taskId: 'synthetic-task' });
$('#draftChatDescription').textContent = '合成数据预览 · 31 轮、范围选择与修改差异核对 · 本页不连接模型，也不保存任务';
await feature.changes.preview('synthetic-proposal');
