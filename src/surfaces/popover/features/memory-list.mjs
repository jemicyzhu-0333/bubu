'use strict';

import { createMemoryManagementView, KIND_LABELS, SOURCE_LABELS, TABS } from '../ui/memory-management-view.mjs';

const ERRORS = Object.freeze({
  'memory-candidate-already-reviewed': '这份建议已经存入记忆，可以在列表中查看、修改或恢复原条目。',
  'memory-source-budget': '这份建议引用的来源太多，可以在对话中缩小范围后重新提出。',
  'memory-version-conflict': '这条记忆已经变化。未应用本次修改，刷新后重新核对。',
  'memory-preview-conflict': '这次确认已失效，内容仍在，需要重新查看差异。',
  'memory-preview-expired': '确认时间已过期，内容仍在，需要重新查看差异。',
  'memory-preview-drift': '影响范围已经变化，未应用本次修改，需要重新核对。',
  'memory-duplicate': '已有同主题和范围的记忆。可以选择现有条目修改，保持它的身份。',
  'memory-source-forgotten': '这条内容的来源已被永久移除，不能重新加入。',
  'memory-authority-unavailable': '本机记忆库暂不可用；未确认任何修改。',
  'memory-undo-unavailable': '这次修改已超过撤销期限，或有了后续修改；没有撤销。',
  'memory-receipt-capacity': '记忆变更记录容量已满，已有记录会保留；本次没有新增修改。',
  'memory-capacity': '记忆容量已满。现有内容仍在，可以先整理不再需要的条目。'
});
const clone = value => structuredClone(value);
const localDate = value => Number.isFinite(value) ? new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

