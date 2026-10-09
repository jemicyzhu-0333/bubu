import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

import { createCollaborationView, taskDraftFromMessage } from '../ui/collaboration-view.mjs';
import { createCollaborationNavigation } from '../ui/collaboration-navigation.mjs';
import { createCollaborationContextSelection } from './collaboration-context-selection.mjs';
import { createCollaborationChangeReview } from './collaboration-change-review.mjs';
import { createCollaborationProposalStatus } from './collaboration-proposal-status.mjs';

const REFUSALS = Object.freeze({
  'memory-selection-budget': '每轮最多选择 8 条记忆。可以取消一些条目后重新预览。',
  'memory-context-budget': '所选记忆正文合计超过 1200 字。没有发送，请减少选择后重新预览。',
  'memory-disabled': '长期记忆仍关闭，可以先在设置中明确启用。',
  'memory-authority-unavailable': '本机记忆库暂不可用，已停止引用这些记忆。',
  'conversation-delete-conflict': '对话已经变化，未删除。请重新打开核对后再确认。',
  'conversation-delete-confirmation-required': '请先核对要删除的这段对话，再确认删除。',
  'conversation-cache-full': '本次临时对话已达到容量。可以继续已有对话，或明确删除不再需要的一段后新建。',
  'conversation-expired': '这段对话已按保留期限到期。可以开始新对话。',
  'clarify-disabled': 'AI 协作还未开启，手动草稿仍可继续编辑。',
  'clarify-unavailable': 'AI 尚未配置好，手动草稿仍可继续编辑。',
  'conversation-not-found': '这段对话已不可用，可以开始新对话。',
  'conversation-owner-mismatch': '这段对话需要重新打开。',
  'message-too-long': '单条最多 8,000 个 Unicode 字符，请拆成几段发送；原文仍在。',
  'message-required': '写点什么再发。',
  'scope-grant-invalid': '参考范围已失效，请重新打开对话核对。',
  'authorization-required': '参考范围需要重新确认，请重新打开对话核对。',
  'target-changed': '当前任务已变化，草稿未应用。请重新核对任务。',
  'storage-unavailable': '本机保存不可用，内容仍保留在本次运行中。',
  'conversation-storage-unavailable': '本机保存不可用，内容仍保留在本次运行中。',
  'conversation-draft-invalid': '输入草稿尚未保存，原文仍在；请将过长内容分段后再试。',
  'conversation-authorization-required': '参考范围需要重新确认，请重新打开对话核对。',
  'conversation-context-pending': '对话仍保留在本机，参考范围尚未更新。可以重新选择参考内容后再应用。',
  'save-failed': '本机保存未成功，内容仍保留在本次运行中。',
  'collaboration-directory-sync-unsupported': '这台系统暂不支持已验证的迁移备份，旧记录未改写。当前可以仅本次继续。',
  'collaboration-backup-failed': '本机记录备份未成功，旧记录未改写。当前可以仅本次继续。',
  'profile-identity-missing': '本机记录的身份文件缺失，现有记录未改写。当前可以仅本次继续。',
  'profile-identity-invalid': '本机记录身份需要恢复，现有记录未改写。当前可以仅本次继续。',
  'profile-identity-uninitialized': '本机记录身份尚未完整保存，现有记录未改写。当前可以仅本次继续。',
  'sqlite-unavailable': '本机可靠保存暂不可用，内容仅保留在本次运行中。'
});

