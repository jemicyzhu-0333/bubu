import BubuTaskDates from './task-dates.mjs';
import BubuSessionDuration from '../capabilities/execution/contract/session-duration.mjs';
import BubuStateChannel from '../core/state-channel.mjs';
import BubuKeyboardNavigation from '../core/keyboard-navigation.mjs';
import { createPopoverSurfaceClient } from '../surfaces/popover/adapter/surface-client.mjs';
import { createPopoverDom } from '../surfaces/popover/ui/dom.mjs';
import { createPopoverMessages } from '../surfaces/popover/ui/messages.mjs';
import { createPopoverModalPrimitive } from '../surfaces/popover/ui/modal.mjs';
import { createPopoverModalRegistry } from '../surfaces/popover/ui/modal-registry.mjs';
import { POPOVER_LANDING_BLOCKING_MODALS, registerPopoverModals } from '../surfaces/popover/ui/modal-layer.mjs';
import { createPopoverTaskInput } from '../surfaces/popover/ui/task-input.mjs';
import { createPopoverProjectionStore } from '../surfaces/popover/state/projection-store.mjs';
import { popoverSessionView } from '../surfaces/popover/state/session-view.mjs';
import { createPopoverCompanionArt } from '../surfaces/popover/features/companion-art.mjs';
import { createPopoverCompanionFeature } from '../surfaces/popover/features/companion.mjs';
import { createPopoverSkinPicker } from '../surfaces/popover/features/skin-picker.mjs';
import { createPopoverWardrobeFeature } from '../surfaces/popover/features/wardrobe.mjs';
import { createPopoverProgressFeature } from '../surfaces/popover/features/progress.mjs';
import { createPopoverRoutinesFeature } from '../surfaces/popover/features/routines.mjs';
import { createTimelineMoodDeletion } from '../surfaces/popover/features/timeline-mood-deletion.mjs';
import { createPopoverTimelineFeature } from '../surfaces/popover/features/timeline.mjs';
import { createPopoverQuickStartLanding } from '../surfaces/popover/features/quick-start-landing.mjs';
import { createPlanningPreferencesFeature } from '../surfaces/popover/features/planning-preferences.mjs';
import { createPopoverTaskCreation } from '../surfaces/popover/features/task-creation.mjs';
import { createPopoverTaskEditor } from '../surfaces/popover/features/task-editor.mjs';
import { createPopoverCompleteConfirm } from '../surfaces/popover/features/complete-confirm.mjs';
import { createPopoverCompletionFeedback } from '../surfaces/popover/features/completion-feedback.mjs';
import { createPopoverFocusTimer } from '../surfaces/popover/features/focus-timer.mjs';
import { createPopoverTaskList } from '../surfaces/popover/features/task-list.mjs';
import { createPopoverNowCard } from '../surfaces/popover/features/now-card.mjs';
import { createPopoverInboxFeature } from '../surfaces/popover/features/inbox.mjs';
import { createPopoverCaptureBar } from '../surfaces/popover/features/capture-bar.mjs';
import { createPopoverReviewFeature } from '../surfaces/popover/features/review.mjs';
import { createPopoverBreakdownFeature } from '../surfaces/popover/features/breakdown.mjs';
import { createPopoverStuck } from '../surfaces/popover/features/stuck.mjs';
import { createPopoverUnstickAdvice } from '../surfaces/popover/features/unstick-advice.mjs';
import { createPopoverMemoryList } from '../surfaces/popover/features/memory-list.mjs';
import { createPopoverEnergyStrip } from '../surfaces/popover/features/energy-strip.mjs';
import { createPopoverTodayOverview } from '../surfaces/popover/features/today-overview.mjs';
import { createActivityMirrorSettings } from '../surfaces/popover/features/activity-mirror-settings.mjs';
import { createPopoverAppChrome } from '../surfaces/popover/features/app-chrome.mjs';
import { createPopoverSettingsDrawer } from '../surfaces/popover/features/settings-drawer.mjs';
import { createPopoverShortcutSetting } from '../surfaces/popover/features/shortcut-setting.mjs';
import { createPopoverTodayFeature } from '../surfaces/popover/features/today.mjs';
import { createPopoverWorkFeature } from '../surfaces/popover/features/work.mjs';
import { createPopoverSettingsFeature } from '../surfaces/popover/features/settings.mjs';
import { createPopoverShellFeature } from '../surfaces/popover/features/shell.mjs';

