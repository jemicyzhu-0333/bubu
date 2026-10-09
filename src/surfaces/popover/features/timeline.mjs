'use strict';

import { buildTimelineStory } from './timeline-story.mjs';
import { renderTimelineReceipt } from './timeline-receipt-view.mjs';
import { createTimelineMoodDeletion } from './timeline-mood-deletion.mjs';


function createPopoverTimelineFeature({
  document, $, surfaceClient, getState, escapeHTML, formatMs, onContinueConversation, moodDeletion: sharedMoodDeletion = null
} = {}) {
  if (!document || typeof $ !== 'function' || !surfaceClient || typeof getState !== 'function'
      || typeof escapeHTML !== 'function' || typeof formatMs !== 'function') {
    throw new TypeError('timeline feature requires its scoped renderer dependencies');
  }

  let requestedDayKey = null;
  let readVersion = 0;
  let boundHost = null;
  let activeItem = null;
  let unsubscribe = null;
  let unsubscribeHidden = null;
  let unsubscribeDeletion = null;
  let nativeHidden = false;
  let selectedFilter = 'all';
  let loadedDay = null;
  let loadedCurve = null;
  let detailVersion = 0;
  const listeners = [];
  const moodDeletion = sharedMoodDeletion || createTimelineMoodDeletion({
    sendDelete: id => surfaceClient.deleteMoodNote(id),
    hasMood: id => (getState()?.moodNotes || []).some(note => note.id === id),
    refresh: dayKey => requestedDayKey === dayKey ? showDay(dayKey) : undefined
  });

  function resetMoodDeleteArming() {
    moodDeletion.resetArming();
    for (const button of $('#timelineTrack')?.querySelectorAll?.('.tl-del') || []) {
      button.textContent = '删除'; delete button.dataset.armed;
    }
  }

  function renderMoodDeletion(view) {
    const host = $('#timelineDeleteStatus');
    if (!host) return;
    const panel = $('#panelProgress');
    const visible = !nativeHidden && !document.hidden && panel?.hidden !== true && panel?.getAttribute?.('aria-hidden') !== 'true';
    host.setAttribute?.('aria-live', visible ? 'polite' : 'off');
    host.classList.toggle('hidden', !view.phase);
    host.setAttribute?.('aria-busy', view.busy ? 'true' : 'false');
    const labels = { sending: '正在删除', refused: '来源暂不可用，这次未删除',
      partial: '来源清理尚未完成', unknown: '删除结果尚待核对',
      complete: view.alreadyAbsent ? '这条记录与来源已不在应用记录中' : '记录与来源已删除' };
    const label = $('#timelineDeleteLabel');
    if (label) label.textContent = view.phase ? `${view.dayKey || ''} · ${labels[view.phase]}` : '';
    const retry = $('#timelineDeleteRetry'), dismiss = $('#timelineDeleteDismiss');
    if (retry) {
      retry.disabled = view.busy;
      retry.classList.toggle('hidden', !view.canRetry);
      retry.textContent = view.phase === 'partial' ? '继续清理' : view.phase === 'unknown' ? '重试核对' : '重试删除';
    }
    if (dismiss) dismiss.classList.toggle('hidden', !view.canDismiss);
    const masked = maskedMoodId(view);
    for (const button of $('#timelineTrack')?.querySelectorAll?.('.tl-del') || []) {
      button.disabled = Boolean(view.phase && view.phase !== 'complete');
      button.textContent = view.armedMoodId === button.dataset.moodId && !view.armedSourceId ? '确定删除？' : '删除';
      if (masked === button.dataset.moodId) button.closest?.('.tl-row')?.remove();
    }
    if (masked && activeItem?.getAttribute?.('data-row-id') === masked) hideDetail();
  }

  function maskedMoodId(view = moodDeletion.view()) {
    return ['partial', 'unknown', 'complete'].includes(view.phase) ? view.moodId : null;
  }
  function visibilityChanged() {
    nativeHidden = false;
    if ($('#panelProgress')?.hidden) resetMoodDeleteArming();
    renderMoodDeletion(moodDeletion.view());
  }
  function refreshMoodDeletion(dayKey) {
    return requestedDayKey === dayKey ? showDay(dayKey) : undefined;
  }

  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  function hideDetail({ restoreFocus = false } = {}) {
    detailVersion += 1;
    if (restoreFocus) activeItem?.focus?.();
    activeItem?.setAttribute?.('aria-expanded', 'false');
    if (activeItem && activeItem.classList) activeItem.classList.remove('active');
    activeItem = null;
    const detail = $('#timelineDetail');
    if (!detail) return;
    detail.textContent = '';
    if (detail.classList) detail.classList.add('hidden');
  }

  function showDetail(item) {
    const text = item && typeof item.getAttribute === 'function' ? item.getAttribute('data-detail') : '';
    if (!text) { hideDetail(); return; }
    detailVersion += 1;
    if (activeItem && activeItem !== item && activeItem.classList) {
      activeItem.classList.remove('active');
      activeItem.setAttribute?.('aria-expanded', 'false');
    }
    if (item.classList) item.classList.add('active');
    activeItem = item;
    item.setAttribute?.('aria-expanded', 'true');
    const detail = $('#timelineDetail');
    if (!detail) return;
    detail.textContent = text;
    const receiptId = item.getAttribute?.('data-receipt-id');
    if (receiptId && typeof surfaceClient.getChangeReceipt === 'function' && document.createElement) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = '查看变更';
      button.setAttribute('data-open-receipt', receiptId);
      detail.appendChild(button);
    }
    if (detail.classList) detail.classList.remove('hidden');
  }

  async function openReceipt(button) {
    const receiptId = button?.getAttribute?.('data-open-receipt');
    if (!receiptId || button.disabled || !activeItem || typeof surfaceClient.getChangeReceipt !== 'function') return;
    const version = ++detailVersion;
    const row = activeItem;
    button.disabled = true; button.textContent = '正在读取变更';
    let response;
    try { response = await surfaceClient.getChangeReceipt({ receiptId }); } catch (_) { response = null; }
    if (version !== detailVersion || activeItem !== row || !requestedDayKey) return;
    if (!response?.ok || response.receiptId !== receiptId || response.receipt?.receiptId !== receiptId) {
      button.disabled = false; button.textContent = '暂时无法读取，重试'; return;
    }
    button.textContent = '变更详情';
    renderTimelineReceipt({ document, host: $('#timelineDetail'), response, onContinueConversation });
  }

  function renderEmpty(dayKey) {
    const root = $('#timelineDay');
    if (!root) return;
    root.classList.remove('hidden');
    root.classList.add('is-empty');
    const title = $('#timelineTitle');
    if (title) title.textContent = dayKey;
    const totals = $('#timelineTotals');
    if (totals) totals.textContent = '';
    const guide = $('#timelineGuide');
    if (guide) guide.textContent = '';
    const track = $('#timelineTrack');
    if (track) {
      track.innerHTML = '';
      if (track.style) {
        track.style.width = '';
        track.style.height = '';
      }
    }
    const detail = $('#timelineDetail');
    if (detail) {
      detail.textContent = '暂时无法读取活动记录';
      if (detail.classList) detail.classList.remove('hidden');
    }
    activeItem = null;
    detailVersion += 1;
  }

  function filterMarkup() {
    return '<div class="tl-filters" role="group" aria-label="活动类型">'
      + [['all', '全部'], ['focus', '专注'], ['task', '任务'], ['inbox', '收件'], ['routine', '日常'], ['ai', 'AI 变更']]
        .map(([id, label]) => `<button type="button" data-tl-filter="${id}" aria-pressed="${id === selectedFilter}">${label}</button>`).join('') + '</div>';
  }
  function rows() { return Array.from($('#timelineTrack')?.querySelectorAll?.('.tl-event') || []); }
  function scrollPositions() {
    const nodes = new Set([document.scrollingElement]);
    for (let node = $('#timelineViewport'); node; node = node.parentElement) nodes.add(node);
    return [...nodes].filter(Boolean).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  }

  function renderDay(day, energyCurve = null, { preserveScroll = false } = {}) {
    resetMoodDeleteArming();
    const root = $('#timelineDay');
    if (!root) return;
    const noRecords = day && day.rangeStart === null && day.rangeEnd === null;
    const validRange = day && Number.isFinite(day.rangeStart) && Number.isFinite(day.rangeEnd)
      && day.rangeEnd > day.rangeStart;
    if (!day || !Number.isFinite(day.dayStart) || !Number.isFinite(day.dayEnd)
        || day.dayEnd <= day.dayStart || (!noRecords && !validRange)) {
      renderEmpty(day && day.dayKey ? day.dayKey : requestedDayKey || '');
      return;
    }
    loadedDay = day; loadedCurve = energyCurve;
    const selectedRow = preserveScroll ? activeItem?.getAttribute?.('data-row-id') : null;
    const restoreRowFocus = preserveScroll && (document.activeElement === activeItem
      || $('#timelineDetail')?.contains?.(document.activeElement));
    const positions = preserveScroll ? scrollPositions() : [];
    root.classList.remove('hidden');
    root.classList.remove('is-empty');

    const title = $('#timelineTitle');
    if (title) title.textContent = day.dayKey;
    const totalsNode = $('#timelineTotals');

    const state = getState() || {}, masked = maskedMoodId();
    const story = buildTimelineStory({ day, energyCurve, state: masked
      ? { ...state, moodNotes: (state.moodNotes || []).filter(note => note.id !== masked) } : state,
    escapeHTML, formatMs, filter: selectedFilter });
    if (totalsNode) totalsNode.textContent = story.entryCount ? `${story.entryCount} 条活动 · 专注 ${formatMs(day.totals?.focusMs || 0)}` : ''; 
    const guide = $('#timelineGuide');
    if (guide) guide.textContent = `${energyCurve ? '' : story.energyLabel + ' · '}记录覆盖仅代表已保存的活动`;

    const track = $('#timelineTrack');
    if (track) track.innerHTML = filterMarkup() + story.markup;
    renderMoodDeletion(moodDeletion.view());
    hideDetail();
    const restored = selectedRow ? rows().find(row => row.getAttribute('data-row-id') === selectedRow) : null;
    if (restored) { showDetail(restored); if (restoreRowFocus) restored.focus?.({ preventScroll: true }); }
    for (const position of positions) {
      if (Number.isFinite(position.top)) position.node.scrollTop = position.top;
      if (Number.isFinite(position.left)) position.node.scrollLeft = position.left;
    }
  }
  function hide() {
    resetMoodDeleteArming();
    requestedDayKey = null;
    loadedDay = null; loadedCurve = null;
    hideDetail();
    readVersion += 1;
    const root = $('#timelineDay');
    if (!root) return;
    root.classList.add('hidden');
    root.classList.remove('is-empty');
  }

  async function showDay(dayKey) {
    if (!dayKey) {
      hide();
      return;
    }
    const preserveScroll = requestedDayKey === dayKey;
    if (!preserveScroll) { selectedFilter = 'all'; resetMoodDeleteArming(); hideDetail(); }
    requestedDayKey = dayKey;
    const currentRead = ++readVersion;
    let response = null;
    try {
      response = await surfaceClient.getTimelineDay(dayKey);
    } catch {
      // 事实存储出问题不该把进展页拖黑:退回空态,专注计时与任务操作一个都不受影响。
      response = null;
    }
    if (requestedDayKey !== dayKey || readVersion !== currentRead) return;
    const ok = Boolean(response) && response.ok === true;
    const day = ok ? response.day : null;
    if (!day || day.dayKey !== dayKey) {
      renderEmpty(dayKey);
      return;
    }
    renderDay(day, response.energyCurve, { preserveScroll });
  }

  function mount(projectionStore) {
    if (!unsubscribe && projectionStore && typeof projectionStore.subscribe === 'function') {
      unsubscribe = projectionStore.subscribe(change => {
        if (!requestedDayKey) return;
        const dirty = change.dirty || {};
        if (dirty.all || dirty.settings || dirty.energy || dirty.wellbeing || dirty.stats || dirty.routines || dirty.timeline
            || dirty.tasks || dirty.archivedTasks) {
          showDay(requestedDayKey);
        }
      });
    }
    const root = $('#timelineDay');
    if (!root || boundHost === root) return;
    boundHost = root;
    unsubscribeDeletion = moodDeletion.subscribe(renderMoodDeletion);
    unsubscribeHidden = surfaceClient.onPopoverHidden?.(() => {
      nativeHidden = true; resetMoodDeleteArming(); renderMoodDeletion(moodDeletion.view());
    }) || null;
    listen(document.defaultView, 'focus', visibilityChanged);
    listen(document, 'visibilitychange', () => {
      nativeHidden = Boolean(document.hidden);
      if (document.hidden) resetMoodDeleteArming();
      renderMoodDeletion(moodDeletion.view());
    });
    // 竖版时间线：每一行都是按钮，点一下看细节，再点空白处收起。
    listen($('#timelineViewport'), 'click', event => {
      if (!event.target || typeof event.target.closest !== 'function') return;
      const filter = event.target.closest('[data-tl-filter]');
      const filterId = filter?.getAttribute?.('data-tl-filter');
      if (['all', 'focus', 'task', 'inbox', 'routine', 'ai'].includes(filterId) && loadedDay) {
        selectedFilter = filterId;
        renderDay(loadedDay, loadedCurve, { preserveScroll: true });
        return;
      }
      // 情绪记录的删除：第一下变成“确定删除？”，第二下才删。是本人留的，也只有本人能删。
      const del = event.target.closest('.tl-del');
      if (del && del.dataset && del.dataset.moodId) {
        const phase = moodDeletion.activate(del.dataset.moodId, requestedDayKey);
        if (phase === 'armed') {
          for (const button of $('#timelineTrack')?.querySelectorAll?.('.tl-del') || []) {
            button.textContent = '删除'; delete button.dataset.armed;
          }
          del.textContent = '确定删除？'; del.dataset.armed = '1';
        } else if (phase === 'sending') {
          del.textContent = '删除'; delete del.dataset.armed;
        }
        return;
      }
      const item = event.target.closest('.tl-seg, .tl-event, .tl-task-complete');
      if (!item || item === activeItem) { hideDetail(); return; }
      showDetail(item);
    });
    listen($('#timelineViewport'), 'keydown', event => {
      if (event.key === 'Escape') { resetMoodDeleteArming(); event.preventDefault?.(); hideDetail({ restoreFocus: true }); return; }
      const item = event.target?.closest?.('.tl-event');
      if (!item) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault?.();
        if (item === activeItem) hideDetail(); else showDetail(item);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = rows(), index = items.indexOf(item);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        event.preventDefault?.(); items[next]?.focus?.();
      }
    });
    listen($('#timelineDeleteRetry'), 'click', () => moodDeletion.retry());
    listen($('#timelineDeleteDismiss'), 'click', () => moodDeletion.dismiss());
    listen($('#timelineDetail'), 'click', event => {
      const button = event.target?.closest?.('[data-open-receipt]');
      if (button) void openReceipt(button);
    });
    listen($('#timelineDetail'), 'keydown', event => {
      if (event.key === 'Escape') { resetMoodDeleteArming(); event.preventDefault?.(); hideDetail({ restoreFocus: true }); }
    });
  }

  function dispose() {
    unsubscribeDeletion?.(); unsubscribeDeletion = null;
    if (!sharedMoodDeletion) moodDeletion.dispose();
    if (typeof unsubscribeHidden === 'function') unsubscribeHidden();
    unsubscribeHidden = null;
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    for (const { target, type, handler } of listeners) target.removeEventListener(type, handler);
    listeners.length = 0;
    boundHost = null;
    requestedDayKey = null;
    readVersion += 1;
    activeItem = null;
    loadedDay = null; loadedCurve = null; detailVersion += 1;
  }

  return Object.freeze({ mount, dispose, showDay, renderDay, hide, visibilityChanged, refreshMoodDeletion });
}

export { createPopoverTimelineFeature };
