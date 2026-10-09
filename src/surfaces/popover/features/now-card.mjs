import { createSessionStep } from './session-step.mjs';
import { createSurfaceMotion } from '../../shared/motion.mjs';
import { actionPresentation } from '../state/action-presentation.mjs';
'use strict';

// 此刻这一件:NOW 卡片、它下面那一屏步骤,以及「帮我选两个」那个候选面板。
//
// 这三块在页面上分开,但回答的是同一个问题——现在该做的是哪一件、它的下一步是
// 什么、如果还没选定该从哪两个里挑。所以「当前这一件是哪一件」这个判断只在这一
// 层存在,页面上别处要用就来问它。
//
// 这一层拥有两样状态:上一次拿回来的候选(投影里还没有推荐时的回退),以及打开候
// 选面板之前焦点在哪。后者以前是面板顶上的模块级 candidateReturnFocus。
//
// 它不认识计时器,也不认识「卡住了」那一层:两分钟救援怎么起、⚠ 徽标上写什么,
// 都是别人回答、由组合根接进来的。
function createPopoverNowCard({
  document, $, getState, getSession, escapeHTML, surfaceClient,
  taskLaunchBlockReason, focusActionMessage, taskActionMessage, scoreSummary,
  syncBlocker, canReceiveFocus, celebrate, completeTask, openTaskEditor, runQuickStart, showFocusStatus
} = {}) {
  if (!document || typeof $ !== 'function') {
    throw new TypeError('popover now card requires document and $');
  }
  for (const [name, fn] of Object.entries({
    getState, getSession, escapeHTML, taskLaunchBlockReason, focusActionMessage,
    taskActionMessage, scoreSummary, syncBlocker, canReceiveFocus, celebrate,
    openTaskEditor, completeTask, runQuickStart, showFocusStatus
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover now card requires ${name}`);
  }
  if (!surfaceClient) throw new TypeError('popover now card requires surfaceClient');

  const sessionStep = createSessionStep({ $, getSession, surfaceClient, showStatus: showFocusStatus });
  let cache = [];          // 上一次拿回来的候选:投影里还没有推荐时的回退
  let returnFocus = null;  // 打开候选面板之前焦点在哪
  let mounted = false;
  let picking = false;
  let choosing = false;
  let requestVersion = 0;
  const motion = createSurfaceMotion(document);
  const teardown = [];

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function currentTask() {
    const state = getState();
    const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
    const session = getSession();
    if ((session.running || session.paused) && session.mode === 'break') return null;
    const id = (session.running || session.paused)
      ? session.taskId
      : state && (state.nowTaskId || (state.nowTask && state.nowTask.id));
    return tasks.find(task => task.id === id) || null;
  }

  function candidateList() {
    const state = getState();
    const source = state && (state.recommendations || state.taskRecommendations);
    return source && Array.isArray(source.candidates) ? source.candidates : cache;
  }

  function recommendationForTask(task) {
    if (!task) return null;
    const state = getState();
    const nowCandidate = state && state.recommendations && state.recommendations.nowCandidate;
    if (nowCandidate && (nowCandidate.id || (nowCandidate.task && nowCandidate.task.id)) === task.id) {
      return nowCandidate;
    }
    return candidateList().find(candidate => (
      (candidate.id || (candidate.task && candidate.task.id)) === task.id
    )) || null;
  }

  // 运行或暂停时看会话任务，未开始时看待启动任务,所以一个区块就能覆盖全部状态。
  function sessionOrLaunchTask() {
    const state = getState();
    const session = getSession();
    if ((session.running || session.paused) && session.mode === 'break') return null;
    if (session.taskId) {
      return (state && state.tasks || []).find(item => item.id === session.taskId) || null;
    }
    return currentTask();
  }

  // nowMeta 只在这一件事被拦住时说话。轮次时长由底部的时长选择器和启动按钮各说
  // 一次，NOW 卡片再复述一遍只是把同一个数字摊成三行字。
  function showMeta(message = '') {
    const meta = $('#nowMeta');
    meta.textContent = message;
    meta.classList.toggle('hidden', !message);
  }

  function render() {
    if (!getState()) return;
    const activeTask = currentTask();
    const title = $('#nowCardTitle');
    const next = $('#nowNextAction');
    const badge = $('#nowBlockerBadge');
    const kick = $('#btnNowKickstart');
    const rescueNote = $('#rescueNote');
    const session = getSession();
    const freeSession = !activeTask && (session.running || session.paused);
    const hasOpenTasks = (getState().tasks || []).some(task => !task.done);
    const presentation = actionPresentation(getState(), session, activeTask, recommendationForTask(activeTask), { hasOpenTasks });
    // 没有可换的就不显示“换一件”；没有选定任务时“有点卡”没有对象。
    $('#btnChooseCandidates')?.classList.toggle('hidden', !hasOpenTasks);
    $('#btnStuck')?.classList.toggle('hidden', !activeTask);
    document.body.dataset.actionState = presentation.phase;
    const stateLabel = $('#nowStateLabel');
    if (stateLabel) stateLabel.textContent = presentation.label;
    $('#nowCard').dataset.freeSession = freeSession ? 'true' : 'false';
    if (!activeTask) {
      syncBlocker(null);
      title.textContent = freeSession
        ? session.mode === 'break' ? '休息一下' : '自由专注'
        : '还没有选定任务';
      next.textContent = freeSession
        ? session.mode === 'break' ? '放松片刻，给自己一点空隙' : '这一段时间，留给手边的事'
        : presentation.action;
      showMeta('');
      badge.classList.add('hidden');
      kick.disabled = true;
      if (rescueNote) rescueNote.textContent = '先选定一件事，两分钟才有落点。';
      return;
    }
    // 卡在哪归「卡住了」那一层：这里问它一次，顺手让它认领当前这件任务，
    // 换回来的就是徽标上该写的话。卡片自己再存一份的表现是两处对不上。
    const blockerLabel = syncBlocker(activeTask);
    // A selected Now task must never borrow another task's explanation or
    // duration merely because it is outside the current top-two suggestions.
    // 推荐列表不包含已完成任务，所以当前任务一完成就取不到自己的 candidate；
    // 一旦回退到 candidates[0]，下一步就会显示成别的任务的步骤。
    const launchBlockReason = taskLaunchBlockReason(activeTask);
    title.textContent = activeTask.title;
    // 一件已完成的任务没有下一物理动作，即使它的子项还没勾完；
    // 否则会和下面那句“这件任务已经完成”相互矛盾。
    next.textContent = presentation.action;
    badge.textContent = blockerLabel ? `卡在：${blockerLabel}` : '';
    badge.classList.toggle('hidden', !blockerLabel);
    showMeta(launchBlockReason ? focusActionMessage(launchBlockReason) : '');
    const hardBlocked = ['task-completed', 'task-expired', 'occurrence-skipped'].includes(launchBlockReason);
    // 两分钟需要一个已写下的下一步，否则它只把“不知道从哪开始”推到两分钟之后。
    const hasLanding = Boolean(activeTask.nextAction);
    kick.disabled = hardBlocked || !hasLanding;
    if (rescueNote) {
      rescueNote.textContent = hardBlocked
        ? focusActionMessage(launchBlockReason)
        : hasLanding
          ? `两分钟内只做：${activeTask.nextAction}`
          : '先用“换个更小的下一步”写下落点。';
    }
  }

  // 当前这一件只在一个地方披露：计时器下面的 #nowTaskDetail。之前进度条上方还有
  // 一行“当前：XXX”，同一屏把任务名说两遍。
  function renderDetail() {
    if (!getState()) return;
    const host = $('#nowTaskDetail');
    const task = sessionOrLaunchTask();
    sessionStep.render(task);
    if (!task) {
      host.classList.add('hidden');
      $('#nowTaskSteps').innerHTML = '';
      return;
    }
    host.classList.remove('hidden');
    const detailTitle = $('#nowTaskDetailTitle');
    detailTitle.textContent = task.title;
    // 卡片上方的标题已经是同一件事：再写一遍小字只会让人以为是另一件。名字保留给读屏当区块标签，
    // 只有和卡片标题不同（例如计时里的任务不是“现在”那件）才显示出来。
    const cardTitle = $('#nowCardTitle');
    detailTitle.classList.toggle('sr-only', Boolean(cardTitle) && cardTitle.textContent === task.title);
    const isSkipped = Boolean(task.skippedAt) && !task.done;
    const isReadOnly = task.done || isSkipped;
    const completeButton = $('#btnCompleteNowTask');
    if (completeButton) completeButton.classList.toggle('hidden', isReadOnly);
    const steps = Array.isArray(task.steps) ? task.steps : [];
    const nextStepId = steps.find(step => !step.done);
    const list = $('#nowTaskSteps');
    if (!steps.length) {
      if (isReadOnly) {
        list.innerHTML = '';
        return;
      }
      list.innerHTML = '';
      return;
    }
    // 步骤勾选是单向的：勾上就是做完了，没有“标记未完成”这个动作。
    list.className = 'task-steps';
    list.innerHTML = steps.map(step => `
      <button type="button" class="step-item ${step.done ? 'done' : ''}${nextStepId && step.id === nextStepId.id ? ' step-next' : ''}" data-step-id="${escapeHTML(step.id)}" aria-pressed="${step.done ? 'true' : 'false'}" aria-label="${step.done ? '已完成步骤' : isReadOnly ? '只读步骤' : '完成步骤'}：${escapeHTML(step.title)}"${isReadOnly || step.done ? ' disabled' : ''}>
        <span class="step-check ${step.done ? 'checked' : ''}"></span>
        <span class="step-text">${escapeHTML(step.title)}</span>
      </button>`).join('');
    list.querySelectorAll('.step-item').forEach(button => {
      button.addEventListener('click', async () => {
        const stepId = button.dataset.stepId;
        const step = steps.find(item => item.id === stepId);
        if (isReadOnly || !step || step.done) return;
        if (sessionOrLaunchTask()?.id !== task.id) return;
        const result = await surfaceClient.completeStep(task.id, stepId);
        if (result && result.ok === false) {
          showFocusStatus(taskActionMessage(result.reason));
          return;
        }
        celebrate();
      });
    });
  }

  // 候选面板住在 Today，所以只有 Today 里那个按钮能控制它。任务 tab 里曾经也有一个
  // 同名按钮，但它指向一个属于 hidden 面板的容器 —— 点下去什么都不会发生。
  function setPanelOpen(open) {
    const panel = $('#candidatePanel');
    panel.classList.toggle('hidden', !open);
    panel.setAttribute('aria-hidden', String(!open));
    const trigger = $('#btnChooseCandidates');
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }

  function closePanel({ focusNow = false } = {}) {
    requestVersion++;
    motion.stop();
    setPanelOpen(false);
    const returnTarget = focusNow && !$('#btnNowKickstart').disabled
      ? $('#btnNowKickstart')
      : returnFocus;
    returnFocus = null;
    requestAnimationFrame(() => {
      if (canReceiveFocus(returnTarget)) returnTarget.focus();
    });
  }

  function renderCandidates(candidates) {
    cache = (candidates || []).slice(0, 2);
    const grid = $('#candidateGrid');
    grid.innerHTML = '';
    cache.forEach((candidate, index) => {
      const task = candidate.task || candidate;
      const sourceRole = candidate.role || candidate.label || (index === 0 ? '综合优先' : '最容易开始');
      const role = candidate.strategy === 'priority' || candidate.strategy === 'importance' || sourceRole === '最重要'
        ? '综合优先' : sourceRole;
      const shortRole = role.includes('同时') ? '适合现在' : role.includes('容易') ? '容易开始' : '优先考虑';
      const summary = scoreSummary(candidate);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'candidate-card';
      card.innerHTML = `<span class="candidate-role">${escapeHTML(shortRole)}</span>
        <strong>${escapeHTML(task.title)}</strong><span class="candidate-arrow" aria-hidden="true">↗</span>`;
      card.setAttribute('aria-label', `换成${task.title}`);
      // 排序依据是内部术语，只放进工具提示：想知道的人悬停就能看到。
      card.title = `排序依据：${summary || '能量、时长和启动成本'}`;
      card.addEventListener('click', async () => {
        if (choosing) return;
        choosing = true;
        card.disabled = true;
        try {
          const result = await surfaceClient.setNowTask(task.id);
          if (result?.ok === false) { showFocusStatus(taskActionMessage(result.reason)); return; }
          closePanel({ focusNow: true });
          render();
        } catch { showFocusStatus('切换未完成，请再试一次。'); }
        finally { choosing = false; card.disabled = false; }
      });
      grid.appendChild(card);
    });
    setPanelOpen(cache.length > 0);
    void motion.enter(grid);
    render();
  }

  async function pickCandidates() {
    if (!$('#candidatePanel').classList.contains('hidden')) { closePanel(); return; }
    if (picking) return;
    picking = true;
    const version = ++requestVersion;
    returnFocus = document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : $('#btnChooseCandidates');
    try {
      const result = await surfaceClient.pickOneTask({ limit: 2, explain: true });
      if (version !== requestVersion) return;
      const candidates = result && Array.isArray(result.candidates) ? result.candidates : (result ? [result] : []);
      if (candidates.length) renderCandidates(candidates);
      else showFocusStatus('暂无可切换的任务。');
    } catch { showFocusStatus('暂时无法读取任务，请再试一次。'); }
    finally { picking = false; }
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    sessionStep.mount();
    listen($('#btnChooseCandidates'), 'click', () => { void pickCandidates(); });
    listen($('#closeCandidates'), 'click', () => closePanel());
    // 两分钟救援必须绑一个可观察的下一动作：没有落点的两分钟结束后依旧不知道
    // 停在哪里，那只是把启动困难推到两分钟之后。怎么起是计时器的事,这里只回答
    // 「起的是哪一件」。
    listen($('#btnNowKickstart'), 'click', async () => {
      const first = candidateList()[0];
      const task = currentTask() || (first && (first.task || first));
      if (!task || !task.nextAction) return;
      await runQuickStart(task);
    });
    // ✎ 长在 NOW 卡片上,不属于「卡住了」那一层。
    listen($('#btnEditNowTask'), 'click', () => {
      const task = sessionOrLaunchTask();
      const session = getSession();
      if (task && !(session.taskId === task.id && (session.running || session.paused))) openTaskEditor(task);
    });
    listen($('#btnCompleteNowTask'), 'click', async () => {
      const task = sessionOrLaunchTask();
      if (task && !task.done && !task.skippedAt) await completeTask(task);
    });
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    requestVersion++;
    motion.dispose();
    sessionStep.dispose();
    while (teardown.length) teardown.pop()();
    cache = [];
    returnFocus = null;
  }

  return Object.freeze({ mount, dispose, render, renderDetail, currentTask });
}


export { createPopoverNowCard };