// ============================================================
// 小步 — 面板的组合根
// ============================================================
// 这一面上不再有任何一处业务判断、DOM 写入或防闪烁键值:它们各自住在
// src/surfaces/popover 下面的那些层里。这里只做四件事，也只按这四段来读:
//
//   1. 共享原语——DOM 助手、人话、共享 contract、弹层机制、投影仓库;
//   2. 跨层共用的那几条——本次渲染的会话读模型、两行状态、关闭弹层后的焦点归属、
//      一件任务的重复系列、翻页并进投影缓存。它们之所以在这里，是因为投影缓存
//      （state）住在这一面上，而不止一层要读同一个答案;
//   3. 各层的构造——每一层拿到的都是它自己要的那几件,谁认识谁由这里说,层与层
//      之间不互相 require;
//   4. 弹层顺序表的登记、投影订阅与 init()。
//
// 判断“这段代码该不该在这里”的那把尺子:如果它会因为某个界面细节改变而改，它就
// 不属于这里。
// ============================================================

// ============================================================
// 1. 共享原语
// ============================================================
function createPopoverSurface({ document, window }) {
  let disposed = false;
  const dom = createPopoverDom({ document, window });
  const {
    $, $$, pad2, escapeHTML, formatMs, localDateKey, localDateInputValue, localDateTimeInputValue,
    endOfDayISO, scheduledFromDateTimeInput, syncPressedButtons, readNumberInput, setStatusLine,
    showTransientStatus, hideTransientStatus
  } = dom;
  const {
    BLOCKER_LABELS, WEEKDAY_LABELS, REPEAT_LABELS, breakdownProviderLabel, fallbackReasonText,
    fallbackReasonSuffix, describeSeriesRule, taskActionMessage, formatExpiry, focusActionMessage,
    scoreSummary
  } = createPopoverMessages({ pad2 });
  const taskDates = BubuTaskDates;
  // 时长的上下限、步长与预设只有一份定义，渲染层从共享模块读。之前这里自己
  // 写过一份 5–180，跟持久层和设置面板各说一套，这种分叉不能再回来。
  const sessionDuration = BubuSessionDuration;
  const stateChannel = BubuStateChannel;
  const modalPrimitive = createPopoverModalPrimitive({ $, $$ });
  const surfaceClient = createPopoverSurfaceClient();
  // 弹层的 Tab 困焦顺序、Escape 关闭顺序与“有没有弹层开着”都由登记处一处回答,
  // 每个弹层各自登记在第 4 段。
  const modalRegistry = createPopoverModalRegistry({
    $,
    modalPrimitive,
    onNoneOpen: () => surfaceClient.hidePopover()
  });
  const projectionStore = createPopoverProjectionStore({ client: surfaceClient, stateChannel });

  // 这一面上仅剩的两处可变量:最近一次投影，以及那颗跨两层的 30 秒心跳。每一层自己
  // 的可变状态都关在它自己的工厂里，所以这两行下面不会再长出第三行。
  let state = null;
  let expiryTicker = null;

  // 任务输入的那几条硬边界与它们对人说的话都归 ui/task-input:数字来自共享
  // contract,面板与主进程规范化任务读同一份。之前这里抄了第二份 8 / 20 / 100 /
  // 1–1440,分叉的表现不是报错,而是“面板说还能加,主进程把这一步吃掉了”。
  const taskInput = createPopoverTaskInput({ $ });
  const {
    parseTagList, tagInputError, estimateInputError, recurrenceIntervalError, bindStepTitleField
  } = taskInput;
  const MAX_TASK_STEPS = taskInput.limits.STEPS;

  // ============================================================
  // 2. 跨层共用的那几条
  // ============================================================
  // 全都写成函数声明:它们被注进下面各层，其中 restoreModalFocus 反过来还要读落点提示
  // 那一层。靠提升，这五条与各层的先后就不必互相迁就。
  //
  // 持久会话与 pomodoro 投影怎么叠成这一次渲染要用的那个会话，归 state/session-view。
  // 这里只留一层薄壳，因为六个层都从注进来的 getSession 读它,而 state 住在这一面上。
  function getSession() {
    return popoverSessionView(state);
  }

  function showTaskFormStatus(message = '') {
    setStatusLine('#taskFormStatus', message);
  }

  // 一级页面自己的状态行。弹层关掉以后发生的拒绝（归档、续期、拆解失败）不能
  // 写到 #taskFormStatus 上 —— 那只存在于新任务弹层里，用户根本看不到。
  function showTaskPanelStatus(message = '') {
    setStatusLine('#taskPanelStatus', message);
  }

  // 一个弹层关闭后的焦点归属规则对所有弹层一致：优先回到打开它的控件，但如果
  // 期间一段计时已经到点，就直接交给落点卡，不在中间瞬时聚焦背后的内容。落点提示
  // 那一层在它下面才构造出来，这条规则只在弹层关闭的那一刻才跑，读到的一定是它。
  function restoreModalFocus(trigger) {
    requestAnimationFrame(() => {
      if (disposed) return;
      if (landing.activePrompt()) {
        landing.rememberReturnFocus(trigger);
        landing.render();
        return;
      }
      const fallback = $('#btnOpenTaskCreate');
      const target = modalPrimitive.canReceiveFocus(trigger)
        ? trigger
        : (modalPrimitive.canReceiveFocus(fallback) ? fallback : null);
      if (target) target.focus();
    });
  }

  // 一件任务的重复系列：编辑面板要拿它填规则那一行，任务行也要拿它写「🔄 每周一」
  // 那枚徽标。所以它留在这一面上，由两边共读，而不是跟着编辑器搬走再被抄回来。
  function seriesForTask(task) {
    if (!task || !task.seriesId || !state) return null;
    const series = Array.isArray(state.recurrenceSeries) ? state.recurrenceSeries : [];
    return series.find(item => item.id === task.seriesId) || null;
  }

  // 翻页拿回来的那一页在这里并进投影缓存:state 归面板,清单那一层不碰它。下一次
  // 投影推过来会覆盖掉本地补上的这几页,这是它一直以来的行为。
  function mergeHistoryPage(page) {
    if (disposed || !state) return;
    const byId = new Map((state.archivedTasks || []).map(task => [task.id, task]));
    for (const task of page.items || []) byId.set(task.id, task);
    state = {
      ...state,
      archivedTasks: [...byId.values()],
      history: { total: page.total, nextCursor: page.nextCursor, retention: page.retention }
    };
  }

  // ============================================================
  // 3. 各层的构造
  // ============================================================
  // 像素兽这一层只画不判:皮肤从 state 拿,基线心情由这里翻译,它自己不认识
  // focusSession。
  const companionArt = createPopoverCompanionArt({
    document,
    window,
    $,
    getSkinId: () => (state ? state.currentSkin : 'pink'),
    getAppearanceIds: () => (state && Array.isArray(state.appearance?.wornIds)
      ? state.appearance.wornIds : []),
    resolveBaseMood: () => {
      if (!state) return 'idle';
      const session = getSession();
      if (session.paused) return 'paused';
      if (!session.running) return 'idle';
      return session.mode === 'break' ? 'break' : 'focus';
    }
  });
  const companionFeature = createPopoverCompanionFeature({
    getState: () => state,
    $,
    escapeHTML,
    skinAccent: companionArt.skinAccent,
    surfaceClient
  });
  // 换形态与换装各自是一个抽屉。它们和默认视图共用同一个静态画师(drawPetPreview)
  // 但尺寸档不同:胶片带 33px、抽屉预览 99px、页面上那只 132px。
  const skinPicker = createPopoverSkinPicker({
    document,
    $,
    getState: () => state,
    escapeHTML,
    surfaceClient,
    drawPetPreview: companionArt.drawPetPreview,
    skinAccent: companionArt.skinAccent,
    restoreModalFocus
  });
  const wardrobeFeature = createPopoverWardrobeFeature({
    document,
    $,
    getState: () => state,
    escapeHTML,
    surfaceClient,
    drawPetPreview: companionArt.drawPetPreview,
    restoreModalFocus
  });
  // 能量那一小块自己一层:今天页的能量区(读数、曲线、归因、三个打卡键)归它。能量曲线
  // 不再画在当日时间轴上(时间轴按用户反馈塌成一条纯专注线),这两层之间因此不再有边 ——
  // 时间轴不再拿它的 paintCurve。
  const energyStrip = createPopoverEnergyStrip({
    $, $$, getState: () => state, surfaceClient, escapeHTML, syncPressedButtons
  });
  energyStrip.mount();
  // 时间轴先建:进展页要把「选中了哪天」交给它,所以它得先存在。
  const moodDeletion = createTimelineMoodDeletion({
    sendDelete: id => surfaceClient.deleteMoodNote(id),
    hasMood: id => (state?.moodNotes || []).some(note => note.id === id),
    findSource: id => inbox.findHistorySource(id),
    refresh: (dayKey, moodId) => {
      inbox.invalidateMoodSource(moodId);
      return timelineFeature.refreshMoodDeletion(dayKey);
    }
  });
  const timelineFeature = createPopoverTimelineFeature({
    document, $, surfaceClient, getState: () => state, escapeHTML, formatMs, moodDeletion,
    onContinueConversation: ({ receiptId, conversationId }) => receiptId ? draftConversation.openReceipt({ receiptId }) : draftConversation.resume(conversationId)
  });
  const progressFeature = createPopoverProgressFeature({
    document, getState: () => state, $, formatMs, escapeHTML,
    onDaySelected: dayKey => timelineFeature.showDay(dayKey)
  });
  // 今天页最下面那一节。它只认 routines 与 settings 两个脏位,和计时、任务、成就
  // 三条线都不相干 —— ARCHITECTURE「日常与能量」 要求完成一条日常不进游戏化层,所以这里也不往那边接线。
  const routinesFeature = createPopoverRoutinesFeature({
    document, $, getState: () => state, escapeHTML, surfaceClient
  });
  const completionFeedback = createPopoverCompletionFeedback({ document, $, celebrate: companionArt.celebrate, surfaceClient });
  companionArt.mount();
  companionFeature.mount(projectionStore);
  skinPicker.mount(projectionStore);
  wardrobeFeature.mount(projectionStore);
  progressFeature.mount(projectionStore);
  routinesFeature.mount(projectionStore);
  // 「今天」三块（能量、日常、收件箱）的展开状态与收件箱捷径。
  const todayOverview = createPopoverTodayOverview({
    $, getState: () => state, openInbox: () => { $('#tabInbox').click(); $('#tabInbox').focus(); }
  });
  todayOverview.mount(projectionStore);
  const activityMirrorSettings = createActivityMirrorSettings({ $, getState: () => state, escapeHTML, surfaceClient });
  activityMirrorSettings.mount(projectionStore);
  timelineFeature.mount(projectionStore);
  const captureBar = createPopoverCaptureBar({ document, $, surfaceClient });
  captureBar.mount();

  // ---- 落点提示 ----
  // 计时结束后那一问自己成一层：它露不露面由投影决定,不由谁去点开;它拥有的只
  // 有“这次是哪一个落点”和“它出现之前焦点在哪”,以前这两个是面板顶上的模块级
  // let。它排在各层的最前面,因为上面那条所有弹层共用的焦点归属规则要以它为兜底。
  const landing = createPopoverQuickStartLanding({
    document,
    $,
    $$,
    getState: () => state,
    getSession,
    modalRegistry,
    landingBlockingModals: POPOVER_LANDING_BLOCKING_MODALS,
    canReceiveFocus: modalPrimitive.canReceiveFocus,
    surfaceClient,
    focusActionMessage
  });
  landing.mount();

  const { taskDraft, taskWhenFields, draftConversation } = createPopoverTaskCreation({
    document, $, $$, escapeHTML, syncPressedButtons, readNumberInput, bindStepTitleField,
    parseTagList, tagInputError, estimateInputError, maxSteps: MAX_TASK_STEPS,
    localDateInputValue, localDateTimeInputValue, endOfDayISO, scheduledFromDateTimeInput,
    endOfLocalDateISO: taskDates.endOfLocalDateISO, formatExpiry, recurrenceIntervalError,
    autoExpiryPreview: () => (state && state.autoExpiryPreview) || null,
    surfaceClient, breakdownProviderLabel, fallbackReasonSuffix, fallbackReasonText,
    restoreModalFocus, showTaskFormStatus,
    stageStuckProposal: (proposal, taskId) => stuck.stageNextAction(proposal, taskId),
    onPlanningCandidateReview: async payload => {
      settingsDrawer.open(); $('#settingGroupPlanning').open = true;
      await planningPreferences.reviewProposal(payload);
    },
    onMemoryCandidateReview: async payload => {
      settingsDrawer.open(); $('#settingGroupAi').open = true;
      await memoryList.reviewMemoryCandidate(payload);
    },
    isAiClarifyEnabled: purpose => Boolean(state?.settings?.aiBreakdownEnabled
      && (purpose === 'stuck' || state.settings.aiClarifyEnabled)),
    showStuckStatus: source => stuck.showStatus(source)
  });

  // ---- 统一任务编辑面板 ----
  // 编辑草稿的全部可变状态归 features/task-editor：步骤的增删改排、这次修改的影响
  // 范围、打开它的那个控件，弹层关掉以后一个都不留在这一面上。它不认识 state，
  // 当前任务记录与重复系列都由这里注入。
  const taskEditor = createPopoverTaskEditor({
    document,
    $,
    $$,
    escapeHTML,
    syncPressedButtons,
    readNumberInput,
    localDateInputValue,
    localDateTimeInputValue,
    scheduledFromDateTimeInput,
    endOfLocalDateISO: taskDates.endOfLocalDateISO,
    bindStepTitleField,
    parseTagList,
    tagInputError,
    estimateInputError,
    recurrenceIntervalError,
    maxSteps: MAX_TASK_STEPS,
    surfaceClient,
    taskActionMessage,
    describeSeriesRule,
    findTask: id => (state && state.tasks ? state.tasks : []).find(item => item.id === id) || null,
    seriesForTask,
    restoreModalFocus,
    showPanelStatus: showTaskPanelStatus
  });
  taskEditor.mount();

  // ---- 完成确认（仅当还有未完步骤） ----
  // “按下勾选”和“还剩几步那一问”是同一件事的两半：待确认的那件任务只在这一层里
  // 存在，所以取消之后再点一次勾，走的仍然是不带确认的第一问。
  const completeConfirm = createPopoverCompleteConfirm({
    document,
    $,
    surfaceClient,
    celebrate: () => companionArt.celebrate(),
    onCompleted: completionFeedback.announceCompletion,
    restoreModalFocus,
    showPanelStatus: showTaskPanelStatus,
    taskActionMessage
  });
  completeConfirm.mount();

  // ---- 计时 ----
  // 头上那枚迷你计时、⚡ 那一排按钮、每一秒的倒数与底下那个时长选择器自己成一层:
  // 倒数用的单调锚点、结构与时长两处防闪烁的键值,以及每 500ms 那一次心跳都只在它
  // 内部存在——前三样以前是面板顶上的模块级 let,心跳则要等 init() 才起得来。
  // 它不认识 NOW 卡片,「此刻在做哪一件」是注进来的;反过来「这一件能不能起」由它
  // 回答,任务行与 NOW 卡片都从这里接。
  const focusTimer = createPopoverFocusTimer({
    refreshProjection: () => projectionStore.refresh(),
    document,
    $,
    $$,
    getState: () => state,
    getSession,
    pad2,
    setStatusLine,
    sessionDuration,
    surfaceClient,
    focusActionMessage,
    currentTask: () => nowCard.currentTask()
  });
  focusTimer.mount();

  // ---- 任务清单 ----
  // 筛选、清单本身、每一行的动作、溢出菜单,以及归档那一段与它的翻页自己成一层:
  // 「此刻在看哪一批、哪些行已经在页面上、开着的是哪一个菜单」都只在它内部存在。
  // 一行上的 ⚡ / ✎ / ✨ / 勾选按下去之后发生什么,由这里注进去;归档翻页拿回来的
  // 那一页交回这里合并,投影缓存不归它。
  const taskList = createPopoverTaskList({
    document,
    window,
    $,
    getState: () => state,
    getSession,
    escapeHTML,
    formatMs,
    localDateInputValue,
    syncPressedButtons,
    taskDates,
    describeSeriesRule,
    taskActionMessage,
    formatExpiry,
    surfaceClient,
    taskLaunchBlockReason: focusTimer.taskLaunchBlockReason,
    seriesForTask,
    completeTask: task => completeConfirm.completeTask(task),
    openTaskEditor: task => taskEditor.open(task),
    openBreakdown: (task, trigger) => breakdownFeature.open(task, trigger),
    startFocus: task => focusTimer.runFocusAction('focus', task, focusTimer.focusRange().chosen),
    celebrate: companionArt.celebrate,
    showPanelStatus: showTaskPanelStatus,
    mergeHistoryPage
  });
  taskList.mount();

  // ---- 此刻这一件 ----
  // NOW 卡片、它下面那一屏步骤、以及候选面板自己成一层:「当前这一件是哪一件」这
  // 个判断只在它内部存在,别处（计时器、「卡住了」）都来问它。它拥有「上一次拿回
  // 来的候选」和「打开候选面板之前焦点在哪」,后者以前是面板顶上的模块级
  // candidateReturnFocus。两分钟怎么起、⚠ 徽标写什么,由计时器和「卡住了」回答,
  // 从这里注进去。
  const nowCard = createPopoverNowCard({
    document,
    $,
    getState: () => state,
    getSession,
    escapeHTML,
    surfaceClient,
    taskLaunchBlockReason: focusTimer.taskLaunchBlockReason,
    focusActionMessage,
    taskActionMessage,
    scoreSummary,
    syncBlocker: task => stuck.syncBlockerForTask(task),
    canReceiveFocus: modalPrimitive.canReceiveFocus,
    celebrate: companionArt.celebrate,
    completeTask: completeConfirm.completeTask,
    openTaskEditor: task => taskEditor.open(task),
    runQuickStart: task => focusTimer.runFocusAction('quick-start', task, sessionDuration.QUICK_START_MINUTES),
    showFocusStatus: focusTimer.showFocusActionStatus
  });
  nowCard.mount();

  // 收件箱持有分类卡片和分页历史；转任务后交给拆解弹层。
  const inbox = createPopoverInboxFeature({
    document, $, getState: () => state, escapeHTML, surfaceClient, moodDeletion,
    openBreakdown: task => breakdownFeature.open(task)
  });
  inbox.mount();

  // ---- 每日回顾 ----
  // 今日启动与今日收口自己成一层:它拥有「此刻打开的是哪一张回顾卡」,以前那是面
  // 板顶上一个被三个按钮各自读写的模块级 let。它不认识落点提示,只知道有人要它把
  // aria-modal 这一层让出去。
  const review = createPopoverReviewFeature({
    document,
    $,
    $$,
    getState: () => state,
    surfaceClient,
    activeLandingPrompt: landing.activePrompt,
    isLandingModalOpen: landing.isOpen,
    renderLanding: landing.render,
    rememberLandingReturnFocus: landing.rememberReturnFocus
  });
  review.mount();

  // ---- 拆解弹层 ----
  // 拆解弹层是一个可独立挂载的 feature:它自己管 in-flight 请求的代号、只读建议的
  // 生命周期与关闭时的焦点归还。它不认识 state——AI 开关与落点提示都从这里注入。
  const breakdownFeature = createPopoverBreakdownFeature({
    document,
    $,
    $$,
    escapeHTML,
    syncPressedButtons,
    bindStepTitleField,
    maxSteps: MAX_TASK_STEPS,
    surfaceClient,
    taskActionMessage,
    fallbackReasonText,
    isAiEnabled: () => Boolean(state && state.settings && state.settings.aiBreakdownEnabled),
    activeLandingPrompt: landing.activePrompt,
    isLandingModalOpen: landing.isOpen,
    renderLanding: landing.render,
    rememberLandingReturnFocus: landing.rememberReturnFocus,
    restoreModalFocus,
    showTaskPanelStatus
  });
  breakdownFeature.mount();

  // ---- 「卡住了」弹窗 ----
  // 一个入口、三条出路,整层可独立挂载 / 卸载:卡在哪、一批更小的下一步、正在展示
  // 的那条策略都只在它内部存在。它不认识 state——两个开关都从这里注入;NOW 卡片
  // 上那枚 ⚠ 徽标要写什么,由它在每次重绘时回答。
  // 「针对这件事的下一步」自己一层:它只认识那一块 DOM 和一条命令,不知道卡点是
  // 怎么问出来的。卡住弹层把卡点当备注交给它,拿回一句针对这件事的建议。
  const unstickAdvice = createPopoverUnstickAdvice({ $, escapeHTML, surfaceClient });
  const stuck = createPopoverStuck({
    document,
    $,
    $$,
    syncPressedButtons,
    showTransientStatus,
    hideTransientStatus,
    blockerLabels: BLOCKER_LABELS,
    surfaceClient,
    taskActionMessage,
    unstickAdvice,
    openCollaboration: draftConversation.open,
    currentTask: nowCard.currentTask,
    renderNowCard: nowCard.render,
    canReceiveFocus: modalPrimitive.canReceiveFocus,
    restoreModalFocus,
    isAiEnabled: () => Boolean(state && state.settings && state.settings.aiBreakdownEnabled),
    isStrategyGuidanceEnabled: () => Boolean(state && state.settings && state.settings.strategyGuidanceEnabled)
  });
  stuck.mount();

  // ---- 外壳与设置抽屉 ----
  // 常驻的那一圈（头上一条、下面那排页签、迁移告知、主题色注入、今天的执行闭环）自己
  // 成一层，设置抽屉也自己成一层。抽屉管开合与背景失活;外壳不认识伙伴与进展那两页里
  // 有什么，切到某一页要补渲染什么由 onTabShown 说。
  const appChrome = createPopoverAppChrome({
    document,
    $,
    $$,
    getState: () => state,
    getSession,
    surfaceClient,
    escapeHTML,
    nextRovingIndex: BubuKeyboardNavigation.nextRovingIndex,
    onTabShown: name => {
      if (name !== 'inbox') inbox.hide();
      inbox.visibilityChanged();
      timelineFeature.visibilityChanged();
      if (name === 'progress') {
        progressFeature.renderStats();
        progressFeature.showToday();
      }
      if (name === 'companion') {
        companionFeature.renderCompanionSkin();
        companionFeature.renderCompanion();
        // 抽屉本身没露面,这一下只是为了让默认视图上「戴着 N 件」那行字对上。
        wardrobeFeature.render();
      }
    }
  });
  appChrome.mount();

  const settingsDrawer = createPopoverSettingsDrawer({
    document,
    $,
    $$,
    getState: () => state,
    surfaceClient,
    sessionDuration,
    syncPressedButtons,
    fallbackReasonText,
    motionReduced: companionArt.motionReduced,
    clearDecorativeMotion: companionArt.clearDecorativeMotion,
    renderExpiryPreview: taskWhenFields.renderExpiryPreview,
    activeLandingPrompt: landing.activePrompt,
    rememberLandingReturnFocus: landing.rememberReturnFocus,
    renderLanding: landing.render
  });
  settingsDrawer.mount();

  // 闪念快捷键单独一层:抽屉里那一组的文字大半不来自 settings,而来自主进程「现在
  // 真正抢到的是哪个组合」。它还负责把这个组合写到头上那颗 💭 与收件箱空态上 ——
  // 那两处以前写死成 ⌥⇧Space，退级之后就开始说谎。
  const shortcutSetting = createPopoverShortcutSetting({
    document,
    $,
    getState: () => state,
    surfaceClient
  });
  shortcutSetting.mount();

  // 长期记忆列表也自己一层。它读的不是投影而是 SQLite —— `memory:list` 是一次
  // invoke,展开 AI 那一组时查一次。把它塞进抽屉那层会让抽屉去认识一个它不拥有的
  // 数据源;分开之后,「记忆读不到」最坏也只是这一段空着。
  const memoryList = createPopoverMemoryList({ $, escapeHTML, surfaceClient });
  memoryList.mount();
  const planningPreferences = createPlanningPreferencesFeature({ document, $, client: surfaceClient });
  planningPreferences.init();

  // ============================================================
  // 4. 登记、订阅与启动
  // ============================================================
  // 每个弹层只交出“它开着吗”和“关掉它”,先后顺序与 Escape 的做法由 surface 层的
  // 顺序表决定。之前这件事是两条手写的 if-else 链加一个九项的或表达式,新增弹层
  // 要同时改三处,漏一处的表现是 Escape 关错了层,而不是报错。
  registerPopoverModals({
    registry: modalRegistry,
    $,
    modals: {
      taskOverflowMenu: {
        isOpen: taskList.isOverflowMenuOpen,
        close: () => taskList.closeOverflowMenu({ focusTrigger: true })
      },
      settings: { isOpen: settingsDrawer.isOpen, close: settingsDrawer.close },
      // 落点提示没有 close:Escape 只把焦点挪到出口,详见顺序表。
      quickStart: { isOpen: landing.isOpen },
      taskEdit: { isOpen: taskEditor.isOpen, close: taskEditor.close },
      completeConfirm: { isOpen: completeConfirm.isOpen, close: completeConfirm.close },
      review: { isOpen: review.isOpen, close: () => void review.close() },
      breakdown: { isOpen: breakdownFeature.isOpen, close: breakdownFeature.close },
      taskCreate: { isOpen: taskDraft.isOpen, close: taskDraft.close },
      stuck: { isOpen: stuck.isOpen, close: stuck.close },
      skinPicker: { isOpen: skinPicker.isOpen, close: skinPicker.close },
      wardrobe: { isOpen: wardrobeFeature.isOpen, close: wardrobeFeature.close },
      draftChat: { isOpen: draftConversation.isOpen, close: () => draftConversation.close() }
    }
  });

  const handleKeydown = event => modalRegistry.handleKeydown(event);
  document.addEventListener('keydown', handleKeydown);

  // 投影订阅:每一次推送先把这一面上的 state 换掉,再让计时器把单调锚点对上,
  // 然后才轮到那四片脏标记各自决定重画什么。升级那一下的庆祝也在这里,因为只有
  // 这里同时看得见换之前与换之后。
  projectionStore.subscribe(change => {
    // A locale repaint is not a new domain snapshot. Never reset timer anchors,
    // transient decisions or celebration state from an unchanged projection.
    if (change.localeOnly) return;
    const prev = state;
    state = change.state;
    focusTimer.syncPomoCountdownAnchor();
    // Celebrate on level-up
    if (prev && (state.level > prev.level)) completionFeedback.celebrateLevelUp(state.level);
    companionArt.refreshMood();
  });

  // 四片脏标记各自订阅投影,各自决定这一次要重画哪几件:今天、工作、设置、外壳。
  // 每一片都能独立挂载与拆卸,拆掉之后它那几个渲染函数一次都不会再被调用——这
  // 替掉了从前那个一次画满整页的分发器,而按 revision 比对的那份契约没有变。
  const todayFeature = createPopoverTodayFeature({
    renderers: {
      renderHeader: appChrome.renderHeader,
      renderPomoStructure: focusTimer.renderPomoStructure,
      renderPomoTick: focusTimer.renderPomoTick,
      renderNowCard: nowCard.render,
      renderNowTaskDetail: nowCard.renderDetail,
      renderLanding: landing.render
    }
  });
  const workFeature = createPopoverWorkFeature({
    renderers: {
      renderTaskList: taskList.renderList,
      renderArchivedTasks: taskList.renderArchive,
      renderImpulseList: inbox.renderList
    }
  });
  const settingsFeature = createPopoverSettingsFeature({
    renderers: {
      renderSettings: settingsDrawer.renderSettings,
      renderShortcutSetting: shortcutSetting.render,
      // 「试个小办法」这条出路属于「卡住了」那一层：开关一变谁该消失,由它自己说。
      renderStrategyRoute: stuck.renderStrategyRoute,
      renderReviewCards: review.renderCards,
      renderDurationPicker: focusTimer.renderDurationPicker,
      renderMigrationNotices: appChrome.renderMigrationNotices
    }
  });
  const shellFeature = createPopoverShellFeature({
    renderers: {
      applyTheme: appChrome.applyTheme,
      renderEnergy: energyStrip.render,
      renderDND: appChrome.renderDND
    }
  });
  for (const feature of [todayFeature, workFeature, settingsFeature, shellFeature]) {
    feature.mount(projectionStore);
  }

  // 只有倒数与失效倒计时在本地走时钟,上面那些渲染全部由带 revision 的状态差驱动。
  async function init() {
    try {
      await projectionStore.start();
    } catch (error) {
      dispose();
      throw error;
    }
    if (disposed) return;
    // 临时任务倒计时：sig 已包含剩余分钟，只有变了的行会重绘。倒数那一秒归计时器
    // 自己,这里只留这颗跨两层的 30 秒心跳。
    if (expiryTicker) clearInterval(expiryTicker);
    expiryTicker = setInterval(() => {
      if (!state) return;
      taskList.renderList();
      taskWhenFields.renderExpiryPreview();
    }, 30000);
  }
  const ready = init();
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(expiryTicker);
    document.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pagehide', dispose);
    const features = [dom, captureBar, moodDeletion, companionArt, companionFeature, skinPicker, wardrobeFeature,
      progressFeature, routinesFeature, todayOverview, activityMirrorSettings, timelineFeature, completionFeedback,
      landing, draftConversation, taskDraft, taskEditor, completeConfirm, focusTimer, taskList, nowCard, inbox,
      review, breakdownFeature, stuck, appChrome, settingsDrawer, shortcutSetting, memoryList, planningPreferences, energyStrip,
      todayFeature, workFeature, settingsFeature, shellFeature, projectionStore];
    for (const feature of features.reverse()) {
      try { feature.dispose(); } catch (error) { console.error('popover teardown failed', error); }
    }
    state = null;
  }
  window.addEventListener('pagehide', dispose);
  return Object.freeze({ ready, dispose, breakdownFeature, taskList });
}

const popoverSurface = createPopoverSurface({ document, window });
const { breakdownFeature, taskList } = popoverSurface;
void popoverSurface.ready.catch(error => console.error('popover startup failed', error));
export { createPopoverSurface, popoverSurface, breakdownFeature, taskList };
