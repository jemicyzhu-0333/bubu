'use strict';
import { createQuickStepEditor } from './step-editor.mjs';
import { createQuickStartEditor } from './quick-start-editor.mjs';
import { completeQuickProjection } from './quick-projection.mjs';
import { createSurfaceMotion } from '../shared/motion.mjs';

const PANEL_MODES = Object.freeze(['active', 'idle', 'fallback']);

const REASON_TEXT = Object.freeze({
  'task-not-found': '这件任务已经不在当前清单里。',
  'task-completed': '这件任务已经完成。',
  'task-scheduled': '预约时间还没到，暂时不能继续计时。',
  'session-changed': '计时已换成另一轮，请按更新后的面板继续。',
  'resume-intent-mismatch': '计时状态已变化，请重新查看继续或确认按钮。',
  'resume-action-unavailable': '计时状态暂不可用，请重新打开面板。',
  'recovery-state-inconsistent': '这轮计时的恢复状态不一致，暂时不能继续或确认；可以放弃本轮。',
  'task-expired': '这件任务已经过期，请到主面板决定是否续期。',
  'occurrence-skipped': '这一次已经跳过。',
  'session-active': '已有一段计时正在进行。',
  'already-running': '这段计时已经在运行。',
  'not-running': '当前没有可操作的计时。',
  'not-paused': '当前计时没有暂停。',
  'awaiting-confirmation': '上一轮已到点，请到主面板确认。',
  'quick-start-decision-pending': '两分钟已结束，请先到主面板选择下一步。',
  'focus-landing-pending': '请先到主面板保存或跳过上一轮落点。',
  'revision-conflict': '状态刚刚变了，请再试一次。',
  'task-changed': '任务内容已变化；输入仍保留，取消后可重新选择。',
  'next-action-already-set': '这件任务已有下一动作，请重新选择后开始。',
  'next-action-required': '这件任务还需要一个明确的下一动作。',
  'quick-start-unavailable': '两分钟启动结果暂不可用，请到主面板核对。',
  'step-limit-reached': '步骤已达上限，当前输入还在；请先到主面板整理步骤。',
  'invalid-quick-start-clarification': '下一动作或任务版本无效，输入内容还在。'
});

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function commandMessage(result) {
  if (!result) return '这次没有完成，请再试一次。';
  return REASON_TEXT[result.reason] || '状态已经变化，请检查主面板后再试。';
}

