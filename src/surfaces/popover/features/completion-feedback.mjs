import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

function createPopoverCompletionFeedback({ document, $, celebrate, timers = globalThis, surfaceClient = null } = {}) {
  if (!document || typeof $ !== 'function' || typeof celebrate !== 'function') {
    throw new TypeError('completion feedback requires document, $, and celebrate');
  }

  let finishToastTimer = null;
  let levelUpTimer = null;
  let levelUpHideTimer = null;
  let repaintToast = null;
  let toastGeneration = 0;
  let disposed = false;
  const stopLocale = onLocaleChanged(() => repaintToast?.());

  function showFinishToast(text) {
    if (disposed) return;
    toastGeneration++;
    const toast = $('#finishToast');
    if (!toast) return;
    toast.classList.remove('has-undo');
    const copy = typeof text === 'function' ? text : () => t(text);
    repaintToast = () => { toast.textContent = copy(); }; repaintToast();
    toast.classList.remove('hidden');
    void toast.offsetWidth;
    toast.classList.add('show');
    timers.clearTimeout(finishToastTimer);
    finishToastTimer = timers.setTimeout(() => {
      toast.classList.remove('show');
      finishToastTimer = timers.setTimeout(() => toast.classList.add('hidden'), 260);
    }, 2000);
  }

  // 撤销条：还是同一个提示，只是多了一个“撤销”和一条 5 秒走完的细线。撤销是一次性的，点过、过期、
  // 或者又完成了别的事，这条就换成一句结果，不再留着一个点了会失败的按钮。
  function showUndoToast(text, ticket) {
    if (disposed) return;
    const owner = ++toastGeneration;
    const toast = $('#finishToast');
    if (!toast || typeof document.createElement !== 'function') { showFinishToast(text); return; }
    const label = document.createElement('span');
    const copy = typeof text === 'function' ? text : () => t(text);
    label.textContent = copy();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'finish-undo';
    button.setAttribute('data-icon', 'undo');
    button.textContent = t('撤销');
    repaintToast = () => { label.textContent = copy(); button.textContent = t('撤销'); };
    const bar = document.createElement('i');
    bar.className = 'finish-undo-bar';
    bar.setAttribute('aria-hidden', 'true');
    if (bar.style) bar.style.animationDuration = `${ticket.ttlMs}ms`;
    toast.replaceChildren(label, button, bar);
    toast.classList.add('has-undo');
    toast.classList.remove('hidden');
    void toast.offsetWidth;
    toast.classList.add('show');
    timers.clearTimeout(finishToastTimer);
    const close = () => {
      toast.classList.remove('show');
      finishToastTimer = timers.setTimeout(() => { toast.classList.add('hidden'); toast.classList.remove('has-undo'); }, 260);
    };
    finishToastTimer = timers.setTimeout(close, ticket.ttlMs);
    button.addEventListener('click', async () => {
      if (disposed || owner !== toastGeneration || button.disabled) return;
      button.disabled = true;
      let outcome = null;
      try { outcome = await surfaceClient.undoComplete(ticket.token); } catch (_) { outcome = null; }
      if (disposed || owner !== toastGeneration) return;
      toast.classList.remove('has-undo');
      showFinishToast(outcome?.ok === true ? '已撤销，这件事回到待办'
        : outcome?.ok === false ? '已经不能撤销了' : '撤销结果暂未确认，可在任务列表核对。');
    });
  }

  function announceCompletion(result) {
    const next = result && result.nextOccurrenceDate;
    let text = () => t('已完成');
    if (next) {
      const date = new Date(`${next}T00:00:00`);
      const label = Number.isFinite(date.getTime())
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : next;
      text = () => t('今天这次已完成，下次 {date}', { date: label });
    }
    const ticket = result && result.undo;
    if (ticket && surfaceClient && typeof surfaceClient.undoComplete === 'function'
        && typeof ticket.token === 'string' && Number.isFinite(ticket.ttlMs) && ticket.ttlMs > 0) {
      showUndoToast(text, ticket);
      return;
    }
    showFinishToast(text);
  }

  function celebrateLevelUp(level) {
    if (disposed) return;
    try { celebrate(); } catch (_) {}
    const card = $('#levelUpCard');
    if (!card) return;
    const badge = $('#levelUpBadge');
    if (badge) badge.textContent = `LV.${level}`;
    card.classList.remove('hidden');
    card.setAttribute('aria-hidden', 'false');
    void card.offsetWidth;
    card.classList.add('show');
    timers.clearTimeout(levelUpTimer);
    timers.clearTimeout(levelUpHideTimer);
    levelUpTimer = timers.setTimeout(() => {
      card.classList.remove('show');
      levelUpHideTimer = timers.setTimeout(() => {
        card.classList.add('hidden');
        card.setAttribute('aria-hidden', 'true');
      }, 280);
    }, 1600);
  }

  function dispose() {
    disposed = true;
    toastGeneration++;
    stopLocale(); repaintToast = null;
    timers.clearTimeout(finishToastTimer);
    timers.clearTimeout(levelUpTimer);
    timers.clearTimeout(levelUpHideTimer);
    finishToastTimer = null;
    levelUpTimer = null;
    levelUpHideTimer = null;
    for (const selector of ['#finishToast', '#levelUpCard']) {
      const node = $(selector);
      if (!node) continue;
      node.classList.remove('show');
      node.classList.add('hidden');
    }
    $('#levelUpCard')?.setAttribute('aria-hidden', 'true');
  }

  return Object.freeze({ announceCompletion, celebrateLevelUp, showFinishToast, dispose });
}

export { createPopoverCompletionFeedback };
