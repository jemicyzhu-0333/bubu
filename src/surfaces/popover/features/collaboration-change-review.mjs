import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

import { createCollaborationChangeView } from '../ui/collaboration-change-view.mjs';
import { editableOperation, editOperation } from '../ui/collaboration-change-edit.mjs';

const BINDING = Object.freeze(['conversationId', 'changeSetId', 'proposalVersion', 'applyGroupId',
  'operationsHash', 'previewHash', 'disclosureHash']);
const ERRORS = Object.freeze({
  'change-target-conflict': '内容已在别处修改；本次未应用。需要重新查看最新差异。',
  'change-proposal-version-conflict': '这份差异版本已失效；本次未应用，需要重新预览。',
  'change-preview-drift': '实际差异已经变化；本次未应用，需要重新预览。',
  'change-proposal-expired': '确认时间已过期；建议仍在，需要重新预览。',
  'change-authorization-invalid': '参考范围或模型配置已变化；需要重新核对参考范围。',
  'change-source-not-authorized': '建议依据的记录已变化；需要在最新参考范围内继续对话，再生成建议。',
  'change-proposal-identity-conflict': '这次预览已失效；需要重新核对差异。',
  'change-proposal-missing': '这次预览已失效；原建议仍在，可以重新核对差异。',
  'change-undo-unavailable': '这次修改当前不能撤销；可能已有后续修改或超过保留期限。',
  'change-operation-consumed': '这项操作已有提交记录，请核对回执。',
  'change-operations-invalid': '编辑内容未通过校验；尚未应用，可以继续修改。',
  'change-no-op': '所选内容没有实际变化，未提交。',
  'change-ledger-capacity': '本机提交记录暂时无法保存；未应用，建议仍在。'
});