function createQuickPanelFeature({ window, document, client } = {}) {
  if (!window || !document || !client) throw new TypeError('quick panel requires window, document and client');
  const $ = selector => document.querySelector(selector);
  const teardown = [];
  const motion = createSurfaceMotion(document);
  let view = Object.freeze({ mode: 'fallback' });
  let requestGeneration = 0;
  let busy = false;
  let completeConfirmationTaskId = null;
  let timerAnchor = null;
  let ticker = null;
  let closing = false;
  let visitGeneration = 0;
  let viewGeneration = 0;
  let pendingCommand = null;
  let renderedAction = null;
  let revisionFloor = -1;
  let appliedRevision = -1;
  let appendDraftVersion = 0;
  const pendingReads = new Map();
  let pendingFocus = null;
  function supersedeReads() {
    requestGeneration++;
    for (const settle of pendingReads.values()) settle();
    pendingReads.clear();
  }
  const actionableTask = () => view.mode === 'active' && view.session?.kind !== 'break'
    && view.taskActionable === true ? view.task : null;
  const stepEditor = createQuickStepEditor({ document, client, runCommand, releaseCommand, getTask: actionableTask,
    getSessionId: () => view.session?.sessionId, completeStep });
  const quickStartEditor = createQuickStartEditor({ window, document, client, runCommand, releaseCommand,
    isBusy: () => busy, getVisit: () => visitGeneration, isVisitOpen: () => !closing, setStatus, refresh });

  function listen(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function setStatus(message = '', tone = '') {
    const line = $('#panelStatus');
    if (!line) return;
    line.textContent = message;
    line.dataset.tone = tone;
    line.classList.toggle('hidden', !message);
  }

  function setBusy(next) {
    busy = Boolean(next);
    document.body.setAttribute('aria-busy', String(busy));
  }

  function resetCompletionConfirmation() {
    completeConfirmationTaskId = null;
    const button = $('#btnCompleteQuickTask');
    if (button) button.textContent = '完成任务';
  }

  function showMode(mode) {
    const safeMode = PANEL_MODES.includes(mode) ? mode : 'fallback';
    document.body.dataset.mode = safeMode;
    for (const name of PANEL_MODES) {
      const panel = $(`#${name}Panel`);
      if (panel) panel.classList.toggle('hidden', name !== safeMode);
    }
  }

  function syncTimerAnchor() {
    const session = view.session;
    if (!session) {
      timerAnchor = null;
      return;
    }
    timerAnchor = {
      elapsedMs: Number(session.elapsedMs) || 0,
      remainingMs: Number(session.remainingMs) || 0,
      sampledAt: window.performance.now(),
      running: session.running === true
    };
  }

  function renderTimer() {
    const node = $('#quickSessionTime');
    if (!node || !timerAnchor) return;
    const delta = timerAnchor.running
      ? Math.max(0, window.performance.now() - timerAnchor.sampledAt)
      : 0;
    node.textContent = formatDuration(timerAnchor.remainingMs - delta);
    node.setAttribute('aria-label', `剩余 ${node.textContent}，已投入 ${formatDuration(timerAnchor.elapsedMs + delta)}`);
  }

  function makeChoiceButton({ index, title, meta, onClick, className }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.index = String(index);
    const key = document.createElement('span');
    key.className = 'quick-key';
    key.textContent = String(index);
    const copy = document.createElement('span');
    copy.className = 'quick-copy';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('small');
    detail.textContent = meta || '';
    copy.append(heading, detail);
    button.append(key, copy);
    // The row is replaced wholesale on refresh. Keep its listener owned by the
    // row itself instead of retaining dead rows in the feature teardown list.
    button.addEventListener('click', onClick);
    return button;
  }

  function renderActive() {
    const session = view.session || {};
    const task = session.kind === 'break' ? null : view.task || null;
    $('#quickTaskTitle').textContent = task
      ? task.title
      : (session.kind === 'break' ? '休息中' : '自由专注');
    const confirm = isHeld() || renderedAction?.intent === 'confirm-completion';
    $('#quickSessionState').textContent = renderedAction?.reason === 'recovery-state-inconsistent'
      ? '计时等待核对' : confirm ? '这一轮已到点，等待确认计入完成' : session.paused ? '已暂停' : '进行中';
    syncTimerAnchor();
    renderTimer();

    const canEdit = Boolean(actionableTask());
    const steps = canEdit && Array.isArray(view.steps) ? view.steps : [];
    const stepSection = $('#quickStepsSection');
    stepSection.classList.toggle('hidden', !canEdit);
    stepEditor.render(steps);

    $('#appendStepForm').classList.toggle('hidden', !canEdit);
    $('#btnCompleteQuickTask').classList.toggle('hidden', !canEdit);
    const pause = $('#btnPauseQuickSession');
    pause.textContent = confirm ? '确认计入完成' : session.paused ? '继续' : '暂停';
    pause.dataset.icon = session.paused ? 'play' : 'pause';
    pause.disabled = session.paused && renderedAction?.enabled !== true;
    $('#btnStopQuickSession').textContent = confirm ? '放弃本轮' : '结束这段';
    $('#btnStopQuickSession').disabled = isHeld() && !renderedAction;
    if (pause.disabled) setStatus(commandMessage({ reason: renderedAction?.reason || 'resume-action-unavailable' }), 'quiet');
    resetCompletionConfirmation();
  }

  function renderIdle() {
    const list = $('#quickCandidates');
    list.replaceChildren();
    const candidates = Array.isArray(view.candidates) ? view.candidates : [];
    if (!candidates.length) {
      const empty = document.createElement('p');
      empty.className = 'quick-empty';
      empty.textContent = '先留下一句话。';
      list.appendChild(empty);
      return;
    }
    candidates.forEach((candidate, index) => {
      const action = candidate.quickStartAction;
      const button = makeChoiceButton({
      index: index + 1,
      title: candidate.title,
      meta: action?.enabled ? (action.intent === 'clarify-and-start' ? '写下一步，开始 2 分钟' : '先做 2 分钟')
        : commandMessage({ reason: action?.reason }),
      className: 'quick-row quick-candidate',
      onClick: () => startCandidate(candidate)
      });
      button.disabled = action?.enabled !== true;
      list.appendChild(button);
    });
  }

  function isHeld() {
    return view.session?.paused && (view.session.awaitingOfflineConfirmation === true || view.session.remainingMs === 0);
  }

  function render(nextView) {
    viewGeneration++;
    view = nextView && PANEL_MODES.includes(nextView.mode)
      ? nextView
      : Object.freeze({ mode: 'fallback' });
    const action = view.session?.resumeAction;
    renderedAction = view.session?.paused && action?.sessionId === view.session.sessionId
      ? Object.freeze({ ...action }) : null;
    showMode(view.mode);
    if (view.mode === 'active') renderActive();
    if (view.mode === 'idle') renderIdle();
    quickStartEditor.update(view);
  }

  function focusPendingVisit() {
    const owner = pendingFocus;
    if (!owner || owner.scheduled) return;
    owner.scheduled = true;
    void motion.enter($('#quickCandidates'));
    void motion.enter($('#quickSteps'));
    window.requestAnimationFrame(() => {
      if (pendingFocus !== owner) return;
      pendingFocus = null;
      if (owner.visit === visitGeneration && !closing && !quickStartEditor.hasDraft()) $('#impInput')?.focus();
    });
  }

  async function loadProjection(generation) {
    try {
      const state = await client.getState();
      if (generation !== requestGeneration || closing) return false;
      if (Number.isSafeInteger(state?.revision)) {
        if (state.revision < revisionFloor) return appliedRevision >= revisionFloor;
        revisionFloor = state.revision;
        const complete = completeQuickProjection({ revision: state.revision, delta: { quickPanel: state.quickPanel } });
        appliedRevision = complete ? state.revision : -1;
      } else if (revisionFloor >= 0) return false;
      if (!quickStartEditor.hasDraft()) setStatus('');
      render(state && state.quickPanel);
    } catch (_) {
      if (generation !== requestGeneration || closing) return false;
      appliedRevision = -1;
      render({ mode: 'fallback' });
      setStatus('当前状态暂时不可用，仍可快速记录。', 'quiet');
    }
    return true;
  }

  function refresh({ focusImpulse = false } = {}) {
    if (closing) return Promise.resolve();
    if (focusImpulse) pendingFocus = { visit: visitGeneration, scheduled: false };
    const generation = ++requestGeneration;
    const completion = new Promise(resolve => pendingReads.set(generation, resolve));
    // A replacement read is not yet an accepted view. Existing command waiters
    // follow the latest read until it resolves, a complete push arrives, or this
    // visit closes. None of those transfers owns another command's token.
    void loadProjection(generation).then(accepted => {
      if (!accepted || generation !== requestGeneration || closing) return;
      supersedeReads();
      focusPendingVisit();
    });
    return completion;
  }

  function releaseCommand(owner) {
    if (pendingCommand?.owner !== owner) return;
    pendingCommand = null; setBusy(false);
  }

  async function runCommand(operation, { refreshAfter = true, bindView = true, owner = null, owns = () => true } = {}) {
    if (busy || closing) return null;
    const visit = visitGeneration;
    const version = viewGeneration;
    const token = { owner };
    pendingCommand = token;
    const current = () => visit === visitGeneration && (!bindView || version === viewGeneration) && !closing && owns();
    setBusy(true);
    setStatus('');
    try {
      const result = await operation();
      if (!current()) return null;
      if (result && result.ok === false) {
        setStatus(commandMessage(result), 'error');
        return result;
      }
      if (refreshAfter) await refresh();
      if (visit !== visitGeneration || closing || pendingCommand !== token || !owns()) return null;
      return result || { ok: true };
    } catch (_) {
      if (!current()) return null;
      setStatus('这次没有完成，请再试一次。', 'error');
      return null;
    } finally {
      if (pendingCommand === token) { pendingCommand = null; setBusy(false); }
    }
  }

  async function completeStep(step) {
    if (!actionableTask() || !step || !(view.steps || []).includes(step)) return;
    resetCompletionConfirmation();
    await runCommand(() => client.completeStep(view.task.id, step.id));
  }

  async function appendStep() {
    const input = $('#stepInput');
    const title = input.value.trim();
    if (!actionableTask() || !title) return;
    const taskId = view.task.id;
    const draft = input.value;
    const draftVersion = appendDraftVersion;
    const sessionId = view.session?.sessionId;
    const ownsTarget = () => actionableTask()?.id === taskId && view.session?.sessionId === sessionId;
    resetCompletionConfirmation();
    const scope = view.task.seriesId ? 'current' : undefined;
    const result = await runCommand(() => client.appendTaskStep(taskId, title, scope),
      { bindView: false, owns: ownsTarget });
    if (result && result.ok !== false && ownsTarget()
        && appendDraftVersion === draftVersion && input.value === draft) input.value = '';
  }

  async function completeTask() {
    if (!actionableTask()) return;
    const confirm = completeConfirmationTaskId === view.task.id;
    const result = await runCommand(
      () => client.completeTask(view.task.id, confirm),
      { refreshAfter: false }
    );
    if (result && result.ok === false && result.reason === 'unfinished-steps-need-confirmation') {
      completeConfirmationTaskId = view.task.id;
      $('#btnCompleteQuickTask').textContent = '仍然完成';
      setStatus(`还有 ${result.unfinishedCount || '几'} 个步骤没勾；再按一次确认完成。`, 'warning');
      return;
    }
    resetCompletionConfirmation();
    if (result && result.ok !== false) await refresh();
  }

  function startCandidate(candidate) {
    if (view.mode !== 'idle' || !(view.candidates || []).includes(candidate)) return;
    resetCompletionConfirmation();
    quickStartEditor.open(candidate);
  }

  async function submitImpulse() {
    if (closing) return;
    const visit = visitGeneration;
    const input = $('#impInput');
    const value = input.value.trim();
    if (!value) return;
    resetCompletionConfirmation();
    // Capture owns its receipt for this visit; an unrelated session refresh
    // must not hide a successful save or invite a duplicate submission.
    const result = await runCommand(() => client.addImpulse(value), { refreshAfter: false, bindView: false });
    if (result && result.ok !== false) {
      if (visit !== visitGeneration) return;
      closing = true;
      input.value = '';
      document.body.dataset.receipt = 'saved';
      setStatus('记好了');
      await new Promise(resolve => window.setTimeout(resolve, 600));
      if (visit !== visitGeneration) return;
      await client.hideImpulse();
      closing = false;
      delete document.body.dataset.receipt;
    }
  }

  function inputOwnsKeys(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (quickStartEditor.isOpen()) { quickStartEditor.cancel(); return; }
      invalidateVisit();
      void client.hideImpulse();
      return;
    }
    if (!['1', '2', '3'].includes(event.key)) return;
    if (quickStartEditor.isOpen()) return;
    // 随手记是默认焦点，光按数字会被打进输入框。所以：焦点在输入框里时用 ⌘ / Ctrl + 数字，
    // 焦点不在输入框时光按数字也行。
    const withModifier = event.metaKey || event.ctrlKey;
    if (inputOwnsKeys(event.target) && !withModifier) return;
    if (event.altKey || event.shiftKey) return;
    const index = Number(event.key) - 1;
    if (view.mode === 'active' && !actionableTask()) return;
    const item = view.mode === 'active' ? (view.steps || [])[index] : (view.candidates || [])[index];
    if (!item) return;
    event.preventDefault();
    if (view.mode === 'active') void completeStep(item);
    if (view.mode === 'idle') void startCandidate(item);
  }

  function applySensoryProfile(profile = {}) {
    document.body.dataset.motion = ['reduced', 'balanced', 'full'].includes(profile.motionMode)
      ? profile.motionMode : 'balanced';
    document.body.dataset.stimulation = ['low', 'balanced', 'high'].includes(profile.stimulationMode)
      ? profile.stimulationMode : 'balanced';
  }

  function mount() {
    quickStartEditor.mount();
    listen($('#impulseForm'), 'submit', event => {
      event.preventDefault();
      void submitImpulse();
    });
    listen($('#stepInput'), 'input', () => { appendDraftVersion++; });
    listen($('#appendStepForm'), 'submit', event => {
      event.preventDefault();
      void appendStep();
    });
    listen($('#btnCompleteQuickTask'), 'click', () => { void completeTask(); });
    listen($('#btnPauseQuickSession'), 'click', () => {
      resetCompletionConfirmation();
      if (view.mode !== 'active') return;
      const action = renderedAction;
      if (view.session?.paused) {
        if (!action?.enabled || !['resume', 'confirm-completion'].includes(action.intent)) return;
        void runCommand(() => client.resumePomodoro({ sessionId: action.sessionId, intent: action.intent }));
      } else void runCommand(() => client.pausePomodoro());
    });
    listen($('#btnStopQuickSession'), 'click', () => {
      resetCompletionConfirmation();
      if (view.mode !== 'active') return;
      const action = renderedAction;
      if (isHeld() && !action) return;
      const input = action?.intent === 'confirm-completion' ? { sessionId: action.sessionId } : undefined;
      void runCommand(() => client.stopPomodoro(input));
    });
    listen(document, 'keydown', onKeydown);
    listen(window, 'focus', () => {
      invalidateVisit(); closing = false; delete document.body.dataset.receipt;
      void refresh({ focusImpulse: true });
    });
    listen(window, 'blur', invalidateVisit);
    const modifier = /Mac/.test(window.navigator?.platform || '') ? '⌘' : 'Ctrl+';
    document.querySelectorAll('[data-quick-shortcut]').forEach(node => { node.textContent = `${modifier}1–3`; });
    teardown.push(client.onStateDiff(message => {
      if (closing) return;
      const revision = message?.revision;
      if (Number.isSafeInteger(revision) && revision < revisionFloor) return;
      const complete = completeQuickProjection(message);
      if (complete) {
        if (revision <= appliedRevision) return;
        revisionFloor = revision;
        appliedRevision = revision;
        supersedeReads();
        if (!quickStartEditor.hasDraft() && !busy) setStatus('');
        resetCompletionConfirmation();
        render(complete);
        focusPendingVisit();
        return;
      }
      if (Number.isSafeInteger(revision)) {
        if (revision <= revisionFloor) return;
        revisionFloor = revision;
      }
      resetCompletionConfirmation();
      void refresh();
    }));
    teardown.push(client.onSensoryProfile(applySensoryProfile));
    ticker = window.setInterval(renderTimer, 500);
    void refresh({ focusImpulse: true });
  }

  function dispose() {
    motion.dispose();
    invalidateVisit();
    stepEditor.dispose();
    quickStartEditor.dispose();
    requestGeneration += 1;
    while (teardown.length) teardown.pop()();
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
  }

  function invalidateVisit() {
    visitGeneration++; supersedeReads(); closing = true;
    appliedRevision = -1;
    pendingFocus = null;
    quickStartEditor.reset();
    pendingCommand = null; setBusy(false); renderedAction = null;
    render({ mode: 'fallback' });
  }

  return Object.freeze({ mount, dispose, refresh, render });
}

export { PANEL_MODES, formatDuration, commandMessage, createQuickPanelFeature };