// This feature owns only the settings view and unsubmitted local drafts. Every
// mutation is an application-issued preview followed by exact confirmation.
function createPopoverMemoryList({ $, escapeHTML, surfaceClient, now = () => Date.now() } = {}) {
  if (typeof $ !== 'function' || typeof escapeHTML !== 'function') throw new TypeError('memory list requires $ and escapeHTML');
  if (typeof surfaceClient?.listMemories !== 'function') throw new TypeError('memory list requires surfaceClient.listMemories');
  const view = createMemoryManagementView({ $, escapeHTML, now });
  let items = [], status = 'active', nextCursor = null, loaded = false, unavailable = false;
  let busy = false, active = true, epoch = 0, mounted = false, editTarget = null, preview = null, receipt = null;
  let uncertain = false, cleanupPending = false, pendingReceiptId = null, binding = null, trigger = null;
  let historyStatus = null, undoAvailable = false, privacyMasked = false;
  let duplicateIds = [], candidateContext = null, originalExpiry = null;
  const records = new Map(), teardown = [];
  const node = id => $(`#${id}`);
  const blocked = () => uncertain || cleanupPending;
  const visible = () => active && node('settingGroupAi')?.open !== false && !node('settingsMask')?.classList.contains('hidden');
  const valid = token => token === epoch && visible();
  const say = value => view.text('memoryStatus', value);
  const known = id => records.get(id);
  function render() {
    view.list({ items, status, loaded, unavailable, nextCursor, busy, blocked: blocked() });
    view.review(privacyMasked ? null : preview, { busy, blocked: blocked(), acknowledge: Boolean(node('memoryPermanentAcknowledge')?.checked) });
    view.receipt(receipt, { historyStatus, undoAvailable, blocked: blocked() });
    view.hide('btnRetryMemoryChange', !blocked());
    view.text('btnRetryMemoryChange', cleanupPending ? '核对遗忘清理结果' : '核对这次确认的结果');
    if (node('btnRetryMemoryChange')) node('btnRetryMemoryChange').disabled = busy || cleanupPending && !pendingReceiptId;
    for (const id of ['memoryDraftKind', 'memoryDraftSubject', 'memoryDraftBody', 'memoryDraftScope', 'memoryDraftExpiry', 'memoryDraftPrivacy', 'btnCancelMemoryDraft']) {
      if (node(id)) node(id).disabled = busy || blocked();
    }
  }
  function setBusy(value) { busy = value; render(); }
  async function release(value = preview) {
    if (!value?.previewId || typeof surfaceClient.cancelMemoryChange !== 'function') return;
    try { await surfaceClient.cancelMemoryChange({ previewId: value.previewId }); } catch (_) { /* It expires without confirmation. */ }
  }
  function cancelReview({ restoreFocus = true, preserveCandidate = false } = {}) {
    if (busy || blocked()) return;
    ++epoch; void release(); preview = null; binding = null;
    if (candidateContext && !preserveCandidate) { candidateContext = null; view.hide('memoryDraft', true); }
    if (node('memoryPermanentAcknowledge')) node('memoryPermanentAcknowledge').checked = false;
    render(); if (restoreFocus) trigger?.focus?.();
  }
  async function load({ more = false, quiet = false } = {}) {
    if (node('settingGroupAi')?.open !== false && !node('settingsMask')?.classList.contains('hidden')) active = true;
    if (busy || !visible()) return;
    const token = ++epoch; setBusy(true);
    try {
      const result = await surfaceClient.listMemories({ status, limit: 20, ...(more && nextCursor ? { cursor: nextCursor } : {}) });
      if (!valid(token)) return;
      loaded = true; unavailable = result?.ok !== true || result.availability === 'unavailable' || !Array.isArray(result.items);
      if (unavailable) { items = []; nextCursor = null; say('本机记忆列表暂不可用；已有内容与状态尚未确认。'); return; }
      const page = result.items.filter(item => item.status === status && typeof item.id === 'string' && Number.isSafeInteger(item.version));
      items = [...new Map([...(more ? items : []), ...page].map(item => [item.id, clone(item)])).values()];
      for (const item of page) records.set(item.id, clone(item));
      const stale = !blocked() && preview?.before && page.some(item => item.id === preview.before.id && item.version !== preview.expectedVersion);
      if (stale) {
        void release(); preview = null; binding = null; say(ERRORS['memory-version-conflict']);
      }
      nextCursor = result.nextCursor || null;
      if (!quiet && !blocked() && !stale) say('');
    } catch (_) { if (valid(token)) { unavailable = true; loaded = true; items = []; nextCursor = null; say('本机记忆列表读取未完成，不能据此判断没有内容。'); } }
    finally { if (valid(token)) setBusy(false); }
  }
  async function selectStatus(value) {
    if (busy || !Object.hasOwn(TABS, value)) return;
    if (!blocked()) cancelReview({ restoreFocus: false });
    status = value; nextCursor = null; items = []; loaded = false; render(); await load({ quiet: blocked() });
  }
  function edit(id = null, { preserveInput = false } = {}) {
    if (busy || blocked() || unavailable) return;
    const item = id ? known(id) : null;
    if (id && !item) { say('这条记忆不在当前已读取内容中，请先打开对应状态再核对。'); return; }
    cancelReview({ restoreFocus: false });
    duplicateIds = []; view.hide('memoryDuplicates', true);
    editTarget = item ? { id: item.id, version: item.version } : null;
    view.text('memoryDraftTitle', item ? '修改这条记忆' : '记一件事');
    view.text('memoryDraftTarget', item ? `保持 ID ${item.id} · 当前版本 ${item.version}` : '先查看差异，确认后才保存');
    if (!preserveInput) fillDraft(item);
    view.hide('memoryDraft', false); node('memoryDraftSubject')?.focus();
  }
  function fillDraft(item) {
    originalExpiry = { shown: localDate(item?.expiresAt), value: item?.expiresAt ?? null };
    for (const [id, value] of Object.entries({ memoryDraftKind: item?.kind || 'preference', memoryDraftSubject: item?.subject || '',
        memoryDraftBody: item?.body || '', memoryDraftScope: item?.scope || 'global', memoryDraftExpiry: localDate(item?.expiresAt),
        memoryDraftPrivacy: item?.privacyLevel || 'standard' })) if (node(id)) node(id).value = value;
  }
  function draftInput() {
    const subject = node('memoryDraftSubject')?.value?.trim() || '', body = node('memoryDraftBody')?.value?.trim() || '';
    const expiry = node('memoryDraftExpiry')?.value || '';
    if (!subject || !body || [...subject].length > 200 || [...body].length > 500 || expiry && !Number.isFinite(Date.parse(expiry))) return null;
    const input = { kind: node('memoryDraftKind')?.value || 'preference', subject, body,
      scope: node('memoryDraftScope')?.value || 'global', expiresAt: originalExpiry?.shown === expiry ? originalExpiry.value : expiry ? Date.parse(expiry) : null,
      privacyLevel: node('memoryDraftPrivacy')?.value || 'standard' };
    if (editTarget && known(editTarget.id)?.validFrom !== undefined) input.validFrom = known(editTarget.id).validFrom;
    return input;
  }
  function acceptPreview(result, request) {
    const value = result?.preview;
    const target = value?.before?.id || value?.after?.id;
    if (!result?.ok || !value || !value.previewId || !/^[a-f0-9]{64}$/.test(value.previewHash)
      || value.operation !== request.operation || request.targetId && target !== request.targetId
      || request.expectedVersion !== undefined && value.expectedVersion !== request.expectedVersion) return false;
    preview = clone(value); receipt = null; binding = null; privacyMasked = false;
    if (node('memoryPermanentAcknowledge')) node('memoryPermanentAcknowledge').checked = false;
    say('差异已准备好，尚未保存。'); return true;
  }
  async function prepare(request) {
    if (busy || blocked() || !visible()) return;
    if (candidateContext) { candidateContext = null; view.hide('memoryDraft', true); }
    const token = ++epoch, previous = preview; preview = null; duplicateIds = []; view.hide('memoryDuplicates', true); setBusy(true);
    try {
      await release(previous);
      if (!valid(token)) return;
      const result = await surfaceClient.previewMemoryChange(request);
      if (!valid(token)) { void release(result?.preview); return; }
      if (!acceptPreview(result, request)) {
        say(ERRORS[result?.reason] || '未能准备记忆差异；内容仍在，没有确认修改。');
        if (result?.reason === 'memory-duplicate' && Array.isArray(result.duplicateIds)) {
          duplicateIds = result.duplicateIds;
          if (node('memoryDuplicates')) node('memoryDuplicates').innerHTML = '<p>选择现有条目后，会保留当前输入并重新核对替换差异。</p>'
            + duplicateIds.map(id => `<button type="button" class="chip chip-action" data-memory-replace="${escapeHTML(id)}">核对替换 ${escapeHTML(known(id)?.subject || id)}</button>`).join('');
          view.hide('memoryDuplicates', false);
        }
      }
    } catch (_) { if (valid(token)) say('差异读取未完成；内容仍在，可以重试。'); }
    finally { if (valid(token)) { setBusy(false); if (preview) node('btnConfirmMemoryChange')?.focus(); } }
  }
  async function replaceDuplicate(id) {
    if (busy || blocked() || !visible() || !duplicateIds.includes(id)) return;
    if (!known(id)) {
      const token = ++epoch; setBusy(true); let cursor = null;
      try {
        for (let page = 0; page < 5; page++) {
          const result = await surfaceClient.listMemories({ limit: 100, ...(cursor ? { cursor } : {}) });
          if (!valid(token)) return;
          if (!result?.ok || result.availability !== 'available') break;
          for (const item of result.items || []) records.set(item.id, clone(item));
          if (known(id) || !result.nextCursor) break;
          cursor = result.nextCursor;
        }
      } catch (_) { /* The original draft stays intact. */ }
      finally { if (valid(token)) setBusy(false); }
    }
    if (!visible() || !known(id)) { say('现有条目尚未完整读取，当前输入仍在；可以刷新后再核对。'); return; }
    edit(id, { preserveInput: true }); await remember();
  }
  async function reviewMemoryCandidate({ conversationId, proposalId } = {}, input) {
    if (busy || blocked() || typeof surfaceClient.previewMemoryProposal !== 'function') return;
    active = true;
    if (!visible()) return;
    const sameCandidate = candidateContext?.conversationId === conversationId && candidateContext?.proposalId === proposalId;
    const token = ++epoch, previous = preview, prior = sameCandidate ? candidateContext : null;
    preview = null; binding = null; editTarget = null;
    candidateContext = { ...prior, conversationId, proposalId };
    if (!sameCandidate) view.hide('memoryDraft', true);
    duplicateIds = []; view.hide('memoryDuplicates', true); setBusy(true);
    try {
      if (!sameCandidate) await release(previous);
      if (!valid(token)) return;
      const result = await surfaceClient.previewMemoryProposal({ conversationId, proposalId,
        ...(input ? { input } : {}), ...(sameCandidate && previous ? { replacePreviewId: previous.previewId } : {}) });
      if (!valid(token)) { void release(result?.preview); return; }
      const expected = candidatePreviewIdentity(result?.preview, prior);
      if (!expected || !acceptPreview(result, expected)) {
        void release(previous); void release(result?.preview); say(ERRORS[result?.reason] || '这条对话建议暂时不能作为记忆核对；没有保存。');
      } else {
        candidateContext = { conversationId, proposalId, ...expected };
        if (preview.permanent) view.hide('memoryDraft', true);
        else {
          fillDraft(preview.after);
          view.text('memoryDraftTitle', preview.operation === 'update' ? '核对这条记忆的修改' : '核对并修改这条对话建议');
          view.text('memoryDraftTarget', (preview.before ? `保持 ID ${preview.before.id} · 当前版本 ${preview.expectedVersion}。` : '')
            + '来源仍关联原对话建议；修改后需要重新查看差异，确认前不会保存记忆。');
          view.hide('memoryDraft', false);
        }
      }
    } catch (_) { void release(previous); if (valid(token)) say('对话记忆建议读取未完成，没有保存。'); }
    finally { if (valid(token)) { setBusy(false); if (preview) node(preview.permanent ? 'memoryPermanentAcknowledge' : input ? 'btnConfirmMemoryChange' : 'memoryDraftSubject')?.focus(); } }
  }
  function candidatePreviewIdentity(value, prior) {
    if (!value || !['add', 'update', 'permanent-remove'].includes(value.operation)) return null;
    const expected = { operation: value.operation, expectedVersion: value.expectedVersion };
    if (value.operation === 'add') {
      if (value.before != null || value.expectedVersion !== null || !value.after?.id || value.permanent) return null;
    } else {
      if (!value.before?.id || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 1
        || value.before.version !== value.expectedVersion) return null;
      expected.targetId = value.before.id;
      if (value.operation === 'update' && (value.after?.id !== value.before.id || value.permanent)) return null;
      if (value.operation === 'permanent-remove' && (value.after !== null || value.permanent !== true)) return null;
    }
    return prior?.operation && ['operation', 'targetId', 'expectedVersion'].some(key => prior[key] !== expected[key]) ? null : expected;
  }
  async function remember(event) {
    event?.preventDefault?.();
    if (busy || blocked() || !visible() || node('memoryDraft')?.classList.contains('hidden')) return;
    const input = draftInput();
    if (!input) { say('主题和内容需要完整填写，分别最多 200 字和 500 字；原文仍在。'); return; }
    if (candidateContext) return reviewMemoryCandidate(candidateContext, input);
    return prepare({ operation: editTarget ? 'update' : 'add', ...(editTarget ? { targetId: editTarget.id, expectedVersion: editTarget.version } : { expectedVersion: null }), input });
  }
  async function requestAction(operation, id, version) {
    if (busy || blocked()) return;
    const item = known(id);
    if (!item || item.version !== Number(version)) { say(ERRORS['memory-version-conflict']); return; }
    if (operation !== 'permanent-remove' && item.status === 'removed' && Number.isFinite(item.recycleUntil) && item.recycleUntil <= now()) {
      say('回收期限已过，永久清理待完成；这条记忆不能再恢复使用。'); return;
    }
    if (operation === 'edit') { edit(id); return; }
    if (!['activate', 'pause', 'remove', 'restore', 'permanent-remove'].includes(operation)) return;
    return prepare({ operation, targetId: item.id, expectedVersion: item.version });
  }
  function scrubLocal(affectedIds = []) {
    const affected = new Set(affectedIds);
    for (const id of affected) records.delete(id);
    items = items.filter(item => !affected.has(item.id));
    if (editTarget && affected.has(editTarget.id) || candidateContext?.targetId && affected.has(candidateContext.targetId)) {
      for (const id of ['memoryDraftSubject', 'memoryDraftBody', 'memoryDraftExpiry']) if (node(id)) node(id).value = '';
      editTarget = null; candidateContext = null; view.hide('memoryDraft', true);
    }
    if (duplicateIds.some(id => affected.has(id))) {
      duplicateIds = []; if (node('memoryDuplicates')) node('memoryDuplicates').innerHTML = ''; view.hide('memoryDuplicates', true);
    }
  }
  function acceptReceipt(result, expected) {
    const value = result?.receipt;
    if (!result?.ok || !value?.receiptId || value.store !== 'memory' || !value.commandId || !/^[a-f0-9]{64}$/.test(value.previewHash)
      || expected && (value.commandId !== expected.previewId || value.previewHash !== expected.previewHash
        || value.beforeVersion !== expected.expectedVersion)) return false;
    receipt = clone(value); historyStatus = result.historyStatus || null;
    if (value.permanent) scrubLocal(value.affectedIds);
    undoAvailable = !value.permanent && value.operation !== 'undo' && Number.isFinite(value.undoExpiresAt) && value.undoExpiresAt > now();
    uncertain = false; cleanupPending = result.invalidationPending === true; pendingReceiptId = cleanupPending ? value.receiptId : null;
    preview = null; binding = null; privacyMasked = false;
    say(cleanupPending ? '记忆修改已提交，相关上下文失效处理尚待完成；暂不能继续修改。' : '已收到本机提交回执。');
    return true;
  }
  function maskUncertainForget() {
    if (!preview?.permanent) return;
    scrubLocal(preview.affectedIds);
    preview = { previewId: preview.previewId, previewHash: preview.previewHash,
      expectedVersion: preview.expectedVersion, operation: preview.operation, permanent: true,
      affectedIds: [...preview.affectedIds], expiresAt: preview.expiresAt,
      before: { id: preview.before?.id, version: preview.expectedVersion }, after: null,
      invalidatedSourceRefs: [] };
    privacyMasked = true;
  }
  async function confirm({ retry = false } = {}) {
    if (busy || !visible() || cleanupPending || !preview || !retry && uncertain) return;
    if (preview.permanent && !node('memoryPermanentAcknowledge')?.checked && !retry) return;
    if (!retry) binding = { previewId: preview.previewId, previewHash: preview.previewHash, expectedVersion: preview.expectedVersion,
      ...(preview.permanent ? { permanentAcknowledged: true } : {}) };
    if (!binding) return;
    const expected = clone(binding), token = ++epoch; setBusy(true);
    let applied = false;
    try {
      const result = await surfaceClient.confirmMemoryChange(expected);
      if (!valid(token)) return;
      if (result?.retrySameIdentity || result?.outcome === 'unknown' || result?.reason === 'memory-commit-outcome-unknown') {
        uncertain = true; maskUncertainForget();
        say('提交结果尚未确认；保留这次确认，核对原结果后再继续。'); return;
      }
      if (result?.forgettingCommitted || result?.cleanupPending) {
        if (result.forgettingCommitted) { scrubLocal(preview?.affectedIds); preview = null; }
        cleanupPending = true; uncertain = false; pendingReceiptId = result.receiptId || null;
        say('永久遗忘已生效，相关正文清理仍待完成；这不是可以重新执行的普通失败。'); return;
      }
      applied = acceptReceipt(result, expected);
      if (applied) { view.hide('memoryDraft', true); editTarget = null; candidateContext = null; return; }
      if (result?.ok === false) { preview = null; binding = null; uncertain = false; say(ERRORS[result.reason] || '本次修改未确认保存；内容仍在，可以重新核对。'); }
      else { uncertain = true; maskUncertainForget(); say('提交结果尚未确认；核对同一次确认的结果后再继续。'); }
    } catch (_) { if (valid(token)) { uncertain = true; maskUncertainForget(); say('提交结果尚未确认；核对同一次确认的结果后再继续。'); } }
    finally { if (valid(token)) { setBusy(false); if (applied) void load({ quiet: true }); } }
  }
  async function refreshReceipt() {
    const receiptId = pendingReceiptId || receipt?.receiptId;
    if (busy || !visible() || !receiptId || typeof surfaceClient.getMemoryReceipt !== 'function') return;
    const token = ++epoch; setBusy(true);
    try {
      const result = await surfaceClient.getMemoryReceipt({ receiptId });
      if (!valid(token)) return;
      if (result?.receipt?.receiptId !== receiptId || !acceptReceipt(result, binding)) {
        say(cleanupPending ? '遗忘已生效，正文清理仍未确认完成；后续修改继续暂停。' : '回执读取未完成，已有提交状态没有改变。');
      }
    } catch (_) { if (valid(token)) say('回执读取未完成；待处理状态保持不变。'); }
    finally { if (valid(token)) { setBusy(false); if (!blocked()) void load({ quiet: true }); } }
  }
  async function undo() {
    if (busy || blocked() || !visible() || !receipt || !undoAvailable) return;
    const token = ++epoch, expected = { operation: 'undo', targetId: receipt.memoryId };
    setBusy(true);
    try {
      const result = await surfaceClient.previewMemoryUndo({ receiptId: receipt.receiptId });
      if (!valid(token)) { void release(result?.preview); return; }
      if (!acceptPreview(result, expected)) say(ERRORS[result?.reason] || '撤销差异暂不可用，没有撤销任何修改。');
    } catch (_) { if (valid(token)) say('撤销差异读取未完成；原修改仍在。'); }
    finally { if (valid(token)) setBusy(false); }
  }
  function close() {
    if (busy && binding) { uncertain = true; maskUncertainForget(); }
    active = false; ++epoch; busy = false;
    if (!blocked()) {
      void release(); preview = null; binding = null;
      if (candidateContext) { candidateContext = null; view.hide('memoryDraft', true); }
    }
    view.hide('memoryReview', true);
  }
  function mount() {
    if (mounted) return; mounted = true;
    const listen = (id, type, handler) => { const target = node(id); if (!target) return; target.addEventListener(type, handler); teardown.push(() => target.removeEventListener(type, handler)); };
    listen('settingGroupAi', 'toggle', event => { if (event.currentTarget.open === false) close(); else { active = true; render(); void load({ quiet: blocked() }); } });
    listen('btnSettingsClose', 'click', close);
    listen('btnSettings', 'click', () => { active = true; render(); if (node('settingGroupAi')?.open) void load({ quiet: blocked() }); });
    listen('settingsMask', 'click', event => { if (event.target === event.currentTarget) close(); });
    listen('settingsMask', 'keydown', event => { if (event.key === 'Escape') close(); });
    listen('memoryTabs', 'click', event => { const target = event.target.closest?.('[data-memory-status]'); if (target) void selectStatus(target.dataset.memoryStatus); });
    listen('memoryTabs', 'keydown', event => {
      const keys = Object.keys(TABS), index = keys.indexOf(status);
      const next = event.key === 'ArrowRight' ? (index + 1) % keys.length : event.key === 'ArrowLeft' ? (index + keys.length - 1) % keys.length : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null;
      if (next === null || busy) return;
      event.preventDefault(); node(TABS[keys[next]])?.focus(); void selectStatus(keys[next]);
    });
    listen('memoryList', 'click', event => {
      const target = event.target.closest?.('[data-memory-action]'); if (!target) return;
      trigger = target; void requestAction(target.dataset.memoryAction, target.dataset.memoryId, target.dataset.memoryVersion);
    });
    listen('memorySection', 'keydown', event => {
      if (event.key !== 'Escape' || busy || blocked() || !preview && node('memoryDraft')?.classList.contains('hidden')) return;
      event.preventDefault(); event.stopPropagation(); cancelReview(); view.hide('memoryDraft', true);
    });
    listen('btnNewMemory', 'click', () => { trigger = node('btnNewMemory'); edit(); });
    listen('btnRefreshMemories', 'click', () => void load());
    listen('btnMoreMemories', 'click', () => void load({ more: true }));
    listen('memoryDraft', 'submit', event => void remember(event));
    listen('memoryDuplicates', 'click', event => { const target = event.target.closest?.('[data-memory-replace]'); if (target) void replaceDuplicate(target.dataset.memoryReplace); });
    listen('memoryDraft', 'input', () => {
      if (!busy && !blocked() && preview) {
        cancelReview({ restoreFocus: false, preserveCandidate: true });
        say('内容已修改；重新查看差异后才能确认保存。');
      }
    });
    listen('memoryPermanentAcknowledge', 'change', render);
    listen('btnConfirmMemoryChange', 'click', () => void confirm());
    listen('btnCancelMemoryChange', 'click', () => cancelReview());
    listen('btnCancelMemoryDraft', 'click', () => { cancelReview(); view.hide('memoryDraft', true); });
    listen('btnRetryMemoryChange', 'click', () => void (cleanupPending ? refreshReceipt() : confirm({ retry: true })));
    listen('btnRefreshMemoryReceipt', 'click', () => void refreshReceipt());
    listen('btnUndoMemoryChange', 'click', () => void undo());
    const unsubscribe = surfaceClient.onPopoverHidden?.(close); if (typeof unsubscribe === 'function') teardown.push(unsubscribe);
    render();
  }
  function dispose() { close(); while (teardown.length) teardown.pop()(); mounted = false; records.clear(); }
  return Object.freeze({ mount, dispose, close, load, render, selectStatus, edit, remember, requestAction, confirm, undo,
    refreshReceipt, cancelReview, reviewMemoryCandidate, replaceDuplicate, isPendingClear: () => false });
}

export { createPopoverMemoryList, KIND_LABELS, SOURCE_LABELS };
