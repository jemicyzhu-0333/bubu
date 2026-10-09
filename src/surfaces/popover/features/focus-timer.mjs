'use strict';

// 计时这一层:头上那枚迷你计时、⚡ 那一排按钮、每一秒的倒数,以及底下那个时长
// 选择器。它们回答的是同一个问题——这一轮还剩多久、现在能按哪个键、下一轮打算
// 跑多长。
//
// 它拥有四样状态:倒数用的单调锚点(以前是面板顶上的模块级 pomoCountdownAnchor)、
// 结构与时长两处防闪烁的上一次键值,以及每 500ms 那一次心跳本身——所以这一层卸
// 载之后,不会再有一个计时器留在后台跑。
//
// 「这一件能不能起」这个判断只在这里存在:任务行上的 ⚡、NOW 卡片上的两分钟救
// 援都来问它,答回去之后各自去说人话。它不认识 NOW 卡片,「此刻在做哪一件」是
// 注进来的。
function createPopoverFocusTimer({
  document, $, $$, getState, getSession, pad2, setStatusLine, sessionDuration,
  surfaceClient, focusActionMessage, currentTask, refreshProjection = async () => {}
} = {}) {
  if (!document || typeof $ !== 'function' || typeof $$ !== 'function') {
    throw new TypeError('popover focus timer requires document, $ and $$');
  }
  for (const [name, fn] of Object.entries({
    getState, getSession, pad2, setStatusLine, focusActionMessage, currentTask
  })) {
    if (typeof fn !== 'function') throw new TypeError(`popover focus timer requires ${name}`);
  }
  if (!sessionDuration) throw new TypeError('popover focus timer requires sessionDuration');
  if (!surfaceClient) throw new TypeError('popover focus timer requires surfaceClient');

  let pomoCountdownAnchor = null;   // 倒数的单调锚点:一轮的身份 + 采样时刻
  let lastPomoStructureKey = '';
  let lastDurationKey = '';
  let ticker = null;
  let mounted = false;
  let durationWrite = Promise.resolve(true);
  let durationRevision = 0;
  let acknowledgedMinutes = null;
  let renderedAction = null;
  let renderedHeld = false;
  let actionGeneration = 0;
  let pendingAction = null;
  let visible = true;
  let visibilityGeneration = 0;
  const teardown = [];

  function listen(target, type, handler) {
    if (typeof target?.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function countdownSessionKey(session) {
    if (!session || (!session.running && !session.paused)) return null;
    return [
      session.sessionId,
      session.status,
      session.startedAt,
      session.elapsedBeforeStartMs,
      session.plannedDurationMs
    ].join('\u0000');
  }

  function countdownRemainingAt(anchor, monotonicNow) {
    if (!anchor) return null;
    const elapsed = anchor.paused
      ? 0
      : Math.max(0, Number(monotonicNow) - anchor.sampledAt);
    return Math.max(0, anchor.remainingMs - elapsed);
  }

  function syncPomoCountdownAnchor() {
    const state = getState();
    const p = getSession();
    if (!p.running && !p.paused) {
      pomoCountdownAnchor = null;
      return null;
    }
    const totalMin = p.mode === 'break' ? state.settings.breakMinutes : state.settings.pomodoroMinutes;
    const total = p.plannedDurationMs || totalMin * 60 * 1000;
    const reportedRemaining = Number(p.remainingMs);
    const elapsedBeforePause = Number(p.elapsedMs ?? p.elapsedBeforeStartMs);
    const fallbackRemaining = total - (Number.isFinite(elapsedBeforePause) ? elapsedBeforePause : 0);
    const remainingMs = Math.max(0, Math.min(
      total,
      Number.isFinite(reportedRemaining) ? reportedRemaining : fallbackRemaining
    ));
    pomoCountdownAnchor = {
      key: countdownSessionKey(p),
      remainingMs,
      sampledAt: performance.now(),
      paused: p.paused
    };
    return pomoCountdownAnchor;
  }

  // 专注时长的归一化直接用共享模块：两分钟救援不在这个区间里，引擎给出的
  // activation 信号会被夹到下限，不会假扮成一轮完整专注。
  function focusRange() {
    const state = getState();
    const projected = state && state.focusMinutes;
    if (projected?.chosen === acknowledgedMinutes) acknowledgedMinutes = null;
    return {
      min: (projected && projected.min) || sessionDuration.MIN_FOCUS_MINUTES,
      max: (projected && projected.max) || sessionDuration.MAX_FOCUS_MINUTES,
      presets: (projected && projected.presets) || sessionDuration.FOCUS_MINUTE_PRESETS,
      chosen: sessionDuration.normalizeFocusMinutes(
        acknowledgedMinutes ?? (projected && projected.chosen),
        state && state.settings && state.settings.pomodoroMinutes
      )
    };
  }

  function focusLaunchContext() {
    const task = currentTask();
    return {
      task,
      taskId: task ? task.id : null,
      // Today 的选择优先于引擎推荐：时长选择器是用户刚刚做的决定。
      minutes: focusRange().chosen
    };
  }

  function taskLaunchBlockReason(task, now = Date.now()) {
    if (!task) return null;
    if (task.done) return 'task-completed';
    if (task.skippedAt) return 'occurrence-skipped';
    // 自动失效与任何分类无关：只要这件任务带着失效时间且已过，就需要显式续期。
    const expiresAt = task.expiresAt ? Date.parse(task.expiresAt) : Number.NaN;
    if (task.expired === true || (Number.isFinite(expiresAt) && expiresAt <= now)) {
      return 'task-expired';
    }
    const scheduledAt = task.scheduledFor ? Date.parse(task.scheduledFor) : Number.NaN;
    if (Number.isFinite(scheduledAt) && scheduledAt > now) return 'task-scheduled';
    return null;
  }

  function showFocusActionStatus(message = '') {
    setStatusLine('#focusActionStatus', message);
  }

  async function runFocusAction(kind, task, minutes) {
    try {
      const blockReason = taskLaunchBlockReason(task);
      if (['task-expired', 'task-completed', 'occurrence-skipped'].includes(blockReason)) {
        showFocusActionStatus(focusActionMessage(blockReason));
        return { ok: false, reason: blockReason };
      }
      if (blockReason === 'task-scheduled') {
        const selected = await surfaceClient.setNowTask(task.id);
        if (!selected || selected.ok === false) {
          const reason = selected && selected.reason || blockReason;
          showFocusActionStatus(focusActionMessage(reason));
          return { ok: false, reason };
        }
      }
      // The engine may recommend a two-minute activation experiment. Only the
      // dedicated quick-start path may use that reward contract; a full focus
      // session is always at least the five-minute minimum accepted by settings.
      const state = getState();
      const fullFocusMinutes = sessionDuration.normalizeFocusMinutes(
        minutes,
        state && state.settings && state.settings.pomodoroMinutes
      );
      const result = kind === 'quick-start'
        ? await surfaceClient.kickstart(task ? task.id : null)
        : await surfaceClient.startPomodoro(task ? task.id : null, fullFocusMinutes);
      if (!result || result.ok === false) {
        showFocusActionStatus(focusActionMessage(result && result.reason));
        return result || { ok: false, reason: 'unknown' };
      }
      showFocusActionStatus('');
      return result;
    } catch (_) {
      showFocusActionStatus(focusActionMessage());
      return { ok: false, reason: 'ipc-failed' };
    }
  }

  // -- Pomodoro time & label (called from local ticker, cheap, only touches numeric text)
  function renderPomoStructure() {
    const state = getState();
    if (!state) return;
    const p = getSession();
    const launch = focusLaunchContext();
    const launchBlockReason = taskLaunchBlockReason(launch.task);
    const action = visible && p.paused && p.resumeAction?.sessionId === p.sessionId ? p.resumeAction : null;
    const actionKey = [p.sessionId, action?.intent, action?.enabled, action?.reason].join('|');
    const key = `${actionKey}|${p.status}|${p.mode}|${p.taskId}|${p.paused ? p.remainingMs : ''}|${p.awaitingOfflineConfirmation ? 1 : 0}|${state.settings.pomodoroMinutes}|${launch.taskId || ''}|${launch.minutes}|${launch.task ? launch.task.title : ''}|${launchBlockReason || ''}`;
    if (key === lastPomoStructureKey) return;
    lastPomoStructureKey = key;
    actionGeneration++;
    renderedAction = action ? Object.freeze({ ...action }) : null;
    renderedHeld = p.paused && (p.awaitingOfflineConfirmation === true || p.remainingMs === 0);

    const pomoLabel = $('#pomoLabel');
    const btnStart = $('#btnStartFocus');
    const btnStop = $('#btnStopFocus');
    const btnStopText = $('#btnStopFocusText');
    const btnPause = $('#btnPauseFocus');
    const btnResume = $('#btnResumeFocus');
    const btnResumeText = $('#btnResumeFocusText');
    btnStopText.textContent = '结束这段';
    btnResumeText.textContent = '继续';
    btnStop.setAttribute('aria-label', '结束这段计时');
    btnResume.setAttribute('aria-label', '继续计时');
    btnResume.disabled = false;
    btnStop.disabled = renderedHeld && !renderedAction;

    if (p.running) {
      showFocusActionStatus('');
      pomoLabel.textContent = p.mode === 'break'
        ? '休息中'
        : p.kind === 'quick-start' ? '先做两分钟' : '专注中';
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');
      btnPause.classList.toggle('hidden', p.mode === 'break');
      btnResume.classList.add('hidden');
    } else if (p.paused) {
      showFocusActionStatus('');
      const awaitingConfirmation = renderedHeld || action?.intent === 'confirm-completion';
      pomoLabel.textContent = action?.reason === 'recovery-state-inconsistent' ? '计时等待核对' : awaitingConfirmation
        ? '这一轮已到点，等待确认计入完成'
        : (p.mode === 'break' ? '休息已暂停' : '已暂停');
      btnStopText.textContent = awaitingConfirmation ? '放弃本轮' : '结束这段';
      btnResumeText.textContent = awaitingConfirmation ? '确认计入完成' : '继续';
      btnStop.setAttribute('aria-label', awaitingConfirmation ? '放弃本轮，不发完成奖励' : '结束这段计时');
      btnResume.setAttribute('aria-label', awaitingConfirmation ? '确认本轮计入完成' : '继续计时');
      btnResume.disabled = !action || action.enabled !== true;
      if (btnResume.disabled) {
        const message = focusActionMessage(action?.reason || 'resume-action-unavailable');
        showFocusActionStatus(message);
        btnResume.setAttribute('aria-label', message);
      }
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.remove('hidden');
    } else {
      pomoLabel.textContent = '';
      btnStart.classList.remove('hidden');
      btnStop.classList.add('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.add('hidden');
      $('#btnStartFocusText').textContent = launch.task
        ? '开始专注'
        : '开始自由专注';
      const hardBlocked = ['task-completed', 'task-expired', 'occurrence-skipped'].includes(launchBlockReason);
      btnStart.disabled = hardBlocked;
      btnStart.setAttribute('aria-label', launch.task ? `为当前任务“${launch.task.title}”专注 ${launch.minutes} 分钟` : `开始不关联任务的 ${launch.minutes} 分钟自由专注`);
      $('#pomoProgressFill').style.width = '0%';
      $('#pomoProgress').setAttribute('aria-valuenow', '0');
      $('#pomoProgress').setAttribute('aria-valuetext', '尚未开始');
      $('#pomoTime').textContent = `${pad2(launch.minutes)}:00`;
      $('#pomoTime').setAttribute('aria-label', `${launch.minutes} 分钟待启动`);
      $('#pomoTime').className = 'pomo-time';
    }
    renderHeaderMiniTimer(p);
    publishSessionState(p);
  }

  // 布局跟着专注状态走：body[data-session] 由这一层写，样式层据此收起专注时
  // 用不到的区块（theme.css）。写属性而不是切换一串 hidden，是为了让“专注中只留
  // 当前任务、剩余时间和暂停”这条规则只在一个地方成立。
  function sessionStateOf(session) {
    if (!session || (!session.running && !session.paused)) return 'idle';
    if (session.mode === 'break') return 'break';
    return session.paused ? 'paused' : 'focus';
  }

  function publishSessionState(session = getSession()) {
    const body = document.body;
    if (!body) return;
    const next = sessionStateOf(session);
    if (body.dataset.session !== next) body.dataset.session = next;
  }

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  function todayLabel(now = Date.now()) {
    const date = new Date(now);
    return `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  // 日历时间与专注的单调时钟分开，暂停和自由专注都不覆盖日期。
  function renderHeaderMiniTimer() {
    const mini = $('#headerMiniTime');
    if (!mini) return;
    const label = todayLabel();
    if (mini.textContent === label) return;
    mini.textContent = label;
    mini.classList.add('is-idle');
    mini.setAttribute('aria-label', `当前时间 ${mini.textContent}`);
  }

  // -- Pomo countdown (per-second, only text nodes, no rebuild)
  function renderPomoTick() {
    const state = getState();
    if (!state) return;
    const p = getSession();
    if (!p.running && !p.paused) return;
    const totalMin = p.mode === 'break' ? state.settings.breakMinutes : state.settings.pomodoroMinutes;
    const total = p.plannedDurationMs || totalMin * 60 * 1000;
    if (!pomoCountdownAnchor || pomoCountdownAnchor.key !== countdownSessionKey(p)) {
      syncPomoCountdownAnchor();
    }
    const projectedRemaining = countdownRemainingAt(pomoCountdownAnchor, performance.now());
    const remain = Math.max(0, Math.min(total, Number.isFinite(projectedRemaining) ? projectedRemaining : total));
    const elapsed = Math.max(0, total - remain);
    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);

    const pomoTime = $('#pomoTime');
    const newText = `${pad2(m)}:${pad2(s)}`;
    if (pomoTime.textContent !== newText) pomoTime.textContent = newText;
    renderHeaderMiniTimer(p);
    pomoTime.setAttribute('aria-label', `剩余 ${m} 分 ${s} 秒`);

    const wantClass = 'pomo-time ' + (p.mode === 'break' ? 'break' : 'focus');
    if (pomoTime.className !== wantClass) pomoTime.className = wantClass;

    const pct = Math.min(100, (elapsed / total) * 100);
    const fill = $('#pomoProgressFill');
    const newW = `${pct}%`;
    if (fill.style.width !== newW) fill.style.width = newW;
    const orbit = $('#focusOrbit');
    if (orbit) orbit.style.strokeDashoffset = String(100 - pct);
    const progress = $('#pomoProgress');
    progress.setAttribute('aria-valuenow', String(Math.round(pct)));
    progress.setAttribute('aria-valuetext', `已完成 ${Math.round(pct)}%`);
  }

  // 时长选择器：未开始时改的是下一轮的计划，进行/暂停中改的是本轮。
  // 两种情形都只能落在 [min, max] 里，而且本轮不能缩到已投入时长之下。
  function showDurationStatus(message = '') {
    const status = $('#durationStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
  }

  function durationFloorMinutes() {
    const session = getSession();
    if (!session.running && !session.paused) return focusRange().min;
    if (session.kind !== 'focus') return focusRange().min;
    return sessionDuration.minimumAdjustableMinutes(session.elapsedMs || 0);
  }

  function renderDurationPicker() {
    if (!getState()) return;
    const host = $('#durationPresets');
    if (!host) return;
    const range = focusRange();
    const session = getSession();
    const live = (session.running || session.paused) && session.kind === 'focus';
    const current = live
      ? Math.round((session.plannedDurationMs || 0) / 60000)
      : range.chosen;
    const floor = durationFloorMinutes();
    const key = `${range.presets.join(',')}|${range.min}|${range.max}|${current}|${floor}|${live ? 1 : 0}`;
    if (key === lastDurationKey) return;
    lastDurationKey = key;

    $('#durationValue').textContent = `${current} 分钟`;
    const summary = $('#durationSummary');
    if (summary) summary.textContent = `${current} 分钟`;
    const slider = $('#durationSlider');
    if (slider) {
      slider.min = String(live ? Math.max(range.min, floor) : range.min);
      slider.max = String(range.max);
      slider.value = String(current);
      slider.setAttribute('aria-valuetext', `${current} 分钟`);
    }
    $('#durationPickerLabel').textContent = live ? '本轮时长' : '这一段';
    const stepDown = $('[data-duration-step="-1"]');
    const stepUp = $('[data-duration-step="1"]');
    if (stepDown) stepDown.disabled = current - sessionDuration.FOCUS_MINUTE_STEP < Math.max(range.min, live ? floor : range.min);
    if (stepUp) stepUp.disabled = current >= range.max;

    host.innerHTML = '';
    for (const preset of range.presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chip duration-chip${preset === current ? ' active' : ''}`;
      button.dataset.minutes = String(preset);
      button.setAttribute('aria-pressed', String(preset === current));
      button.textContent = `${preset}`;
      if (live && preset < floor) {
        button.disabled = true;
        button.title = `已经投入 ${floor} 分钟，不能缩到这之下`;
      }
      button.addEventListener('click', () => { void applyChosenMinutes(preset); });
      host.appendChild(button);
    }
  }

  function applyChosenMinutes(minutes) {
    const next = sessionDuration.clampFocusMinutes(minutes);
    if (next === null) return;
    const version = ++durationRevision;
    // Serialize gestures and wait for their receipt before starting a session.
    durationWrite = durationWrite.then(async () => {
      if (!mounted) return false;
      const session = getSession();
      const live = (session.running || session.paused) && session.kind === 'focus';
      try {
        const result = live
          ? await surfaceClient.adjustPomodoroDuration(next)
          : await surfaceClient.updateSettings({ lastChosenFocusMinutes: next });
        if (result?.ok === false) throw new Error(focusActionMessage(result.reason));
        if (!live) acknowledgedMinutes = next;
        if (mounted && version === durationRevision) showDurationStatus('');
        return true;
      } catch (_) {
        if (mounted && version === durationRevision) {
          showDurationStatus('时长未保存，请重试');
          lastDurationKey = '';
          renderDurationPicker();
        }
        return false;
      }
    });
    return durationWrite;
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    const unsubscribeHidden = surfaceClient.onPopoverHidden?.(hideActions);
    if (typeof unsubscribeHidden === 'function') teardown.push(unsubscribeHidden);
    listen(document.defaultView, 'focus', () => { void reopenActions(); });
    listen(document, 'visibilitychange', () => {
      if (document.hidden) hideActions();
      else void reopenActions();
    });
    listen($('#durationSlider'), 'input', event => {
      $('#durationValue').textContent = `${event.target.value} 分钟`;
      event.target.setAttribute('aria-valuetext', `${event.target.value} 分钟`);
    });
    listen($('#durationSlider'), 'change', event => { void applyChosenMinutes(Number(event.target.value)); });
    listen($('#btnStartFocus'), 'click', async () => {
      if (!await durationWrite || !mounted) return;
      const launch = focusLaunchContext();
      await runFocusAction('focus', launch.task, launch.minutes);
    });
    // −/+ 步进与预设走同一条路径，所以“本轮不能缩到已投入之下”只存在一处。
    $$('.duration-step').forEach(button => listen(button, 'click', async () => {
      const session = getSession();
      const live = (session.running || session.paused) && session.kind === 'focus';
      const current = live ? Math.round((session.plannedDurationMs || 0) / 60000) : focusRange().chosen;
      await applyChosenMinutes(sessionDuration.stepFocusMinutes(current, Number(button.dataset.durationStep)));
    }));
    listen($('#btnStopFocus'), 'click', () => runSessionAction('stop'));
    listen($('#btnPauseFocus'), 'click', () => {
      if (typeof surfaceClient.pausePomodoro === 'function') surfaceClient.pausePomodoro();
    });
    listen($('#btnResumeFocus'), 'click', () => runSessionAction('resume'));
    // 只有倒数在本地走秒:它只改文字和宽度，从不重建列表。这颗心跳跟着这一层的
    // 挂载周期,所以卸载之后不会有一个计时器留在后台空转。
    ticker = setInterval(() => {
      renderHeaderMiniTimer();
      if (getState() && getSession().running) renderPomoTick();
    }, 500);
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    actionGeneration++;
    while (teardown.length) teardown.pop()();
    if (ticker) clearInterval(ticker);
    ticker = null;
    pomoCountdownAnchor = null;
    lastPomoStructureKey = '';
    lastDurationKey = '';
  }

  async function runSessionAction(kind) {
    if (!mounted || !visible || pendingAction) return;
    const action = renderedAction;
    if (kind === 'resume' && (!action?.enabled || !['resume', 'confirm-completion'].includes(action.intent))) return;
    if (kind === 'stop' && renderedHeld && !action) return;
    const generation = actionGeneration;
    const token = {};
    pendingAction = token;
    try {
      const result = kind === 'resume'
        ? await surfaceClient.resumePomodoro({ sessionId: action.sessionId, intent: action.intent })
        : await surfaceClient.stopPomodoro(action?.intent === 'confirm-completion' ? { sessionId: action.sessionId } : undefined);
      if (mounted && generation === actionGeneration) {
        showFocusActionStatus(result?.ok === false ? focusActionMessage(result.reason) : '');
      }
      return result;
    } catch (_) {
      if (mounted && generation === actionGeneration) showFocusActionStatus(focusActionMessage());
    } finally {
      if (pendingAction === token) pendingAction = null;
    }
  }

  function hideActions() {
    visible = false; visibilityGeneration++; actionGeneration++;
    renderedAction = null; pendingAction = null; lastPomoStructureKey = '';
    $('#btnResumeFocus').disabled = true;
  }

  async function reopenActions() {
    if (document.hidden) return;
    hideActions();
    const generation = visibilityGeneration;
    try { if (!await refreshProjection()) return; }
    catch (_) { return; }
    if (!mounted || generation !== visibilityGeneration) return;
    visible = true; lastPomoStructureKey = ''; renderPomoStructure();
  }

  return Object.freeze({
    mount,
    dispose,
    renderPomoStructure,
    renderPomoTick,
    renderDurationPicker,
    syncPomoCountdownAnchor,
    taskLaunchBlockReason,
    runFocusAction,
    focusRange,
    showFocusActionStatus
  });
}


export { createPopoverFocusTimer };
