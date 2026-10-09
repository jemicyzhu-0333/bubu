import { t, onLocaleChanged } from '../../shared/interface/i18n.mjs';
'use strict';

// Owns the stuck dialog, its task-bound drafts and request lifecycle.
function createPopoverStuck({
  document, $, $$, syncPressedButtons, showTransientStatus: reportTransientStatus, hideTransientStatus,
  blockerLabels, surfaceClient, taskActionMessage, unstickAdvice,
  currentTask, renderNowCard, canReceiveFocus, restoreModalFocus,
  isAiEnabled, isStrategyGuidanceEnabled, openCollaboration
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover stuck requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    syncPressedButtons,
    showTransientStatus: reportTransientStatus,
    hideTransientStatus,
    taskActionMessage,
    currentTask,
    renderNowCard,
    canReceiveFocus,
    restoreModalFocus,
    isAiEnabled,
    isStrategyGuidanceEnabled
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover stuck requires ${name}`);
  }
  if (!blockerLabels) throw new TypeError('popover stuck requires blockerLabels');
  if (!unstickAdvice || typeof unstickAdvice.request !== 'function' || typeof unstickAdvice.clear !== 'function') {
    throw new TypeError('popover stuck requires unstickAdvice');
  }
  if (!surfaceClient || typeof surfaceClient.clarifyNowTask !== 'function'
    || typeof surfaceClient.previewBreakdown !== 'function'
    || typeof surfaceClient.requestStrategy !== 'function') {
    throw new TypeError('popover stuck requires surfaceClient');
  }

  // 卡点已经回答过一次，不再让用户从五个阶段里再选一遍。映射依据是
  // content/strategies.js 里各条目的 triggers.blockers。
  const BLOCKER_TO_PHASE = Object.freeze({
    unclear: 'pre-start',
    'too-big': 'pre-start',
    boring: 'pre-start',
    anxious: 'pre-start',
    'low-energy': 'recovery',
    interrupted: 'distraction'
  });

  let selectedBlocker = null;       // 用户这次的答案；三条出路共同的输入
  let selectedBlockerTaskId = null; // 上面那个答案属于哪件任务
  let shrinkCandidates = [];        // 一批更小的下一步，「换一个」就是在其中往后走
  let shrinkCandidateIndex = 0;
  let shrinkSourceLabel = () => '';
  let shrinkEditorTaskId = null;    // 这批候选是为哪件任务生成的
  let activeStrategy = null;        // 正在展示的那条策略；看一眼不评价就关掉是正当的
  let trigger = null;               // 打开它的那个控件；关闭后焦点回到这里
  let mounted = false;
  let requestEpoch = 0;
  let savingEpoch = null;
  const teardown = [];
  const statusCopies = new Map();
  let titleCopy = () => '', strategyCopy = () => {};
  function showTransientStatus(selector, source) {
    const copy = typeof source === 'function' ? source : () => t(source);
    statusCopies.set(selector, copy); reportTransientStatus(selector, copy());
  }
  function repaintCopy() {
    if (!isOpen()) return;
    $('#stuckTitle').textContent = titleCopy();
    renderShrinkSource(); strategyCopy();
    for (const [selector, copy] of statusCopies) {
      const node = $(selector); if (node && !node.classList.contains('hidden')) node.textContent = copy();
    }
    unstickAdvice.repaintCopy?.();
  }


  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  // 卡点归这一层，NOW 卡片只负责画。卡片每次重绘时来问一次：顺手认领当前这件任
  // 务的卡点、对齐 chip、丢掉已经不属于这件任务的候选，然后把徽标文字交回去。
  function syncBlockerForTask(task) {
    if (selectedBlockerTaskId !== (task?.id || null)) {
      requestEpoch += 1;
      activeStrategy = null;
      unstickAdvice.clear();
    }
    if (!task) {
      selectedBlocker = null;
      selectedBlockerTaskId = null;
      syncPressedButtons('.blocker-chip', () => false);
      return '';
    }
    if (selectedBlockerTaskId !== task.id) {
      selectedBlockerTaskId = task.id;
      selectedBlocker = task.blocker || null;
    }
    syncPressedButtons('.blocker-chip', item => item.dataset.blocker === selectedBlocker);
    // 候选是为某一件任务生成的：换了任务，它们就是别人的下一步。
    if (shrinkEditorTaskId && shrinkEditorTaskId !== task.id) {
      shrinkCandidates = [];
    }
    return t(blockerLabels[selectedBlocker] || selectedBlocker || '');
  }

  // 当前停在哪一屏由 DOM 自己说得清（谁没有 hidden 就是谁),所以不再另存一份：
  // 那一份从来没有人读，只会在两者不一致时骗人。
  function setStep(step) {
    titleCopy = () => step === 'route' ? t('{blocker} · 三条出路', { blocker: t(blockerLabels[selectedBlocker] || '') })
      : t(({ blocker: '卡在哪？', shrink: '更小的下一步', tip: '一个小办法' })[step] || '卡在哪？');
    $('#stuckTitle').textContent = titleCopy();
    $('#stuckDescription').classList.toggle('hidden', step !== 'blocker');
    for (const [id, name] of [
      ['#stuckStepBlocker', 'blocker'], ['#stuckStepRoute', 'route'],
      ['#stuckStepShrink', 'shrink'], ['#stuckStepTip', 'tip']
    ]) $(id).classList.toggle('hidden', step !== name);
  }

  function isOpen() {
    const mask = $('#stuckMask');
    return Boolean(mask && !mask.classList.contains('hidden'));
  }

  function focusWhenCurrent(focus) {
    const epoch = requestEpoch;
    requestAnimationFrame(() => { if (epoch === requestEpoch && isOpen()) focus(); });
  }

  function open() {
    requestEpoch += 1;
    trigger = document.activeElement;
    selectedBlocker = null;
    const task = currentTask();
    selectedBlockerTaskId = task ? task.id : null;
    if (task && task.blocker) selectedBlocker = task.blocker;
    syncPressedButtons('.blocker-chip', item => item.dataset.blocker === selectedBlocker);
    shrinkCandidates = [];
    shrinkCandidateIndex = 0;
    shrinkEditorTaskId = null;
    activeStrategy = null; strategyCopy = () => {}; statusCopies.clear();
    shrinkSourceLabel = () => '';
    unstickAdvice.clear();
    hideTransientStatus('#strategyStatus');
    hideTransientStatus('#clarifyCapabilityNote');
    setStep(selectedBlocker ? 'route' : 'blocker');
    $('#stuckMask').classList.remove('hidden');
    $('#stuckMask').setAttribute('aria-hidden', 'false');
    focusWhenCurrent(() => {
      const first = $('#stuckMask').querySelector('.stuck-step:not(.hidden) button:not([disabled])');
      (first || $('#stuckClose')).focus();
    });
  }

  // 关闭永远可用，而且**不写任何反馈**：想看一眼但不评价是一个正当需要，
  // 之前只有「有用 / 不合适」两个出口，等于强制表态。
  function close() {
    requestEpoch += 1;
    $('#stuckMask').classList.add('hidden');
    $('#stuckMask').setAttribute('aria-hidden', 'true');
    activeStrategy = null; strategyCopy = () => {}; statusCopies.clear();
    shrinkSourceLabel = () => '';
    unstickAdvice.clear();
    const closing = trigger;
    trigger = null;
    // 今天页的弹窗不能指望 restoreModalFocus 的兜底（它在带 aria-hidden 的任务页），
    // 所以显式回到入口按钮。
    restoreModalFocus(canReceiveFocus(closing) ? closing : $('#btnStuck'));
  }

  function chooseBlocker(button) {
    selectedBlocker = button.dataset.blocker;
    const task = currentTask();
    selectedBlockerTaskId = task ? task.id : null;
    syncPressedButtons('.blocker-chip', item => item === button);
    renderNowCard();
    setStep('route');
    focusWhenCurrent(() => $('#btnRouteShrink').focus());
  }

  async function loadShrinkCandidates() {
    const epoch = ++requestEpoch;
    const task = currentTask();
    if (!task) {
      setStep('shrink');
      showTransientStatus('#clarifyCapabilityNote', '先选定一件事。');
      return;
    }
    shrinkEditorTaskId = task.id;
    const aiOn = Boolean(isAiEnabled());
    let steps = [];
    let source = () => t('本地模板');
    let proposalId = null;
    try {
      if (aiOn) {
        const preview = await surfaceClient.previewAiBreakdown({
          title: task.title,
          description: task.description || null,
          clarification: null,
          taskId: task.id,
          blocker: selectedBlocker || null
        });
        proposalId = preview && preview.proposalId ? preview.proposalId : null;
        if (preview && preview.ok !== false && Array.isArray(preview.steps)) {
          steps = preview.steps;
          // 静默回退是不允许的：回退了就要说清楚为何回退。
          source = () => preview.fallback
            ? t('已回退本地模板（{reason}）', { reason: preview.reason || t('未提供原因') })
            : t(preview.provider === 'api' ? 'AI 建议' : '本地模板');
        }
      }
      if (!steps.length) steps = await surfaceClient.previewBreakdown(task.title) || [];
    } catch (_) {
      steps = [];
    } finally {
      if (proposalId) {
        void surfaceClient.dismissBreakdownProposal(proposalId).catch(() => {});
      }
    }
    if (epoch !== requestEpoch || !isOpen() || currentTask()?.id !== task.id) return;
    // 不改 proposal 的 3–7 步 schema：取第一步当建议，「换一个」就是往后走。
    shrinkCandidates = steps.map(step => step && step.title).filter(Boolean);
    shrinkCandidateIndex = 0;
    setStep('shrink');
    if (!shrinkCandidates.length) {
      $('#shrinkNextAction').value = '';
      shrinkSourceLabel = () => ''; $('#shrinkSource').textContent = '';
      showTransientStatus('#clarifyCapabilityNote', '这次没生成建议，可以自己写一步。');
      focusWhenCurrent(() => $('#shrinkNextAction').focus());
      return;
    }
    shrinkEditorTaskId = task.id;
    shrinkSourceLabel = source;
    applyShrinkCandidate();
    focusWhenCurrent(() => $('#shrinkNextAction').focus());
  }

  function applyShrinkCandidate() {
    $('#shrinkNextAction').value = shrinkCandidates[shrinkCandidateIndex] || '';
    renderShrinkSource();
  }

  function renderShrinkSource() {
    const source = shrinkSourceLabel();
    $('#shrinkSource').textContent = shrinkCandidates.length > 1 ? `${source} · ${shrinkCandidateIndex + 1}/${shrinkCandidates.length}` : source;
  }

  function nextShrinkCandidate() {
    if (!shrinkCandidates.length) return;
    shrinkCandidateIndex = (shrinkCandidateIndex + 1) % shrinkCandidates.length;
    applyShrinkCandidate();
    $('#shrinkNextAction').focus();
  }

  function cancelShrink() {
    requestEpoch += 1;
    shrinkEditorTaskId = null;
    setStep('route');
    focusWhenCurrent(() => $('#btnRouteShrink').focus());
  }

  async function confirmShrink() {
    if (savingEpoch === requestEpoch || !isOpen()) return;
    const task = currentTask();
    const nextAction = $('#shrinkNextAction').value.trim();
    if (task && shrinkEditorTaskId && task.id !== shrinkEditorTaskId) {
      showTransientStatus('#clarifyCapabilityNote', '当前任务已变化，这份下一步草稿未保存。');
      return;
    }
    if (!task || !nextAction) {
      showTransientStatus('#clarifyCapabilityNote', '先写下一个能动手的下一步。');
      return;
    }
    const epoch = requestEpoch;
    savingEpoch = epoch;
    try {
      const patch = { nextAction };
      if (selectedBlocker) patch.blocker = selectedBlocker;
      const result = await surfaceClient.clarifyNowTask(task.id, patch);
      if (epoch !== requestEpoch || !isOpen() || currentTask()?.id !== task.id) return;
      if (!result || result.ok === false) {
        showTransientStatus('#clarifyCapabilityNote', () => taskActionMessage(result && result.reason));
        return;
      }
      shrinkEditorTaskId = null;
      close();
    } catch (_) {
      if (epoch !== requestEpoch || !isOpen() || currentTask()?.id !== task.id) return;
      showTransientStatus('#clarifyCapabilityNote', '这次没保存成，建议还在输入框里。');
    } finally { if (savingEpoch === epoch) savingEpoch = null; }
  }

  // 回答完卡点要给两样东西：一条通用办法（本机规则，永远拿得到）和一句针对这件事的
  // 下一步（要发请求，可能没有）。顺序不能反：先把拿得到的那条写上去。
  async function requestStrategyForBlocker() {
    const epoch = ++requestEpoch;
    const task = currentTask();
    const current = () => epoch === requestEpoch && isOpen() && isStrategyGuidanceEnabled() && currentTask()?.id === task?.id;
    activeStrategy = null;
    try { await showStrategyForBlocker(task, current); }
    catch (_) {
      if (current()) showTransientStatus('#strategyStatus', '这次没能取得建议，可以重试。');
      return;
    }
    if (!current()) return;
    // 通用办法先落到面上,再去问针对这件事的那一句:先有东西可读,才不算干等。
    // AI 关着的时候不问——本地兜底给出的就是刚刚那条策略,同一句话说两遍没有信息。
    if (!isAiEnabled()) {
      unstickAdvice.clear();
      return;
    }
    void unstickAdvice.request({
      taskId: task && task.id,
      note: selectedBlocker ? `卡在：${blockerLabels[selectedBlocker] || selectedBlocker}` : null
    });
  }

  // 触发条件还含估时、能量带和“有没有下一步”，所以映射后的 phase 仍可能空手。
  // 失败一次就回退到 pre-start 再试一次，再失败才说“没有”——不做更多轮询。
  async function showStrategyForBlocker(task, current) {
    const phase = BLOCKER_TO_PHASE[selectedBlocker] || 'pre-start';
    setStep('tip');
    let result = await surfaceClient.requestStrategy(phase, task && task.id);
    if (!current()) return;
    if ((!result || result.ok === false) && phase !== 'pre-start') {
      result = await surfaceClient.requestStrategy('pre-start', task && task.id);
      if (!current()) return;
    }
    if (!result || result.ok === false) {
      activeStrategy = null;
      strategyCopy = () => { $('#strategyText').textContent = t(result && result.reason === 'strategy-guidance-disabled' ? '本地策略建议已关。' : '现在没有合适的。'); };
      strategyCopy();
      $('#strategyDetail').textContent = '';
      $('#strategyWhy').classList.add('hidden');
      return;
    }
    activeStrategy = result.strategy;
    strategyCopy = () => {
      $('#strategyText').textContent = t(result.strategy.text);
      $('#strategyDetail').textContent = t('{detail} · 来源：{source}', { detail: t(result.strategy.detail), source: result.strategy.sourceTier });
    };
    strategyCopy();
    // detail 和来源层级是内部术语，默认收起：一屏全是字 ADHD 会失去耐心。
    $('#strategyWhy').classList.remove('hidden');
    $('#strategyWhy').open = false;
    hideTransientStatus('#strategyStatus');
  }

  async function rateStrategy(button) {
    if (!activeStrategy) return;
    const strategy = activeStrategy, epoch = requestEpoch;
    activeStrategy = null;
    try {
      const result = await surfaceClient.sendStrategyFeedback(strategy.id, button.dataset.helpful === 'true');
      if (result?.ok === false) throw new Error('strategy-feedback-not-saved');
      if (epoch !== requestEpoch || !isOpen()) return;
      showTransientStatus('#strategyStatus', button.dataset.helpful === 'true'
        ? '已记在本机。' : '已记下，不再出现。');
    } catch (_) {
      if (epoch !== requestEpoch || !isOpen()) return;
      activeStrategy = strategy;
      showTransientStatus('#strategyStatus', '这次没能保存反馈，可以重试。');
    }
  }

  // 本地策略建议关掉后，「试个小办法」这条出路直接不提供；剩下两条不受影响。
  // 不再整块隐藏一个常驻区块，因为它已经搬进弹窗了。
  function renderStrategyRoute() {
    const enabled = Boolean(isStrategyGuidanceEnabled());
    $('#btnRouteTip').classList.toggle('hidden', !enabled);
  }

  // A collaboration proposal only stages an editable next action. The existing
  // confirmation remains the sole task write and rechecks the target identity.
  function stageNextAction(proposal, taskId) {
    const task = currentTask();
    if (!task || !taskId || task.id !== taskId) return { ok: false, reason: 'target-changed' };
    const nextAction = proposal?.nextAction || proposal?.steps?.[0]?.title;
    if (typeof nextAction !== 'string' || !nextAction.trim()) return { ok: false, reason: 'message-required' };
    requestEpoch += 1;
    syncBlockerForTask(task);
    shrinkEditorTaskId = task.id;
    shrinkCandidates = [];
    $('#shrinkNextAction').value = nextAction;
    shrinkSourceLabel = () => t('协作草稿 · 未保存'); renderShrinkSource();
    setStep('shrink');
    $('#stuckMask').classList.remove('hidden');
    $('#stuckMask').setAttribute('aria-hidden', 'false');
    return { ok: true };
  }

  function collaborate() {
    const task = currentTask();
    if (!task || typeof openCollaboration !== 'function') return;
    requestEpoch += 1;
    unstickAdvice.clear();
    void openCollaboration({ purpose: 'stuck', mode: 'small-step', taskId: task.id });
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    teardown.push(onLocaleChanged(repaintCopy));
    listen($('#btnStuck'), 'click', open);
    listen($('#stuckClose'), 'click', close);
    listen($('#btnStuckCollaborate'), 'click', collaborate);
    for (const button of $$('.blocker-chip')) {
      listen(button, 'click', () => chooseBlocker(button));
    }
    // 两条出路的差异就在这里：这一条会写 task.nextAction，下一条一个字也不改。
    listen($('#btnRouteShrink'), 'click', () => { void loadShrinkCandidates(); });
    listen($('#btnRouteTip'), 'click', () => { void requestStrategyForBlocker(); });
    listen($('#btnShrinkAnother'), 'click', nextShrinkCandidate);
    listen($('#shrinkCancel'), 'click', cancelShrink);
    listen($('#shrinkConfirm'), 'click', () => { void confirmShrink(); });
    listen($('#btnStrategyRequest'), 'click', () => { void requestStrategyForBlocker(); });
    for (const button of $$('.strategy-feedback')) {
      listen(button, 'click', () => { void rateStrategy(button); });
    }
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    requestEpoch += 1;
    while (teardown.length) teardown.pop()();
    selectedBlocker = null;
    selectedBlockerTaskId = null;
    shrinkCandidates = [];
    shrinkCandidateIndex = 0;
    shrinkEditorTaskId = null;
    activeStrategy = null; strategyCopy = () => {}; statusCopies.clear();
    shrinkSourceLabel = () => '';
    unstickAdvice.clear();
    trigger = null;
  }

  return Object.freeze({ mount, dispose, isOpen, close, syncBlockerForTask, renderStrategyRoute, stageNextAction,
    showStatus: source => showTransientStatus('#stuckCollaborationStatus', source) });
}


export { createPopoverStuck };