// Owns only renderer lifecycle, navigation and unsubmitted input. Conversation
// history, authorization and retention remain canonical in the application.
function createPopoverDraftConversation({
  document, $, escapeHTML, surfaceClient, fallbackReasonText,
  adoptProposal, stageStuckProposal, restoreModalFocus, isAiClarifyEnabled, showEntryStatus, onMemoryCandidateReview, onPlanningCandidateReview
} = {}) {
  if (!document || typeof $ !== 'function' || typeof escapeHTML !== 'function') {
    throw new TypeError('popover draft conversation requires document, $ and escapeHTML');
  }
  for (const [name, fn] of Object.entries({ fallbackReasonText, adoptProposal,
    restoreModalFocus, isAiClarifyEnabled, showEntryStatus })) {
    if (typeof fn !== 'function') throw new TypeError(`popover draft conversation requires ${name}`);
  }
  if (!surfaceClient || typeof surfaceClient.startConversation !== 'function'
    || typeof surfaceClient.conversationTurn !== 'function') {
    throw new TypeError('popover draft conversation requires surfaceClient');
  }
  const view = createCollaborationView({ $, escapeHTML, fallbackReasonText });
  const navigation = createCollaborationNavigation({ document, $, restoreModalFocus });
  let record = null;
  let scopeGrantId = null;
  let selected = null;
  let epoch = 0;
  let busy = false;
  let scopeSelected = false;
  let mounted = false;
  let entry = { purpose: 'task', mode: 'talk' };
  let resumeId = null;
  let nextCursor = null;
  let listed = [];
  let listing = false;
  let closeBarrier = Promise.resolve();
  let loadingRequest = null;
  let pendingDelete = null;
  let receiptContext = null;
  const drafts = new Map();
  const teardown = [];
  const proposalStatus = createCollaborationProposalStatus({ surfaceClient, view,
    getState: () => ({ record: receiptContext ? null : record, open: navigation.isOpen() }) });
  const changes = createCollaborationChangeReview({ $, escapeHTML, surfaceClient,
    getState: () => ({ record, scopeGrantId, receiptContext, open: navigation.isOpen(), busy, scopeDirty: !receiptContext && contextSelection.isDirty() }),
    onReceiptContext: value => { receiptContext = value; },
    onBusy: value => {
      view.busy(busy || value);
      if ($('#btnDraftChatSend')) $('#btnDraftChatSend').disabled = busy || value || !scopeGrantId
        || record?.contextEligibilityPending === true || contextSelection.isDirty();
      if (value) view.text('#btnDraftChatSend', '处理中…');
      if (value) $('#btnDraftChatCancel')?.classList.add('hidden');
      receiptMode();
      if (!value) void proposalStatus.refresh();
    } });
  const contextSelection = createCollaborationContextSelection({ $, escapeHTML, surfaceClient,
    getConversation: () => record, isOpen: navigation.isOpen, isBusy: () => busy || changes.isBusy(),
    onChange: () => { changes.invalidate(); proposalStatus.invalidate(); if ($('#btnDraftChatSend')) $('#btnDraftChatSend').disabled = busy
      || changes.isBusy() || !scopeGrantId || record?.contextEligibilityPending === true || contextSelection.isDirty(); },
    onApply: () => change('scope'), status: view.status });
  const isBusy = () => busy || changes.isBusy();

  function receiptMode() {
    const local = Boolean(receiptContext);
    $('#draftChatConversationControls')?.classList.toggle('hidden', local);
    $('#draftChatPageActions')?.classList.toggle('hidden', local || view.currentPage() !== 'detail');
    $('#draftChatConversationComposer')?.classList.toggle('hidden', local);
    $('#btnDraftChatReceiptClose')?.classList.toggle('hidden', !local);
    if (local) {
      $('#btnDraftChatAdopt')?.classList.add('hidden');
      view.text('#draftChatTitle', '本机变更回执');
      view.text('#draftChatCurrentMode', '只核对提交记录与可用撤销，不开启对话或模型请求');
      $('#draftChatTaskContext')?.classList.add('hidden');
    }
  }

  const input = () => $('#draftChatInput')?.value || '';
  const valid = token => token === epoch && navigation.isOpen();
  function listen(selector, type, handler) {
    const node = $(selector);
    if (!node) return;
    node.addEventListener(type, handler);
    teardown.push(() => node.removeEventListener(type, handler));
  }
  function setBusy(value) {
    busy = value;
    view.busy(value || changes.isBusy());
    if ($('#btnDraftChatSend')) $('#btnDraftChatSend').disabled = value || changes.isBusy() || !scopeGrantId
      || record?.contextEligibilityPending === true || contextSelection.isDirty();
    contextSelection.render();
  }
  function showFailure(result) {
    view.status(REFUSALS[result?.reason] || '这次未完成，内容仍在，可以重试或返回手动草稿。');
  }
  function markDraftStatus() {
    if (record?.saveState === 'saved' && record?.retention?.mode === 'saved' && (input() !== record.inputDraft || selected !== record.selectedProposalId)
      && $('#draftChatSaveState')) view.text('#draftChatSaveState', '当前输入或草稿选择待保存 · 暂停时保留');
  }
  function snapshot() {
    const draft = { inputDraft: input(), selectedProposalId: selected, scrollTop: $('#draftChatLog')?.scrollTop || 0 };
    if (record) drafts.set(record.id, draft);
    return draft;
  }
  function accept(result, { restore = false, toBottom = false } = {}) {
    if (result.conversation) record = result.conversation;
    if (Object.hasOwn(result, 'scopeGrantId')) scopeGrantId = result.scopeGrantId || null;
    if (!record) return;
    resumeId = record.id;
    const local = drafts.get(record.id);
    const proposals = record.messages.filter(message => ['task-draft', 'change-set', 'memory-candidate', 'planning-preference-candidate'].includes(message.proposal?.kind));
    selected = restore ? (local?.selectedProposalId || record.selectedProposalId)
      : selected;
    if (!proposals.some(message => message.proposal.id === selected)) selected = proposals.at(-1)?.proposal.id || null;
    if (restore) view.draft(local?.inputDraft ?? record.inputDraft ?? '', selected);
    view.conversation(record, selected, { scrollTop: restore ? (local?.scrollTop ?? record.scrollTop ?? 0) : undefined, toBottom });
    if (result.disclosure || result.contextPreview) view.context(result.disclosure, result.contextPreview);
    markDraftStatus();
    void proposalStatus.refresh();
  }
  async function pause() {
    if (!record) return;
    const id = record.id;
    const draft = snapshot();
    return surfaceClient.pauseConversation({ conversationId: id, ...draft });
  }
  async function load({ conversationId, fresh = false } = {}) {
    proposalStatus.invalidate();
    clearDelete();
    changes.invalidate({ clear: true });
    contextSelection.invalidate();
    const token = ++epoch;
    setBusy(true);
    view.status('正在读取本机对话…');
    try {
      await closeBarrier;
      if (!valid(token)) return;
      const request = Promise.resolve(conversationId && !fresh
        ? surfaceClient.getConversation({ conversationId })
        : surfaceClient.startConversation({ ...entry, retentionMode: 'ephemeral' }));
      loadingRequest = request;
      const result = await request;
      if (loadingRequest === request) loadingRequest = null;
      if (!valid(token)) return;
      if (!result?.ok) { scopeGrantId = null; showFailure(result); return; }
      selected = null;
      scopeGrantId = null;
      scopeSelected = false;
      if ($('#draftChatFocusSummary')) $('#draftChatFocusSummary').checked = false;
      if ($('#draftChatPlanningPreferences')) $('#draftChatPlanningPreferences').checked = Boolean(result.selection?.planningPreferences);
      accept(result, { restore: true });
      view.page('detail');
      contextSelection.reset(record, result.selection);
      if (record.contextEligibilityPending === true) contextSelection.applied(false);
      changes.restorePending();
      void changes.listReceipts();
      view.status(record.contextEligibilityPending === true ? REFUSALS['conversation-context-pending']
        : record.saveState === 'unsaved' ? '这段对话尚未保存到本机。' : '');
      $('#draftChatInput')?.focus();
    } catch (_) { if (valid(token)) showFailure(); }
    finally { if (valid(token)) { setBusy(false); $('#draftChatInput')?.focus(); } }
  }
  async function open(options = {}) {
    if (navigation.isOpen()) return;
    const next = { purpose: options.purpose || 'task', mode: options.mode || 'talk' };
    if (options.taskId) next.taskId = options.taskId;
    if (!isAiClarifyEnabled(next.purpose)) {
      showEntryStatus(() => t(REFUSALS['clarify-disabled']), next.purpose);
      return;
    }
    if (next.purpose !== entry.purpose || next.taskId !== entry.taskId) resumeId = null;
    entry = next;
    receiptContext = null;
    receiptMode();
    $('#draftChatRetentionConfirm')?.classList.add('hidden');
    navigation.open(entry.purpose);
    view.page('detail');
    await load({ conversationId: options.conversationId || resumeId });
  }
  function close({ adopted = false } = {}) {
    proposalStatus.invalidate();
    clearDelete();
    ++epoch;
    if (!navigation.isOpen()) return;
    // Capture before dismissing; both cancel and window close preserve the input.
    const closingPurpose = record?.purpose || entry.purpose;
    const pendingLoad = loadingRequest;
    const currentPause = Promise.resolve(pause());
    // A reopened surface waits for the abandoned load and its pause. Otherwise
    // that late load could revoke the fresh session's authorization after reopen.
    closeBarrier = Promise.all([currentPause, pendingLoad ? pendingLoad.then(result => {
      if (!result?.conversation) return null;
      const draft = drafts.get(result.conversation.id);
      return surfaceClient.pauseConversation({ conversationId: result.conversation.id,
        inputDraft: draft?.inputDraft ?? result.conversation.inputDraft ?? '',
        selectedProposalId: draft?.selectedProposalId ?? result.conversation.selectedProposalId ?? null,
        scrollTop: draft?.scrollTop ?? result.conversation.scrollTop ?? 0 });
    }) : null]).then(results => results.find(result => result?.ok === false) || results.find(result => result?.conversation?.saveState === 'unsaved') || results[0]).then(result => {
      if (result?.ok === false || result?.conversation?.saveState === 'unsaved') {
        if (!navigation.isOpen()) showEntryStatus(() => t('对话已暂停，输入草稿尚未保存到本机；再次打开仍可继续。'), closingPurpose);
      }
      return result;
    }).catch(() => {
      if (!navigation.isOpen()) showEntryStatus(() => t('暂停保存未确认，输入草稿仍保留在本次运行中。'), closingPurpose);
      return null;
    });
    navigation.close({ adopted });
    changes.invalidate({ clear: true });
    contextSelection.invalidate();
    receiptContext = null;
    busy = false;
  }
  async function send() {
    if (isBusy() || !navigation.isOpen() || !record || !scopeGrantId) return;
    if (contextSelection.isDirty()) { view.status('参考选择尚未加入本轮预览；更新预览后才可发送。'); return; }
    const raw = input();
    const message = raw.trim();
    if (!message) { view.status(REFUSALS['message-required']); return; }
    if (Array.from(raw).length > 8000) { view.status(REFUSALS['message-too-long']); return; }
    const token = ++epoch;
    changes.invalidate();
    proposalStatus.invalidate();
    setBusy(true);
    snapshot();
    view.status('正在生成，可以取消；输入内容会保留。');
    try {
      const result = await surfaceClient.conversationTurn({ conversationId: record.id, scopeGrantId, message, selectedProposalId: selected });
      if (!valid(token)) return;
      if (result?.ok && result.conversation?.messages?.at(-1)?.proposal) selected = result.conversation.messages.at(-1).proposal.id;
      if (result?.conversation) accept(result, { toBottom: true });
      if (!result?.ok) { showFailure(result); return; }
      // No optimistic duplicate messages: render the authoritative complete history.
      view.draft('', selected);
      snapshot();
      const local = result.source === 'local' || result.fallback;
      const reason = result.providerReason || result.reason;
      const hasSummary = result.notice === 'summary-available';
      view.status(() => (local ? t('本地模板{detail}。', { detail: reason ? t('：{detail}', { detail: fallbackReasonText(reason) || t('模型暂不可用') }) : '' }) : '')
        + (hasSummary ? t('已有草稿可以带回编辑，也可以继续聊。') : ''));
      $('#draftChatInput')?.focus();
    } catch (_) { if (valid(token)) showFailure(); }
    finally { if (valid(token)) { setBusy(false); $('#draftChatInput')?.focus(); } }
  }
  function showRetiredScope(result, kind) {
    if (result?.reason !== 'scope-not-issued' || result.transition?.applied !== true) return false;
    scopeGrantId = null;
    contextSelection.invalidate();
    contextSelection.applied(false);
    view.context(null, null);
    const currentDraft = snapshot();
    view.draft(currentDraft.inputDraft, selected);
    markDraftStatus();
    const applied = kind === 'cancel' ? '先前生成已取消' : kind === 'mode' ? '模式已更改' : '旧参考范围已撤回';
    view.status(() => t('{action}，输入内容仍在。新的参考内容尚未准备好，请重新打开对话后选择。', { action: t(applied) }));
    return true;
  }
  async function cancel() {
    if (!record || !busy) return;
    const token = ++epoch;
    const draft = snapshot();
    view.status('正在取消生成，输入内容会保留。');
    try {
      const result = await surfaceClient.cancelConversation({ conversationId: record.id });
      if (!valid(token)) return;
      if (result && (result.conversation || Object.hasOwn(result, 'scopeGrantId'))) accept(result);
      if (showRetiredScope(result, 'cancel')) return;
      view.draft(draft.inputDraft, selected);
      markDraftStatus();
      view.status(result?.ok === false ? '取消请求未确认，输入内容仍在；可以关闭暂停。' : '已取消生成，输入内容仍在。');
    } catch (_) { if (valid(token)) view.status('取消请求未确认，输入内容仍在；可以关闭暂停。'); }
    finally { if (valid(token)) { setBusy(false); $('#draftChatInput')?.focus(); } }
  }
  async function change(kind, { confirmed = false } = {}) {
    if (!record || receiptContext || isBusy()) return;
    if (kind === 'retention' && record.retention.mode === 'saved'
      && $('#draftChatRetention').value === 'ephemeral' && !confirmed) {
      $('#draftChatRetentionConfirm')?.classList.remove('hidden');
      $('#btnDraftChatRetentionConfirm')?.focus();
      return;
    }
    $('#draftChatRetentionConfirm')?.classList.add('hidden');
    const token = ++epoch;
    if (kind === 'scope' || kind === 'mode') { changes.invalidate(); proposalStatus.invalidate(); }
    const id = record.id;
    snapshot();
    setBusy(true);
    try {
      let result;
      if (kind === 'scope') result = await surfaceClient.setConversationScope({ conversationId: id,
        focusSummary: Boolean($('#draftChatFocusSummary')?.checked), planningPreferences: Boolean($('#draftChatPlanningPreferences')?.checked), ...contextSelection.selection() });
      if (kind === 'mode') result = await surfaceClient.setConversationMode({ conversationId: id, mode: $('#draftChatMode').value });
      if (kind === 'retention') {
        const mode = $('#draftChatRetention').value;
        result = await surfaceClient.setConversationRetention({ conversationId: id, mode, ...snapshot(),
          ...(mode === 'saved' ? { retentionDays: Number($('#draftChatRetentionDays').value || 30), pinned: Boolean($('#draftChatPinned')?.checked) } : {}) });
      }
      if (!valid(token)) return;
      if (result && (result.conversation || Object.hasOwn(result, 'scopeGrantId'))) accept(result);
      if (showRetiredScope(result, kind)) return;
      if (!result?.ok) {
        if (kind === 'scope') { scopeGrantId = null; contextSelection.applied(false); view.context(null, null); }
        view.conversation(record, selected);
        if ($('#draftChatFocusSummary')) $('#draftChatFocusSummary').checked = scopeSelected;
        showFailure(result); return;
      }
      if (kind === 'scope') { scopeSelected = Boolean($('#draftChatFocusSummary')?.checked); contextSelection.applied(true, result.selection); }
      view.status(kind === 'scope' ? '本机预览已更新；下次发送才会使用这些内容。' : '');
    } catch (_) {
      if (valid(token)) {
        if (kind === 'scope') { scopeGrantId = null; contextSelection.applied(false); view.context(null, null); }
        view.conversation(record, selected);
        if ($('#draftChatFocusSummary')) $('#draftChatFocusSummary').checked = scopeSelected;
        showFailure();
      }
    }
    finally { if (valid(token)) { setBusy(false); $('#draftChatInput')?.focus(); } }
  }
  async function list({ more = false } = {}) {
    if (receiptContext || isBusy() || listing) return;
    snapshot();
    if (!more) view.page('list');
    view.status('正在读取对话列表…');
    listing = true;
    const token = epoch;
    try {
      const result = await surfaceClient.listConversations(more && nextCursor ? { cursor: nextCursor } : {});
      if (!valid(token)) return;
      if (!result?.ok) { showFailure(result); return; }
      listed = more ? [...listed, ...result.items] : result.items;
      nextCursor = result.nextCursor;
      view.sessions(listed, nextCursor);
      view.status(result.availability === 'unavailable' ? '本机保存列表暂不可用；这里只显示当前运行中的对话。' : '');
    } catch (_) { if (valid(token)) showFailure(); }
    finally { listing = false; }
  }
  async function resume(conversationId) {
    if (isBusy()) return;
    if (navigation.isOpen()) closeBarrier = Promise.resolve(pause()).catch(() => null);
    else navigation.open('review');
    receiptContext = null;
    receiptMode();
    await load({ conversationId });
    if (record && navigation.isOpen()) entry = { purpose: record.purpose, mode: record.mode,
      ...(record.relatedEntity?.kind === 'task' ? { taskId: record.relatedEntity.id } : {}) };
  }
  async function startNew() {
    if (receiptContext || isBusy()) return;
    closeBarrier = Promise.resolve(pause()).catch(() => null);
    // Retain the old session and unsent draft if creating another hits capacity.
    entry.mode = $('#draftChatMode')?.value || 'talk';
    await load({ fresh: true });
  }
  async function openReceipt({ receiptId } = {}) {
    proposalStatus.invalidate();
    if (typeof receiptId !== 'string' || !receiptId) return;
    if (navigation.isOpen()) close();
    const token = ++epoch;
    await closeBarrier;
    if (token !== epoch) return;
    clearDelete(); record = null; selected = null; scopeGrantId = null;
    receiptContext = { receiptId, conversationId: null };
    view.page('detail', { focus: false });
    changes.invalidate({ clear: true }); contextSelection.invalidate();
    navigation.open('review'); view.conversation(null, null); receiptMode();
    view.status('本机提交记录可以独立核对；对话已关闭或删除也不会伪造恢复。');
    await changes.showReceipt(receiptId);
  }
  function clearDelete() {
    pendingDelete = null;
    $('#draftChatDeleteConfirm')?.classList.add('hidden');
  }
  async function requestDelete() {
    if (!record || changes.isBusy()) return;
    const id = record.id;
    if (busy) await cancel();
    if (!navigation.isOpen() || record?.id !== id) return;
    pendingDelete = { id, revision: record.revision };
    $('#draftChatDeleteConfirm')?.classList.remove('hidden');
    $('#btnDraftChatDeleteConfirm')?.focus();
  }
  async function confirmDelete() {
    if (!pendingDelete || record?.id !== pendingDelete.id || record.revision !== pendingDelete.revision) {
      clearDelete(); showFailure({ reason: 'conversation-delete-confirmation-required' }); return;
    }
    const { id, revision: expectedRevision } = pendingDelete, token = ++epoch;
    clearDelete();
    setBusy(true);
    try {
      const result = await surfaceClient.deleteConversation({ conversationId: id, expectedRevision });
      if (result?.ok) {
        changes.forgetConversation(id);
        drafts.delete(id); listed = listed.filter(item => item.id !== id);
        if (resumeId === id) resumeId = null;
        if (!valid(token) && record?.id === id) { record = null; selected = null; scopeGrantId = null; }
      }
      if (!valid(token)) return;
      if (!result?.ok) { showFailure(result); return; }
      record = null; selected = null; scopeGrantId = null; resumeId = null;
      $('#draftChatDeleteConfirm')?.classList.add('hidden');
      view.draft('', null); view.conversation(null, null); view.sessions(listed, null);
      setBusy(false);
      navigation.close();
      showEntryStatus(() => t('这段对话已删除。已建立的任务未改动。'), entry.purpose);
    } catch (_) { if (valid(token)) showFailure(); }
    finally { if (valid(token)) setBusy(false); }
  }
  function chooseProposal(id) {
    if (isBusy() || !record?.messages.some(message => message.proposal?.id === id
      && ['task-draft', 'change-set', 'memory-candidate', 'planning-preference-candidate'].includes(message.proposal.kind))) return;
    selected = id;
    view.conversation(record, selected);
    snapshot();
    markDraftStatus();
  }
  async function reviewMemoryCandidate(proposalId) {
    if (isBusy() || receiptContext || !navigation.isOpen() || !record || typeof onMemoryCandidateReview !== 'function'
      || !record.messages.some(message => message.proposal?.id === proposalId && message.proposal.kind === 'memory-candidate')) return;
    const request = { conversationId: record.id, proposalId };
    // Move to settings without reopening a second task modal underneath it.
    // The original task form's unsaved fields remain untouched.
    chooseProposal(proposalId); close({ adopted: true }); const token = epoch;
    await closeBarrier;
    if (token === epoch) await onMemoryCandidateReview(request);
  }
  async function reviewPlanningCandidate(proposalId) {
    if (isBusy() || receiptContext || !navigation.isOpen() || !record || typeof onPlanningCandidateReview !== 'function'
      || !record.messages.some(message => message.proposal?.id === proposalId && message.proposal.kind === 'planning-preference-candidate')) return;
    const request = { conversationId: record.id, proposalId };
    chooseProposal(proposalId); close({ adopted: true }); const token = epoch;
    await closeBarrier;
    if (token === epoch) await onPlanningCandidateReview(request);
  }
  function adopt() {
    if (isBusy() || !record) return;
    const message = record.messages.find(item => item.proposal?.id === selected);
    const proposal = taskDraftFromMessage(message);
    if (!proposal) return;
    if (record.purpose === 'stuck') {
      const taskId = record.relatedEntity?.id || entry.taskId;
      const result = stageStuckProposal?.(proposal, taskId);
      if (!result?.ok) { showFailure(result || { reason: 'target-changed' }); return; }
      close({ adopted: true });
      $('#shrinkNextAction')?.focus();
    } else {
      close({ adopted: true });
      adoptProposal({ ...proposal, provider: message.provenance?.source === 'provider' ? 'api' : 'local',
        fallback: message.provenance?.source !== 'provider', reason: message.provenance?.reason || null });
    }
  }
  function backToConversation() {
    clearDelete();
    $('#draftChatRetentionConfirm')?.classList.add('hidden');
    if (record) view.conversation(record, selected);
    view.page('detail');
    view.status('');
    receiptMode();
  }
  function openSettings() {
    if (receiptContext || isBusy()) return;
    snapshot();
    view.status('');
    view.page('settings');
  }
  function mount() {
    if (mounted) return;
    mounted = true;
    teardown.push(onLocaleChanged(view.repaintCopy));
    contextSelection.mount();
    changes.mount();
    const unsubscribeHidden = surfaceClient.onPopoverHidden?.(() => close());
    if (typeof unsubscribeHidden === 'function') teardown.push(unsubscribeHidden);
    const visibilityChanged = () => { if (document.hidden) close(); };
    document.addEventListener?.('visibilitychange', visibilityChanged);
    teardown.push(() => document.removeEventListener?.('visibilitychange', visibilityChanged));
    listen('#btnDraftChatDelete', 'click', () => void requestDelete());
    listen('#btnDraftChatDeleteConfirm', 'click', () => void confirmDelete());
    listen('#btnDraftChatDeleteKeep', 'click', clearDelete);
    listen('#btnOpenDraftChat', 'click', () => void open());
    listen('#draftChatClose', 'click', () => close());
    listen('#btnDraftChatDiscard', 'click', () => close());
    listen('#btnDraftChatReceiptClose', 'click', () => close());
    listen('#btnDraftChatSend', 'click', () => void send());
    listen('#btnDraftChatCancel', 'click', () => void cancel());
    listen('#btnDraftChatAdopt', 'click', adopt);
    listen('#btnDraftChatRetentionConfirm', 'click', () => void change('retention', { confirmed: true }));
    listen('#btnDraftChatRetentionKeep', 'click', () => {
      $('#draftChatRetentionConfirm')?.classList.add('hidden');
      if (record) view.conversation(record, selected);
    });
    listen('#btnDraftChatNew', 'click', () => void startNew());
    listen('#btnDraftChatList', 'click', () => void list());
    listen('#btnDraftChatRefresh', 'click', () => void list());
    listen('#btnDraftChatSettings', 'click', openSettings);
    listen('#btnDraftChatBack', 'click', backToConversation);
    listen('#draftChatMask', 'keydown', event => {
      if (event.key !== 'Escape' || view.currentPage() === 'detail') return;
      event.preventDefault(); event.stopPropagation?.();
      backToConversation();
    });
    listen('#btnDraftChatMore', 'click', () => void list({ more: true }));
    for (const [selector, direction] of [['#btnDraftChatEarlier', 'earlier'], ['#btnDraftChatLater', 'later'], ['#btnDraftChatLatest', 'latest']]) {
      listen(selector, 'click', () => { view.pageHistory(direction); void proposalStatus.refresh(); });
    }
    for (const [selector, kind] of [['#draftChatMode', 'mode'], ['#draftChatFocusSummary', 'scope'], ['#draftChatPlanningPreferences', 'scope'],
      ['#draftChatRetention', 'retention'], ['#draftChatRetentionDays', 'retention'], ['#draftChatPinned', 'retention']]) {
      listen(selector, 'change', () => void change(kind));
    }
    listen('#draftChatInput', 'input', () => {
      clearDelete();
      view.draft(input(), selected); snapshot();
      markDraftStatus();
    });
    listen('#draftChatInput', 'keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void send();
    });
    listen('#draftChatLog', 'click', event => {
      const target = event.target.closest?.('[data-chat-proposal]');
      if (target) chooseProposal(target.dataset.chatProposal);
      const changeTarget = event.target.closest?.('[data-chat-change]');
      if (changeTarget) { chooseProposal(changeTarget.dataset.chatChange); void changes.preview(changeTarget.dataset.chatChange); }
      const memoryTarget = event.target.closest?.('[data-chat-memory]');
      if (memoryTarget) void reviewMemoryCandidate(memoryTarget.dataset.chatMemory);
      const planningTarget = event.target.closest?.('[data-chat-planning]');
      if (planningTarget) void reviewPlanningCandidate(planningTarget.dataset.chatPlanning);
    });
    listen('#draftChatSessions', 'click', event => {
      const target = event.target.closest?.('[data-chat-resume]');
      if (target) void resume(target.dataset.chatResume);
    });
  }
  function dispose() {
    close();
    ++epoch;
    while (teardown.length) teardown.pop()();
    contextSelection.dispose();
    changes.dispose();
    mounted = false;
  }
  return Object.freeze({ mount, dispose, isOpen: navigation.isOpen, open, close, send, cancel,
    adopt, chooseProposal, resume, list, startNew, change, requestDelete, confirmDelete,
    contextSelection, changes, openReceipt, reviewMemoryCandidate, reviewPlanningCandidate });
}

export { createPopoverDraftConversation };
