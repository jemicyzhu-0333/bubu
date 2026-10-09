import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

// 落点提示：一段计时结束之后，那一问。
//
// 它和别的弹层不是一类东西。别的弹层是用户主动打开的，落点提示是状态里有一个
// 待表态的落点时它自己出现，而且 Escape 关不掉它——Escape 只把焦点送到那个
// 「可以什么都不选」的出口上。所以它没有 open()：能不能露面由 activePrompt()
// 从投影里读出来，render() 每次照着重画一遍。
//
// 这一层拥有的全部状态只有两样：这次露面的是哪一个落点（换了一个才重新抢焦
// 点，不然每次重绘都会把光标从输入框里抢走），以及它出现之前焦点在哪，好在它
// 消失后还回去。以前这两个是面板顶上的模块级 let。
//
// 它也是别的弹层关闭时的兜底去处：关掉一个弹层的瞬间可能刚好有一段计时到点，
// 这时焦点不该在背后的内容上闪一下再被抢走，而是直接交给落点提示。所以
// activePrompt / rememberReturnFocus / render 三个是对外的。
function createPopoverQuickStartLanding({
  document, $, $$, getState, getSession, modalRegistry, landingBlockingModals,
  canReceiveFocus, surfaceClient, focusActionMessage
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover landing requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    getState, getSession, canReceiveFocus, focusActionMessage
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover landing requires ${name}`);
  }
  if (!modalRegistry || typeof modalRegistry.isOpen !== 'function'
    || typeof modalRegistry.isAnyOpen !== 'function') {
    throw new TypeError('popover landing requires the modal registry');
  }
  if (!Array.isArray(landingBlockingModals)) {
    throw new TypeError('popover landing requires landingBlockingModals');
  }
  if (!surfaceClient) throw new TypeError('popover landing requires surfaceClient');

  let promptKey = '';   // 这次露面的是哪一个落点：一样就不再抢焦点
  let returnFocus = null; // 它出现之前焦点在哪
  let mounted = false;
  let generation = 0;
  let displayedPrompt = null;
  let errorCopy = () => '';
  const pendingRequests = new Map();
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function isOpen() {
    return !$('#quickStartMask').classList.contains('hidden');
  }

  function activePrompt() {
    const state = getState();
    if (!state) return null;
    const hasExplicitQuickPending = Object.prototype.hasOwnProperty.call(state, 'quickStartResolutionPending');
    const quickPending = hasExplicitQuickPending
      ? state.quickStartResolutionPending === true
      : !!(state.lastSessionCompletion && state.lastSessionCompletion.kind === 'quick-start' && !state.lastSessionCompletion.resolved);
    if (quickPending) {
      const decision = state.quickStartDecision || state.lastSessionCompletion || {};
      return {
        mode: 'quick-start',
        sessionId: decision.sessionId || null,
        taskId: decision.taskId || null,
        taskEditable: decision.taskEditable === true
      };
    }
    const focusPrompt = state.focusLandingPrompt;
    if (focusPrompt && focusPrompt.status === 'pending') {
      const sessionId = focusPrompt.sessionId;
      const session = getSession();
      return {
        mode: 'focus',
        sessionId,
        taskId: focusPrompt.taskId || null,
        taskEditable: focusPrompt.taskEditable === true,
        healthyShutdown: focusPrompt.healthyShutdown === true,
        breakState: session.mode === 'break' && session.running
          ? 'running'
          : (session.mode === 'break' && session.paused ? 'paused' : 'inactive')
      };
    }
    return null;
  }

  function updateSaveAvailability() {
    const save = $('#focusLandingActions').querySelector('[data-focus-landing="save"]');
    if (!save || $('#quickStartMask').dataset.landingMode !== 'focus') return;
    save.disabled = pendingRequests.has(promptKey) || $('#quickStartMask').dataset.landingTaskEditable !== 'true' || !$('#landingNote').value.trim();
  }

  function rememberReturnFocus(preferred = null) {
    if (canReceiveFocus(preferred)) {
      returnFocus = preferred;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('#quickStartMask')
        && canReceiveFocus(active)) {
      returnFocus = active;
      return;
    }
    returnFocus = canReceiveFocus($('#btnNowKickstart'))
      ? $('#btnNowKickstart')
      : $('#taskInput');
  }

  function restoreFocusAfterLanding() {
    const preferred = returnFocus;
    returnFocus = null;
    requestAnimationFrame(() => {
      if (modalRegistry.isAnyOpen() || activePrompt() || !mounted) return;
      const target = canReceiveFocus(preferred)
        ? preferred
        : (canReceiveFocus($('#taskInput')) ? $('#taskInput') : null);
      if (target) target.focus();
    });
  }

  function paintPromptCopy() {
    const prompt = displayedPrompt; if (!prompt) return;
    const isQuickStart = prompt.mode === 'quick-start';
    const isHealthyShutdown = !isQuickStart && prompt.healthyShutdown === true;
    $('#quickStartTitle').textContent = t(isQuickStart
      ? '两分钟到了，已经启动成功'
      : isHealthyShutdown
        ? '收工前，给下次留个入口'
        : '给下一次留个入口');
    $('#landingDescription').textContent = t(isQuickStart
      ? '不用证明什么。选择此刻最适合你的落点：'
      : isHealthyShutdown
        ? '这不是一次完成结算。留一句下次能直接动手的提示，或安心跳过。'
        : prompt.breakState === 'running'
          ? '休息正在进行。你可以留一句落点，也可以跳过，之后再决定。'
          : prompt.breakState === 'paused'
            ? '休息已经暂停。上一轮落点仍保留，准备好时再处理。'
            : '这段专注的落点仍为你保留，可以留一句下次入口，也可以跳过。');
  }

  function render() {
    if (!getState()) return;
    const prompt = activePrompt();
    const pending = Boolean(prompt);
    const mask = $('#quickStartMask');
    const wasVisible = !mask.classList.contains('hidden');
    // Do not stack two aria-modal dialogs. A timer may finish while a deadline
    // or task-breakdown editor is open; let the user finish that small edit,
    // then reveal the durable landing prompt as soon as the editor closes.
    const editorOwnsModal = pending
      && landingBlockingModals.some(name => modalRegistry.isOpen(name));
    const visible = pending && !editorOwnsModal;
    mask.classList.toggle('hidden', !visible);
    mask.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!pending) {
      if (promptKey) generation += 1;
      promptKey = ''; displayedPrompt = null;
      if (wasVisible) restoreFocusAfterLanding();
      return;
    }
    const nextKey = `${prompt.mode}:${prompt.sessionId || 'unknown'}:${prompt.taskId || 'free'}`;
    mask.dataset.landingMode = prompt.mode;
    mask.dataset.landingHasTask = prompt.taskId ? 'true' : 'false';
    mask.dataset.landingTaskEditable = prompt.taskEditable ? 'true' : 'false';
    const isQuickStart = prompt.mode === 'quick-start';
    displayedPrompt = prompt; paintPromptCopy();
    $('#quickStartLandingActions').classList.toggle('hidden', !isQuickStart);
    $('#focusLandingActions').classList.toggle('hidden', isQuickStart);
    $('#landingNoteField').classList.toggle('hidden', !prompt.taskEditable);

    const changedPrompt = nextKey !== promptKey;
    if (wasVisible !== visible) generation += 1;
    if (visible && !wasVisible) rememberReturnFocus();
    if (changedPrompt) {
      generation += 1;
      const error = $('#quickStartError');
      error.textContent = ''; errorCopy = () => '';
      error.classList.add('hidden');
      $('#landingNote').value = '';
      if ($('#landingProgressMade')) $('#landingProgressMade').checked = false;
    }
    if (visible && (changedPrompt || !wasVisible)) {
      if (isQuickStart) {
        mask.querySelector('[data-quick-resolution]')?.focus();
      } else if (prompt.taskEditable) {
        $('#landingNote').focus();
      } else {
        mask.querySelector('[data-focus-landing="skip"]')?.focus();
      }
    }
    promptKey = nextKey;
    setBusy(pendingRequests.has(promptKey));
  }

  function setBusy(busy) {
    $('#landingNote').disabled = busy;
    if ($('#landingProgressMade')) $('#landingProgressMade').disabled = busy;
    $('#quickStartMask').querySelectorAll('[data-quick-resolution], [data-focus-landing]')
      .forEach(item => { item.disabled = busy; });
    if (!busy) updateSaveAvailability();
  }

  function showError(message = '') {
    const error = $('#quickStartError');
    errorCopy = typeof message === 'function' ? message : () => t(message);
    error.textContent = errorCopy();
    error.classList.toggle('hidden', !message);
  }

  async function resolve(button, mode) {
    const prompt = activePrompt();
    const method = mode === 'focus' ? 'resolveFocusLanding' : 'resolveQuickStart';
    const key = prompt && `${prompt.mode}:${prompt.sessionId || 'unknown'}:${prompt.taskId || 'free'}`;
    if (!mounted || !prompt || prompt.mode !== mode || key !== promptKey
        || !isOpen() || button.disabled || pendingRequests.has(key)
        || typeof surfaceClient[method] !== 'function') return;
    const action = mode === 'focus' ? button.dataset.focusLanding : button.dataset.quickResolution;
    const note = prompt.taskEditable ? $('#landingNote').value.trim() : '';
    if (action === 'save' && (!prompt.taskEditable || !note)) {
      showError('写下一句可以直接开始的动作，或者选择“暂时跳过”。');
      if (prompt.taskEditable) $('#landingNote').focus();
      return;
    }
    const owner = generation, operation = {};
    pendingRequests.set(key, operation);
    setBusy(true); showError('');
    const owns = () => mounted && generation === owner && promptKey === key;
    try {
      const result = await surfaceClient[method]({
        sessionId: prompt.sessionId, action,
        progressMade: $('#landingProgressMade')?.checked === true,
        landingNote: mode === 'focus' && action !== 'save' ? null : note || null
      });
      if (owns() && (!result || result.ok === false)) showError(() => focusActionMessage(result?.reason));
    } catch (_) {
      if (owns()) showError('这次结果尚未确认，当前决定仍保留，请重试。');
    } finally {
      if (pendingRequests.get(key) === operation) pendingRequests.delete(key);
      // Recompute only availability from the currently displayed identity; an
      // old response never clears a new checkbox, draft, error or request.
      if (mounted) setBusy(pendingRequests.has(promptKey));
    }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    teardown.push(onLocaleChanged(() => {
      paintPromptCopy();
      $('#quickStartError').textContent = errorCopy();
    }));
    listen($('#landingNote'), 'input', updateSaveAvailability);
    if (typeof surfaceClient.onPopoverHidden === 'function') {
      const unsubscribe = surfaceClient.onPopoverHidden(() => { generation += 1; });
      if (typeof unsubscribe === 'function') teardown.push(unsubscribe);
    }
    for (const button of $$('[data-quick-resolution]')) {
      listen(button, 'click', () => { void resolve(button, 'quick-start'); });
    }
    for (const button of $$('[data-focus-landing]')) {
      listen(button, 'click', () => { void resolve(button, 'focus'); });
    }
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    generation += 1;
    while (teardown.length) teardown.pop()();
    promptKey = ''; displayedPrompt = null; errorCopy = () => '';
    returnFocus = null;
  }

  return Object.freeze({
    mount, dispose, isOpen, render, activePrompt, rememberReturnFocus
  });
}


export { createPopoverQuickStartLanding };
