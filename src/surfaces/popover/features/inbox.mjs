import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
import { CATEGORIES, classificationOf, effectiveClassification } from './inbox-triage.mjs';
import { inboxCard, repaintInboxCard } from './inbox-card.mjs';
import { createInboxHistory } from './inbox-history.mjs';

const ERRORS = {
  'impulse-not-found': '这条收件已经处理，列表已更新。',
  'impulse-category-changed': '分类已改变，请重新确认操作。',
  'routine-kind-required': '先选择日常类型。',
  'routine-choice-required': '请选择记录到哪一条日常，或新建日常。',
  'routine-not-found': '所选日常已经改变，请重新选择。',
  'title-required': '请为这件日常填写名称。',
  'routine-limit': '日常数量已满，可以先移除不再需要的日常。',
  'day-full': '这一天的记录已满，原文仍留在收件箱。',
  'capture-too-old-for-log': '这条记录已超过日常打卡的时间范围，可以选择“只留存”。',
  'energy-level-required': '先选择当时的能量状态。',
  'newer-check-in-exists': '已有更新的状态记录；这条内容可以选择“只留存”。'
};
const MISSING_FIELDS = Object.freeze({ kind: '.inbox-kind', routine: '.inbox-routine', title: '.inbox-title', level: '.inbox-level' });
const EDITORS = Object.freeze(['.inbox-category', '.inbox-kind', '.inbox-level', '.inbox-routine', '.inbox-title']);
const KEEP_ALL_LIMIT = 100;
const KEEP_ALL_CONFIRM_MS = 5000;