function createCollaborationChangeReview({ $, escapeHTML, surfaceClient, getState, onBusy, onReceiptContext = () => {} }) {
  const view = createCollaborationChangeView({ $, escapeHTML });
  let epoch = 0, busy = false, changeSet = null, proposalId = null, operations = [], excluded = new Set();
  let dirty = false, invalid = false, uncertain = false, receipt = null, historyStatus = null, durability = null, undoAvailable = false, message = '';
  let binding = null, listed = [], nextCursor = null, listEpoch = 0, renewIdentity = false;
  const teardown = [];
  const pendingConfirmations = new Map();
  const pendingProposals = new Map();
  const current = () => getState();
  const conversationId = () => current().record?.id || current().receiptContext?.conversationId || null;
  function render() { view.render({ changeSet, operations, excluded, dirty, busy, receipt, historyStatus, durability, undoAvailable, message, uncertain, invalid }); }
  function setBusy(on) { busy = on; onBusy(on); render(); }
  const usable = token => token === epoch && current().open;
  async function releasePreview(value) {
    if (!value?.changeSetId || typeof surfaceClient.cancelConversationChanges !== 'function') return;
    try { await surfaceClient.cancelConversationChanges(Object.fromEntries(BINDING.map(key => [key, value[key]]))); } catch (_) { /* It cannot be confirmed by a dismissed UI. */ }
  }
  function invalidate({ clear = false } = {}) {
    if (changeSet && !receipt && !(binding && (busy || uncertain))) void releasePreview(changeSet);
    ++epoch; ++listEpoch; busy = false; onBusy(false); invalid = true;
    renewIdentity = true;
    if (clear) {
      changeSet = null; proposalId = null; operations = []; excluded = new Set(); receipt = null;
      dirty = false; uncertain = false; binding = null; message = ''; listed = []; nextCursor = null;
      renderList();
    } else if (changeSet && !receipt) message = '参考范围或对话已变化，需要重新查看差异。';
    render();
  }
  function acceptPreview(result, id) {
    const next = result?.changeSet;
    if (!result?.ok || !next || next.conversationId !== conversationId()
      || !next.changeSetId || !Number.isSafeInteger(next.proposalVersion) || next.proposalVersion < 1
      || !Array.isArray(next.operations) || !next.operations.length || !Array.isArray(next.diff)
      || !Array.isArray(next.applyGroups) || next.applyGroups.length !== 1
      || next.applyGroups[0].applyGroupId !== next.applyGroupId
      || ['operationsHash', 'previewHash', 'disclosureHash'].some(key => !/^[a-f0-9]{64}$/.test(next[key]))) {
      message = ERRORS[result?.reason] || '本机差异暂不可用；没有应用任何建议。'; invalid = true; return false;
    }
    changeSet = structuredClone(next); proposalId = id;
    operations = structuredClone(next.operations); excluded = new Set();
    dirty = false; invalid = false; uncertain = false; receipt = null; binding = null; renewIdentity = false;
    message = next.revertsReceiptId ? '下列是重新核对后的撤销差异，确认后才提交。' : '这些修改尚未提交。逐项核对后可以确认，也可以继续留在草稿里。';
    return true;
  }
  async function preview(id = proposalId) {
    const state = current();
    if (busy || state.busy || state.scopeDirty || !state.open || !state.record || !state.scopeGrantId
      || uncertain || receipt && durability === 'unconfirmed' || typeof surfaceClient.previewConversationChanges !== 'function') return;
    const source = state.record.messages.find(item => item.proposal?.id === id);
    if (!source || !['change-set', 'task-draft'].includes(source.proposal.kind)) return;
    const token = ++epoch;
    const edited = changeSet && proposalId === id && (dirty || invalid);
    const chosen = operations.filter(op => !excluded.has(op.opId)).map(editableOperation).map(op => {
      if (!op || !renewIdentity) return op;
      const { opId, ...candidate } = op; return candidate;
    });
    if (edited && (!chosen.length || chosen.some(op => !op))) { message = '至少保留一项可应用操作。'; render(); return; }
    setBusy(true);
    try {
      const result = await surfaceClient.previewConversationChanges({ conversationId: state.record.id,
        scopeGrantId: state.scopeGrantId, proposalId: id,
        ...(edited ? { operations: chosen,
          ...(!renewIdentity ? { changeSetId: changeSet.changeSetId, expectedProposalVersion: changeSet.proposalVersion } : {}) } : {}) });
      if (!usable(token) || current().record?.id !== state.record.id) { void releasePreview(result?.changeSet); return; }
      if (result?.alreadyApplied && acceptReceipt(result)) void listReceipts();
      else acceptPreview(result, id);
    } catch (_) { if (usable(token)) { invalid = true; message = '差异读取未完成；没有提交，可以重试预览。'; } }
    finally { if (usable(token)) setBusy(false); }
  }
  function select(opId, included) {
    if (busy || current().busy || uncertain || receipt || changeSet?.revertsReceiptId || !operations.some(op => op.opId === opId)) return;
    if (included) excluded.delete(opId); else excluded.add(opId);
    dirty = true; binding = null; message = '所选操作已变化，重新查看差异后才能确认。'; render();
  }
  function edit(opId, field, value) {
    if (busy || current().busy || uncertain || receipt || changeSet?.revertsReceiptId) return;
    const index = operations.findIndex(op => op.opId === opId);
    if (index < 0) return;
    const edited = editOperation(operations[index], field, value);
    if (!edited) return;
    operations[index] = edited; dirty = true; binding = null;
    message = '内容已编辑，重新查看差异后才能确认。';
    // Do not rebuild a focused input on each keystroke.
    $('#btnDraftChatChangeConfirm')?.classList.add('hidden');
    $('#btnDraftChatChangePreview')?.classList.remove('hidden');
    view.text('draftChatChangeStatus', message);
  }
  function acceptReceipt(result, expected = null) {
    const value = result?.receipt;
    if (!result?.ok || !value?.receiptId || typeof value.conversationId !== 'string'
      || conversationId() && value.conversationId !== conversationId()
      || !conversationId() && (!current().receiptContext || value.receiptId !== current().receiptContext.receiptId)
      || !['applied', 'reverted'].includes(value.status) || !Number.isSafeInteger(value.appliedRevision)
      || expected && !BINDING.every(key => value[key] === expected[key])) return false;
    receipt = structuredClone(value); historyStatus = result.historyStatus || null;
    durability = result.durability === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
    if (current().receiptContext) onReceiptContext({ receiptId: current().receiptContext.receiptId, conversationId: value.conversationId });
    undoAvailable = result.undoAvailable === true && durability === 'confirmed';
    uncertain = durability === 'unconfirmed'; dirty = false; invalid = true;
    binding = uncertain ? Object.fromEntries(BINDING.map(key => [key, value[key]])) : null;
    message = durability === 'unconfirmed' ? '变更已落入本机状态，但持久保存尚未确认。核对保存结果前不可撤销或重新应用。'
      : value.revertsReceiptId ? '撤销已提交，原修改和撤销回执都保留在历史中。' : '已收到本机提交回执。';
    return true;
  }
  async function confirm({ retry = false } = {}) {
    const state = current();
    const verifyingReceipt = retry && receipt && durability === 'unconfirmed' && binding;
    if (busy || state.busy || !state.open || !changeSet && !verifyingReceipt || receipt && !verifyingReceipt || state.scopeDirty) return;
    if (!retry && (dirty || invalid || uncertain)) return;
    if (retry && (!uncertain || !binding)) return;
    if (!retry) binding = Object.fromEntries(BINDING.map(key => [key, changeSet[key]]));
    const expected = structuredClone(binding), token = ++epoch;
    const originReceipt = changeSet?.revertsReceiptId;
    if (originReceipt && !verifyingReceipt) pendingConfirmations.set(originReceipt, { binding: expected, changeSet: structuredClone(changeSet), operations: structuredClone(operations) });
    if (!originReceipt && !verifyingReceipt) pendingProposals.set(expected.conversationId, { proposalId, binding: expected,
      changeSet: structuredClone(changeSet), operations: structuredClone(operations) });
    setBusy(true); message = retry ? '正在核对同一次确认的提交记录…' : '正在提交已核对的变更…'; render();
    try {
      let result;
      // If transport lost the original response, retry the exact same identity.
      // The application must return its durable receipt rather than apply twice.
      result = await surfaceClient.confirmConversationChanges(expected);
      if (originReceipt && result?.ok && result.receipt && BINDING.every(key => result.receipt[key] === expected[key])) pendingConfirmations.delete(originReceipt);
      const normal = pendingProposals.get(expected.conversationId);
      if (normal && BINDING.every(key => normal.binding[key] === expected[key]) && result?.ok && result.receipt
        && BINDING.every(key => result.receipt[key] === expected[key])) pendingProposals.delete(expected.conversationId);
      if (!usable(token) || conversationId() !== expected.conversationId) return;
      if (result?.ok && !result.receipt && result.receiptId) result = await surfaceClient.getChangeReceipt({ receiptId: result.receiptId });
      if (!usable(token)) return;
      if (acceptReceipt(result, expected)) { void listReceipts(); return; }
      if (result?.reason === 'change-commit-outcome-unknown' && result.retrySameIdentity === true) {
        uncertain = true; invalid = false; durability = 'unconfirmed';
        message = '提交结果暂时无法核验，不能判断是否已应用。仅核对同一次确认，不重新执行建议。';
        return;
      }
      if (result?.reason === 'change-durability-uncertain' && result.committed === true && result.retrySameIdentity === true) {
        uncertain = true; invalid = false; durability = 'unconfirmed';
        message = '变更已落入本机状态，但持久保存尚未确认。核对同一次确认的保存结果，不会重新应用建议。';
        return;
      }
      if (result?.ok === false) {
        if (originReceipt) pendingConfirmations.delete(originReceipt);
        if (pendingProposals.get(expected.conversationId) && BINDING.every(key => pendingProposals.get(expected.conversationId).binding[key] === expected[key])) pendingProposals.delete(expected.conversationId);
        uncertain = false; invalid = true; binding = null;
        if (['change-proposal-missing', 'change-proposal-identity-conflict', 'change-authorization-invalid'].includes(result.reason)) renewIdentity = true;
        message = ERRORS[result.reason] || '本次未应用，建议仍在。可以核对最新差异后再试。';
      } else { uncertain = true; message = '尚未确认提交结果；核对同一次确认的回执后再继续。'; }
    } catch (_) { if (usable(token)) { uncertain = true; message = '提交结果尚未确认；核对回执会沿用同一次确认，不重复建立任务。'; } }
    finally { if (usable(token)) setBusy(false); }
  }
  async function showReceipt(receiptId) {
    if (busy || current().busy || !current().open || !receiptId) return;
    const token = ++epoch, id = conversationId(); setBusy(true);
    try {
      const result = await surfaceClient.getChangeReceipt({ receiptId });
      if (!usable(token) || conversationId() !== id) return;
      if (result?.receipt?.receiptId !== receiptId || !acceptReceipt(result)) message = '回执当前不可用；无法确认更多提交详情。';
      else {
        const pending = pendingConfirmations.get(receiptId);
        if (receipt.status === 'reverted') pendingConfirmations.delete(receiptId);
        else if (pending) {
          changeSet = structuredClone(pending.changeSet); operations = structuredClone(pending.operations); binding = structuredClone(pending.binding);
          receipt = null; uncertain = true; invalid = false; dirty = false;
          message = '先前的撤销提交结果尚未确认；可以核对同一次确认的回执。';
        }
      }
    } catch (_) { if (usable(token)) message = '回执读取未完成；已有提交状态未改变。'; }
    finally { if (usable(token)) setBusy(false); }
  }
  async function undo() {
    const state = current();
    if (busy || state.busy || state.scopeDirty || !state.open || !undoAvailable || !receipt?.details?.undo || receipt.status !== 'applied') return;
    const token = ++epoch, id = receipt.receiptId; setBusy(true);
    try {
      const result = await surfaceClient.previewChangeUndo({ conversationId: conversationId(), receiptId: id,
        ...(state.scopeGrantId ? { scopeGrantId: state.scopeGrantId } : {}) });
      if (!usable(token)) { void releasePreview(result?.changeSet); return; }
      if (!acceptPreview(result, null)) message = ERRORS[result?.reason] || '撤销差异暂不可用，没有撤销任何修改。';
    } catch (_) { if (usable(token)) message = '撤销差异读取未完成；原修改未变。'; }
    finally { if (usable(token)) setBusy(false); }
  }
  async function cancel() {
    if (busy || uncertain || !changeSet || receipt) return;
    const token = ++epoch, request = Object.fromEntries(BINDING.map(key => [key, changeSet[key]]));
    setBusy(true);
    try {
      const result = await surfaceClient.cancelConversationChanges(request);
      if (!usable(token)) return;
      if (result?.ok) { changeSet = null; binding = null; message = '这次待确认变更已取消；原建议仍在对话中。'; }
      else { invalid = true; message = '取消未确认；当前确认入口已失效。'; }
    } catch (_) { if (usable(token)) { invalid = true; message = '取消未确认；当前确认入口已失效。'; } }
    finally { if (usable(token)) setBusy(false); }
  }
  function restorePending() {
    const pending = pendingProposals.get(conversationId());
    if (!pending) return false;
    proposalId = pending.proposalId; changeSet = structuredClone(pending.changeSet);
    operations = structuredClone(pending.operations); binding = structuredClone(pending.binding);
    receipt = null; dirty = false; invalid = false; uncertain = true; durability = 'unconfirmed';
    message = '先前的提交结果尚未确认；仅核对同一次确认，不重新执行建议。';
    render(); return true;
  }
  function forgetConversation(id) {
    pendingProposals.delete(id);
    for (const [key, value] of pendingConfirmations) if (value.binding.conversationId === id) pendingConfirmations.delete(key);
  }
  const receiptLabel = item => t(item.durability === 'unconfirmed' ? '本机变更待确认持久保存' : item.revertsReceiptId ? '已提交撤销' : item.status === 'reverted' ? '修改已撤销' : '已确认修改');
  function repaintListCopy() {
    $('#draftChatReceipts')?.querySelectorAll('[data-chat-receipt]').forEach((button, index) => {
      const item = listed[index]; if (!item) return;
      const label = button.querySelector('span'), detail = button.querySelector('small');
      if (label) label.textContent = receiptLabel(item);
      if (detail) detail.textContent = t('回执 {receipt} · 版本 {version}', { receipt: item.receiptId, version: Number(item.appliedRevision) });
    });
  }
  function renderList() {
    const node = $('#draftChatReceipts');
    if (node) node.innerHTML = listed.map(item => `<button type="button" class="chat-session" data-chat-receipt="${escapeHTML(item.receiptId)}">`
      + `<span>${receiptLabel(item)}</span>`
      + `<small>${escapeHTML(t('回执 {receipt} · 版本 {version}', { receipt: item.receiptId, version: Number(item.appliedRevision) }))}</small></button>`).join('');
    $('#draftChatReceiptHistory')?.classList.toggle('hidden', !listed.length);
    $('#btnDraftChatReceiptsMore')?.classList.toggle('hidden', !nextCursor);
  }
  function receiptListFailure() {
    $('#draftChatReceiptHistory')?.classList.remove('hidden');
    view.text('draftChatReceiptsStatus', '提交历史暂不可用；不能据此判断没有提交记录。');
  }
  async function listReceipts({ more = false } = {}) {
    const state = current();
    if (!state.open || !state.record || typeof surfaceClient.getConversationReceipts !== 'function') return;
    const token = ++listEpoch, id = state.record.id;
    try {
      const result = await surfaceClient.getConversationReceipts({ conversationId: id, limit: 20, ...(more && nextCursor ? { cursor: nextCursor } : {}) });
      if (token !== listEpoch || !current().open || current().record?.id !== id) return;
      if (!result?.ok || result.availability === 'unavailable') { receiptListFailure(); return; }
      view.text('draftChatReceiptsStatus', '');
      const items = (result.items || []).map(item => item?.ok === true && item.receipt
        ? { ...item.receipt, durability: item.durability, historyStatus: item.historyStatus } : item);
      listed = [...new Map([...(more ? listed : []), ...items].filter(item =>
        item.conversationId === id && ['applied', 'reverted'].includes(item.status)).map(item => [item.receiptId, item])).values()];
      nextCursor = result.nextCursor || null; renderList();
    } catch (_) { if (token === listEpoch && current().open && current().record?.id === id) receiptListFailure(); }
  }
  function mount() {
    teardown.push(onLocaleChanged(() => { view.repaintCopy(); repaintListCopy(); }));
    const listen = (id, type, handler) => { const node = $(`#${id}`); if (!node) return; node.addEventListener(type, handler); teardown.push(() => node.removeEventListener(type, handler)); };
    listen('draftChatChangeCards', 'change', event => {
      const target = event.target.closest?.('[data-change-select]'); if (target) select(target.dataset.changeSelect, target.checked);
      const editTarget = event.target.closest?.('[data-change-edit]'); if (editTarget) edit(editTarget.dataset.changeEdit, editTarget.dataset.changeField, editTarget.value);
    });
    listen('draftChatChangeCards', 'input', event => {
      const target = event.target.closest?.('[data-change-edit]'); if (target) edit(target.dataset.changeEdit, target.dataset.changeField, target.value);
    });
    listen('btnDraftChatChangePreview', 'click', () => void preview());
    listen('btnDraftChatChangeConfirm', 'click', () => void confirm());
    listen('btnDraftChatChangeRetry', 'click', () => void confirm({ retry: true }));
    listen('btnDraftChatChangeCancel', 'click', () => void cancel());
    listen('btnDraftChatReceiptRefresh', 'click', () => void showReceipt(receipt?.receiptId));
    listen('btnDraftChatUndo', 'click', () => void undo());
    listen('btnDraftChatReceiptsMore', 'click', () => void listReceipts({ more: true }));
    listen('draftChatReceipts', 'click', event => { const target = event.target.closest?.('[data-chat-receipt]'); if (target) void showReceipt(target.dataset.chatReceipt); });
  }
  return Object.freeze({ mount, preview, confirm, select, edit, showReceipt, undo, cancel, listReceipts, invalidate, restorePending, forgetConversation,
    isBusy: () => busy, dispose: () => { invalidate({ clear: true }); pendingProposals.clear(); pendingConfirmations.clear(); while (teardown.length) teardown.pop()(); } });
}

export { createCollaborationChangeReview };