function createPopoverInboxFeature({ document, $, getState, escapeHTML, surfaceClient, openBreakdown, moodDeletion }) {
  // Drafts hold what a person picked on a card but has not committed: choosing a label
  // never writes by itself, so browsing a select with the arrow keys is harmless.
  const rows = new Map(), drafts = new Map(), cleanup = [];
  let scope = 'pending', category = '', disposed = false, hidden = false;
  const history = createInboxHistory({ readPage: input => surfaceClient.getInboxHistory(input), onChange: draw });
  let busy = false, keepAllArmed = null;
  const draftOf = id => drafts.get(id) || {};
  const visible = () => !hidden && !document.hidden && !$('#panelInbox')?.hidden && $('#panelInbox')?.getAttribute?.('aria-hidden') !== 'true';
  const sourceMasked = item => {
    const operation = moodDeletion?.view();
    return operation?.phase && operation.phase !== 'refused' && item.resolution?.action === 'feeling' && item.resolution.targetId === operation.moodId;
  };
  const findHistorySource = id => { const item = history.findSource(id); return item && !sourceMasked(item) ? item : null; };
  function patchDraft(id, patch) { drafts.set(id, { ...draftOf(id), ...patch }); }
  let statusCopy = () => '';
  function status(message = '') {
    statusCopy = typeof message === 'function' ? message : () => t(message);
    $('#inboxStatus').textContent = statusCopy();
    $('#inboxStatus').classList.toggle('hidden', !message);
  }
  function pendingItems() {
    const pending = getState()?.impulses || [];
    return pending.filter(item => !category || effectiveClassification(item, draftOf(item.id)).category === category);
  }
  function focusedEditor(row) {
    const active = row.contains(document.activeElement) ? document.activeElement : null;
    if (!active) return null;
    if (active.matches('.inbox-triage-help summary')) return '.inbox-triage-help summary';
    const editor = EDITORS.find(selector => active.matches(selector));
    if (editor) return editor;
    const action = active.dataset?.inboxAction || active.dataset?.inboxPick;
    return action ? `[data-inbox-action="${action}"],[data-inbox-pick="${action}"]` : null;
  }
  function drawCard(item, state, entry) {
    const draft = draftOf(item.id);
    // Typing a name already shows in the DOM; it never forces a redraw.
    const { title: _title, ...shape } = draft;
    const key = JSON.stringify([item, state.routines?.items, state.moodNotes?.map(note => note.id), shape]);
    if (key === entry.key) return;
    const optionsOpen = entry.row.querySelector('.inbox-options')?.open;
    const focus = focusedEditor(entry.row);
    const active = document.activeElement;
    const selection = focus && Number.isInteger(active?.selectionStart)
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    entry.key = key; entry.copy = { item, state, draft: scope === 'history' ? undefined : draft };
    entry.row.classList.toggle('inbox-card-history', Boolean(item.resolution));
    entry.row.innerHTML = inboxCard(item, state, escapeHTML, scope === 'history' ? undefined : draft);
    const more = entry.row.querySelector('.inbox-options');
    if (more) more.open = Boolean(optionsOpen);
    if (focus && !busy && visible()) {
      const target = entry.row.querySelector(focus);
      target?.focus();
      if (selection) target?.setSelectionRange?.(...selection);
    }
  }
  function drawKeepAll(items) {
    const button = $('#inboxKeepAll');
    if (!button) return;
    const count = Math.min(items.length, KEEP_ALL_LIMIT);
    button.classList.toggle('hidden', scope !== 'pending' || count < 2);
    button.textContent = keepAllArmed ? t('确认留存 {count} 条', { count }) : t('全部留存');
    button.classList.toggle('chip-action', Boolean(keepAllArmed));
  }
  function draw() {
    const state = getState();
    if (!state || disposed) return;
    $('#inboxStatus').setAttribute('aria-live', visible() ? 'polite' : 'off');
    $('#tabImpCount').textContent = (state.impulses || []).length;
    history.acceptCount(state.inboxHistoryTotal, state.inboxHistoryCountVersion);
    const page = history.view();
    $('#inboxHistoryCount').textContent = page.globalTotal === null ? t('暂不可用') : String(page.globalTotal);
    const items = scope === 'history' ? page.items.filter(item => !sourceMasked(item)) : pendingItems();
    const ids = new Set(items.map(item => item.id));
    for (const [id, entry] of rows) if (!ids.has(id)) { entry.row.remove(); rows.delete(id); }
    for (const id of drafts.keys()) if (!(state.impulses || []).some(item => item.id === id)) drafts.delete(id);
    const list = $('#impulseList');
    items.forEach((item, index) => {
      let entry = rows.get(item.id);
      if (!entry) {
        const row = document.createElement('article');
        row.className = 'inbox-card'; row.dataset.impulseId = item.id;
        entry = { row, key: '' }; rows.set(item.id, entry);
      }
      drawCard(item, state, entry);
      if (list.children[index] !== entry.row) list.insertBefore(entry.row, list.children[index] || null);
    });
    $('#emptyImpulses').classList.toggle('hidden', items.length !== 0 || (scope === 'history' && (page.loading || page.available !== true || page.items.length > 0)));
    $('#inboxEmptyTitle').textContent = t(scope === 'history' ? '还没有这类历史记录' : category ? '这个分类下没有待整理的收件' : '没有待整理的收件');
    $('#inboxLoadMore').classList.toggle('hidden', scope !== 'history' || !page.nextCursor || page.available !== true);
    $('#inboxLoadMore').disabled = page.loading;
    drawHistoryStatus(page);
    drawMoodDeletion(moodDeletion?.view());
    document.querySelectorAll('[data-inbox-scope]').forEach(button => {
      const selected = button.dataset.inboxScope === scope;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    drawKeepAll(items);
    for (const [id, entry] of rows) {
      const button = entry.row.querySelector('[data-inbox-action="delete-mood-source"]');
      if (button) {
        const deletion = moodDeletion?.view();
        button.textContent = t(deletion?.armedSourceId === id ? '确认删除这条情绪的全部关联原文' : '删除关联来源');
        button.disabled = !moodDeletion || !findHistorySource(id) || (Boolean(deletion?.phase) && deletion.phase !== 'complete');
      }
    }
    if (busy) list.querySelectorAll('button,select,input').forEach(node => { node.disabled = true; });
    else list.querySelectorAll('[data-inbox-needs-choice]').forEach(node => { node.disabled = true; });
  }
  function drawHistoryStatus(page) {
    const host = $('#inboxHistoryStatus'), label = $('#inboxHistoryLabel'), retry = $('#inboxHistoryRetry');
    if (!host || !label || !retry) return;
    const message = page.loading ? '正在读取历史记录' : page.available === false
      ? page.items.length ? '部分历史暂不可用，当前显示已读取的记录。' : '历史记录暂不可用。' : '';
    host.classList.toggle('hidden', scope !== 'history' || !message);
    host.setAttribute('aria-live', visible() && scope === 'history' ? 'polite' : 'off');
    label.textContent = t(message);
    retry.classList.toggle('hidden', !page.canRetry); retry.disabled = page.loading;
  }
  function drawMoodDeletion(view) {
    const host = $('#inboxDeleteStatus');
    if (!host) return;
    host.classList.toggle('hidden', !view?.phase);
    host.setAttribute('aria-live', visible() ? 'polite' : 'off');
    host.setAttribute('aria-busy', view?.busy ? 'true' : 'false');
    const labels = { sending: '正在删除', refused: '来源暂不可用，这次未删除', partial: '来源清理尚未完成',
      unknown: '删除结果尚待核对', complete: view?.alreadyAbsent ? '这条记录与来源已不在应用记录中' : '记录与来源已删除' };
    $('#inboxDeleteLabel').textContent = view?.phase ? `${view.dayKey || ''} · ${t(labels[view.phase])}` : '';
    const retry = $('#inboxDeleteRetry');
    retry.disabled = Boolean(view?.busy); retry.classList.toggle('hidden', !view?.canRetry);
    retry.textContent = t(view?.phase === 'partial' ? '继续清理' : view?.phase === 'unknown' ? '重试核对' : '重试删除');
    $('#inboxDeleteDismiss').classList.toggle('hidden', !view?.canDismiss);
  }
  function loadHistory(append = false) { moodDeletion?.resetArming(); return history.load(append); }
  function renderList() { draw(); if (scope === 'history' && visible()) void loadHistory(); }
  function hide() { closeOptions(); hidden = true; moodDeletion?.resetArming(); history.suspend(); draw(); }
  function visibilityChanged() {
    hidden = Boolean(document.hidden);
    if (hidden) hide(); else renderList();
  }

  // A missing input receives focus without hiding or expanding the whole card.
  function revealMissing(row) {
    const details = row.querySelector('.inbox-details');
    const field = details && MISSING_FIELDS[details.dataset.missing];
    if (!field || (field === '.inbox-title' && row.querySelector(field)?.value.trim())) return false;
    row.querySelector(field)?.focus();
    status('补上这一项后就能保存。');
    return true;
  }
  function organizePayload(item, action, row) {
    const draft = draftOf(item.id);
    const c = effectiveClassification(item, draft);
    const labelled = action !== 'keep' || Boolean(draft.category);
    const payload = { id: item.id, action, ...(labelled ? { category: c.category, routineKind: c.routineKind, level: c.level } : {}) };
    if (!['routine', 'log'].includes(action)) return payload;
    const destination = row.querySelector('.inbox-routine')?.value || '';
    return { ...payload, title: row.querySelector('.inbox-title')?.value.trim() || '',
      routineId: destination && destination !== 'new' ? destination : null, createNew: destination === 'new' };
  }
  async function send(item, action, row) {
    if (action === 'delete') return surfaceClient.deleteImpulse(item.id);
    if (['next-step', 'schedule', 'feeling'].includes(action)) {
      // The destination owns final classification in the same business transaction.
      return action === 'feeling' ? surfaceClient.keepMoodNote(item.id) : surfaceClient.reviewImpulse(item.id, action);
    }
    return surfaceClient.organizeImpulse(organizePayload(item, action, row));
  }
  async function perform(row, action) {
    if (busy) return;
    const id = row.dataset.impulseId;
    const item = [...(getState()?.impulses || []), ...history.view().items].find(candidate => candidate.id === id);
    if (!item) return;
    if (['routine', 'log', 'state'].includes(action) && revealMissing(row)) return;
    busy = true; status(); draw();
    try {
      const result = await send(item, action, row);
      if (disposed) return;
      if (!result?.ok) status(ERRORS[result?.reason] || '没有保存成功，原文仍在，请稍后重试。');
      else {
        drafts.delete(id);
        if (action === 'delete') history.invalidateId(id);
        if (scope === 'history') await loadHistory();
        if (result.task && action === 'next-step') openBreakdown(result.task);
      }
    } catch {
      if (!disposed) status('连接暂时中断，原文仍在，请稍后重试。');
    } finally {
      busy = false;
      for (const entry of rows.values()) entry.row.querySelectorAll('button,select,input').forEach(node => { node.disabled = false; });
      draw();
      if (!disposed && visible() && (document.activeElement === document.body || !document.activeElement || row.contains(document.activeElement))) {
        const surviving = rows.get(id)?.row;
        const requested = surviving?.querySelector(`[data-inbox-action="${action}"]`);
        const focus = (requested?.closest('.inbox-options') ? surviving.querySelector('.inbox-options > summary') : requested)
          || $('#impulseList').querySelector('.inbox-card-actions [data-inbox-action]:not(:disabled)')
          || $('#impulseList').querySelector('.inbox-options > summary')
          || document.querySelector('[data-inbox-scope].active');
        focus?.focus();
      }
    }
  }
  function onEdit(event) {
    const row = event.target.closest('[data-impulse-id]');
    if (!row || busy) return;
    const id = row.dataset.impulseId;
    const value = event.target.value;
    if (event.target.matches('.inbox-category')) {
      const stored = classificationOf((getState()?.impulses || []).find(item => item.id === id) || {});
      if (value === stored.category) drafts.set(id, { title: draftOf(id).title });
      else patchDraft(id, { category: value, routineKind: null, level: null, routineId: undefined });
    } else if (event.target.matches('.inbox-kind')) patchDraft(id, { routineKind: value || null, routineId: undefined });
    else if (event.target.matches('.inbox-level')) patchDraft(id, { level: value ? Number(value) : null });
    else if (event.target.matches('.inbox-routine')) patchDraft(id, { routineId: value });
    else return;
    status(); draw();
  }
  function closeOptions(except = null) {
    for (const { row } of rows.values()) {
      const options = row.querySelector('.inbox-options');
      if (options && options !== except) options.open = false;
    }
  }
  function onClick(event) {
    const row = event.target.closest('[data-impulse-id]');
    if (!row) return;
    const pick = event.target.closest('[data-inbox-pick]')?.dataset.inboxPick;
    if (pick && CATEGORIES[pick] && !busy) {
      const item = (getState()?.impulses || []).find(candidate => candidate.id === row.dataset.impulseId);
      const suggested = item ? classificationOf(item) : {};
      patchDraft(row.dataset.impulseId, { category: pick, routineKind: suggested.routineKind ?? null, level: suggested.level ?? null });
      status(); draw();
      row.querySelector('.inbox-card-actions [data-inbox-action]')?.focus();
      return;
    }
    const action = event.target.closest('[data-inbox-action]')?.dataset.inboxAction;
    if (action) closeOptions();
    if (action === 'delete-mood-source') {
      if (busy || !moodDeletion) return;
      const item = findHistorySource(row.dataset.impulseId);
      if (!item) return;
      const date = new Date(item.createdAt);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      moodDeletion.activateSource(item.id, item.resolution?.targetId, day);
      return;
    }
    if (action) void perform(row, action);
  }
  async function keepAll() {
    const ids = pendingItems().slice(0, KEEP_ALL_LIMIT).map(item => item.id);
    if (busy || ids.length < 2) return;
    if (!keepAllArmed) {
      // Two deliberate clicks: nothing is deleted, but every capture leaves the pending list.
      keepAllArmed = setTimeout(() => { keepAllArmed = null; draw(); }, KEEP_ALL_CONFIRM_MS);
      draw();
      return;
    }
    clearTimeout(keepAllArmed); keepAllArmed = null;
    busy = true; status(); draw();
    try {
      const result = await surfaceClient.keepAllImpulses(ids);
      if (!disposed) status(() => result?.ok ? t('已留存 {count} 条，可在历史记录中查看。', { count: result.kept }) : t('没有保存成功，原文仍在，请稍后重试。'));
      if (result?.ok) ids.forEach(id => drafts.delete(id));
    } catch { if (!disposed) status('连接暂时中断，原文仍在，请稍后重试。'); }
    finally {
      busy = false;
      for (const entry of rows.values()) entry.row.querySelectorAll('button,select,input').forEach(node => { node.disabled = false; });
      draw();
    }
  }
  function listen(node, type, handler, options) { node?.addEventListener?.(type, handler, options); cleanup.push(() => node?.removeEventListener?.(type, handler, options)); }
  function mount() {
    $('#inboxCategoryFilter').innerHTML = `<option value="" data-i18n="全部分类">${t('全部分类')}</option>` + Object.entries(CATEGORIES).map(([value, label]) => `<option value="${value}" data-i18n="${label}">${t(label)}</option>`).join('');
    cleanup.push(onLocaleChanged(() => {
      if (disposed) return;
      // No history reads, arming reset, DOM rebuild or command on language changes.
      draw();
      for (const entry of rows.values()) if (entry.copy) {
        const { item, state, draft } = entry.copy; repaintInboxCard(entry.row, item, state, draft);
      }
      $('#inboxStatus').textContent = statusCopy();
    }));
    listen($('#inboxCategoryFilter'), 'change', event => {
      category = event.target.value; moodDeletion?.resetArming(); history.setScope(scope, category); status(); renderList();
    });
    for (const button of document.querySelectorAll('[data-inbox-scope]')) listen(button, 'click', () => {
      scope = button.dataset.inboxScope; moodDeletion?.resetArming(); history.setScope(scope, category); status(); renderList();
    });
    listen($('#inboxKeepAll'), 'click', () => { void keepAll(); });
    listen($('#impulseList'), 'click', onClick);
    listen($('#impulseList'), 'change', onEdit);
    listen($('#impulseList'), 'keydown', event => {
      if (event.key !== 'Escape') return;
      moodDeletion?.resetArming();
      const disclosure = event.target.closest('details[open]');
      if (disclosure) { disclosure.open = false; disclosure.querySelector('summary').focus(); event.stopPropagation(); }
    });
    // Native disclosure keyboard semantics, with a single anchored action panel.
    listen($('#impulseList'), 'toggle', event => {
      if (event.target.matches('.inbox-options') && event.target.open) closeOptions(event.target);
    }, true);
    listen(document, 'pointerdown', event => {
      if (!event.target.closest?.('.inbox-options')) closeOptions();
    });
    listen(document, 'focusin', event => {
      if (!event.target.closest?.('.inbox-options')) closeOptions();
    });
    listen($('#impulseList'), 'input', event => {
      if (!event.target.matches('.inbox-title')) return;
      const row = event.target.closest('[data-impulse-id]'), id = row.dataset.impulseId;
      patchDraft(id, { title: event.target.value });
      const entry = rows.get(id);
      if (entry?.copy) {
        entry.copy.draft = draftOf(id);
        repaintInboxCard(row, entry.copy.item, entry.copy.state, entry.copy.draft);
      }
    });
    listen($('#inboxLoadMore'), 'click', () => { void loadHistory(true); });
    listen($('#inboxHistoryRetry'), 'click', () => { void loadHistory(); });
    listen($('#inboxDeleteRetry'), 'click', () => moodDeletion?.retry());
    listen($('#inboxDeleteDismiss'), 'click', () => moodDeletion?.dismiss());
    listen(document, 'visibilitychange', visibilityChanged);
    listen(document.defaultView, 'focus', visibilityChanged);
    const unsubscribeHidden = surfaceClient.onPopoverHidden?.(hide);
    if (typeof unsubscribeHidden === 'function') cleanup.push(unsubscribeHidden);
    const unsubscribeDeletion = moodDeletion?.subscribe(view => {
      if (['partial', 'unknown'].includes(view.phase)) history.invalidateMoodSource(view.moodId);
      draw();
    });
    if (typeof unsubscribeDeletion === 'function') cleanup.push(unsubscribeDeletion);
  }
  return Object.freeze({ mount, renderList, hide, visibilityChanged, findHistorySource,
    invalidateMoodSource(id) {
      history.invalidateMoodSource(id);
      if (scope === 'history' && visible()) void loadHistory();
    }, dispose() {
    disposed = true; history.dispose(); clearTimeout(keepAllArmed); keepAllArmed = null;
    cleanup.splice(0).forEach(remove => remove()); rows.clear(); drafts.clear();
  } });
}
export { createPopoverInboxFeature };
