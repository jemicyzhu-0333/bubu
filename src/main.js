const path = require('path');
const { performance } = require('node:perf_hooks');
const { SKINS } = require('./skins.mjs');
const petContent = require('./pet-content');
const { FOODS, INTERACTIONS } = petContent;
const { adaptLegacyPetContent } = require('./core/content-pack');
const {
  createApplication, createAiCollaboration, createDomainId, createPlanningPreferences,
  createBootstrapRuntime, createProposalAssistance, registerNudgeActions,
  createCompanionMeals, createRendererIpcRegistrar, createCompanionFoodShop, createCompanionFeeding, createGrowthPublisher, createPreferencesPublisher,
  createEnergyAssistance, createInboxOrganization, createActivityMirror, createPrivateTaskNotifications, energyCurveLevelNow, registerAiCancellation, createTaskUndo,
  createSittingReminderTimer, createCurrentEnergyReader,
  createWorkBoundaryReminder,
  registerAppMaintenance, registerProcessLifecycle,
  createSessionResumeAdapter, createSessionStartPublisher, createSurfacePublisher, createPetQueries
} = require('./bootstrap');
const {
  'app-maintenance': appMaintenance,
  attention,
  companion: companionCapability,
  execution,
  work,
  progress,
  guidance,
  preferences,
  routines: routinesCapability
} = require('./capabilities');
const {
  localDayKey,
  nextLocalDayBoundary,
  nextLocalWorkStart
} = require('./core/calendar');
const {
  STATUS,
  isActiveSession,
  isPausedSession,
  sessionKind,
  isActiveFocusSession,
  isTimingSession,
  elapsedMs: sessionElapsedMs,
  remainingMs: sessionRemainingMs
} = execution.focusSession;
const {
  MIN_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,
  FOCUS_MINUTE_PRESETS,
  normalizeFocusMinutes
} = execution.sessionDuration;
const { availability } = work;
const { petVisibleRect, resolvePetDockEdge, clampPetWindowPosition } = require('./core/pet-docking');
const { resolveSensoryPolicy } = require('./core/sensory-policy.mjs');
const { PRESENTATION_TRANSIENT_SOURCES } = require('./core/pet-presentation.mjs');
const { taskStartBlockReason } = availability;
const { STRATEGIES } = require('./content/strategies');
const {
  validateStrategyManifest,
  selectStrategy,
  MAX_RECENT
} = require('./core/strategy-registry');
const { validateProposal } = require('./core/breakdown-proposal');
const {
  validateEnrichProposal
} = require('./core/enrich-proposal');
const { createLlmTrace } = require('./core/llm');
const { pageTaskHistory } = require('./core/history-page');
const {
  createIpcHost,
  createNotificationHost,
  createNudgeDelivery,
  createNudgeHost,
  createPermissionHost,
  createPowerHost,
  createQuickPanelHost,
  borrowPetForQuickPanel,
  createScreenHost,
  createShortcutHost,
  createTrayHost,
  createPopoverWindowHost,
  createImpulseWindowHost, createPetWindowHost, createPetDevelopment, createPetMenuExpansion, createPetDragSession
} = require('./platform/electron');
const { RuntimeSessionClock } = execution.runtimeClock;
const { relationshipProjection } = companionCapability;
const { PERSISTED_SCHEMA_VERSION, normalizePersistedState } = require('./platform/persistence/persisted-schema');
const { DEFAULT_SETTINGS, normalizeSettings } = preferences;
const {
  allowedSurfacesFor,
  assertIpcPayload
} = require('./application/ipc');
const {
  createUnitOfWork,
  ProposalStore,
  ENERGY_BANDS,
  inferEnergy,
  suggestDuration,
  createPopoverStateQuery, createTimelineDayQuery, createSurfaceReadComposition, projectPetContext, projectPetState,
  predictModelLevelAt,
  createApplyGuidanceProposalWorkflow,
  createAcceptHealthyShutdownWorkflow,
  createAdjustFocusDurationWorkflow,
  createArchiveWorkItemWorkflow,
  createClarifyWorkItemWorkflow,
  createCompleteDueSessionWorkflow,
  createExpireWorkItemsWorkflow,
  createWorkItemWorkflow,
  createResolveFocusLandingWorkflow,
  createResolveQuickStartWorkflow,
  createResumeFocusSessionWorkflow,
  createRunDailyResetWorkflow,
  createStartFocusSessionWorkflow,
  createStopFocusSessionWorkflow,
  createCompleteWorkItemWorkflow,
  createCompleteWorkStepWorkflow,
  createSelectNowWorkflow,
  createSkipWorkOccurrenceWorkflow,
  createSettleFocusSessionWorkflow,
  createUpdateWorkItemWorkflow,
  createResolveReviewWorkflow,
  createUpdatePreferencesWorkflow, createStartBreakSessionWorkflow,
  createRecordTaskAvoidanceWorkflow,
  createRecordCompanionInteractionWorkflow,
  createRoutineTimelineEffects
} = require('./application');

// settings 默认值供新建规范档与纯投影使用。生产 admission 先拒绝缺键或旧版本，
// 这里不会为已存在的旧档补键、转换版本或覆写原资料。
const SETTINGS_DEFAULTS = {
  ...DEFAULT_SETTINGS,
  nudgeWhitelist: [...attention.nudgePolicy.DEFAULT_WHITELIST]
};
const application = createApplication({
  argv: process.argv,
  schemaVersion: PERSISTED_SCHEMA_VERSION,
  normalizePersistedState
});

if (application.status === 'primary-instance') {
const {
  appHost,
  stateRepository: store,
  credentialStore,
  factStore
} = application;
// ARCHITECTURE「事实流与长期记忆」：时间轴的唯一写入者。会话起止与任务完成在各自 publish 钩子里
// （提交之后）记进事实存储；历史不是真相来源，写失败只吞掉降级，绝不回滚已提交的
// 专注或任务操作。tier='none' 的空仓库下 append 是 no-op，同样安全。
const timelineRecorder = progress.recordTimeline.createTimelineRecorder({ timeline: factStore.timeline });
// Every persisted write in the host goes through this one seam. There is no
// ad-hoc commit helper left to reach around it, so "who may change state" has a
// single answer: a named workflow or a capability command, each declaring the
// top-level paths it touches. `schemaVersion` is the one exception, and it is
// not writable from here at all — current-only admission or fresh initialization
// in src/platform/persistence establishes it before this line runs.
const stateUnitOfWork = createUnitOfWork({ repository: store });
const recordWorkEndReminderCommand = attention.recordWorkEndReminder.createRecordWorkEndReminderCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: () => {},
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'work-end-reminder' })
});
const updatePreferencesCommand = createUpdatePreferencesWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishPreferencesUpdate,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'settings:update' })
});
const planningPreferences = createPlanningPreferences({ unitOfWork: stateUnitOfWork,
  readSnapshot: () => store.snapshot(), clock: { now: () => Date.now() }, idFactory: createDomainId,
  getPomodoro: pomodoroView, publishChange: pushStateChange, durability: store.authoritativeWrites,
  getConversation: request => aiCollaboration.sessions.get(request),
  validateContextVersions: refs => aiCollaboration.reads.validateContextVersions(refs),
  isContextMessageAllowed: (message, context) => aiCollaboration.isContextMessageAllowed(message, context),
  publishFact: fact => timelineRecorder.recordPlanningChanged(fact),
  reportEffectError: (error, channel) => reportWindowDeliveryError(error, { channel }) });
const recordEnergyCheckInCommand = guidance.recordEnergyCheckIn.createRecordEnergyCheckInCommand({
  unitOfWork: stateUnitOfWork,
  capturePlanningEstimate: (snapshot, at) => planningPreferences.captureEstimate(snapshot, at),
  clock: { now: () => Date.now() },
  publish: publishEnergyCheckIn,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'energy:check-in' })
});
const resetEnergyCalibrationCommand = guidance.resetEnergyCalibration.createResetEnergyCalibrationCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishEnergyCheckIn,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'energy:reset-calibration' })
});
const recordStrategyShownCommand = guidance.recordStrategyShown.createRecordStrategyShownCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishStrategyFeedback,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'strategy:request' })
});
const recordStrategyFeedbackCommand = guidance.recordStrategyFeedback.createRecordStrategyFeedbackCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishStrategyFeedback,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'strategy:feedback' })
});
const materializeDueReviewsCommand = guidance.materializeDueReviews.createMaterializeDueReviewsCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: fact => {
    pushStateChange({ reviews: true });
    const settings = getSettings();
    if (!settings.dnd && fact.created.length > 0) {
      showNotification({ delivery: 'companion', title: '有一张回顾卡待处理', body: '在「回顾」页打开它；不处理也不会扣分。' });
    }
  },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'reviews:materialize' })
});
const companionFeeding = createCompanionFeeding({
  unitOfWork: stateUnitOfWork, clock: { now: () => Date.now() }, foods: FOODS,
  announceBond: announceBondStage, publishChange: pushStateChange,
  invalidateMealAdvice: () => companionMeals.invalidateAdvice(),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'pet:feed' })
});
const companionFoodShop = createCompanionFoodShop({
  unitOfWork: stateUnitOfWork, clock: { now: () => Date.now() }, foods: FOODS,
  publish: () => pushStateChange({ pet: true }),
  reportEffectError: (error, channel) => reportWindowDeliveryError(error, { channel })
});
const recordCompanionInteractionWorkflow = createRecordCompanionInteractionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishCompanionInteraction,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'pet:interaction' })
});
const persistSurpriseStateCommand = companionCapability.persistSurpriseState.createPersistSurpriseStateCommand({
  unitOfWork: stateUnitOfWork
});
const selectSkinCommand = companionCapability.selectSkin.createSelectSkinCommand({
  unitOfWork: stateUnitOfWork,
  availableSkinIds: Object.keys(SKINS),
  publish: () => {
    companionMeals.invalidateAdvice();
    if (tray) tray.setIcon(trayIconAppearance(iconFrame, currentMood()));
    pushStateChange({ skin: true });
    updatePetDockState();
  },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'skin:switch' })
});
// 佩戴与换皮肤走同一条通报路径,因为它们改变的是同一件事:宠物现在长什么样。
// 差别只在托盘图标——图标画的是心情与皮肤,不含配饰,所以这里不重画托盘。
const equipAppearanceCommand = companionCapability.equipAppearance.createEquipAppearanceCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  items: petContent.PET_APPEARANCE_ITEMS,
  publish: () => {
    pushStateChange({ appearance: true });
    updatePetDockState();
  },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'appearance:equip' })
});
// 日常的三次写与打卡分成两条命令,因为写集合不同:管理会连带删掉当天的记录,
// 打卡只碰 routineLog。两条都不会写 xp / streak / pet —— ARCHITECTURE「日常与能量」 的那条健康约束
// 就是靠这两个写集合成立的,不是靠自觉。
const manageRoutineCommand = routinesCapability.manageRoutine.createManageRoutineCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: () => pushStateChange({ routines: true, energy: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'routines:add' })
});
const routineTimelineEffects = createRoutineTimelineEffects({
  timelineRecorder,
  publish: pushStateChange,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'routines:log' })
});
const logRoutineOccurrenceCommand = routinesCapability.logRoutineOccurrence
  .createLogRoutineOccurrenceCommand({
    unitOfWork: stateUnitOfWork,
    clock: { now: () => Date.now(), dayKey: timestamp => localDayKey(timestamp) },
    publish: routineTimelineEffects.publishCommitted,
    reportEffectError: error => reportWindowDeliveryError(error, { channel: 'routines:log' })
  });
const recordTaskAvoidanceWorkflow = createRecordTaskAvoidanceWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: () => pushStateChange({ tasks: true, recommendations: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const selectNowWorkflow = createSelectNowWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: () => pushStateChange({ tasks: true, nowTask: true, recommendations: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const createWorkItemCommand = createWorkItemWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  inferEnergy,
  suggestDuration,
  publish: publishCreatedWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:add' })
});
const expireWorkItemsWorkflow = createExpireWorkItemsWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishExpiredWorkItems,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const activateScheduledWorkCommand = work.activateScheduledWork.createActivateScheduledWorkCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishActivatedScheduledWork,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const dismissMigrationNoticeCommand = appMaintenance.dismissMigrationNotice
  .createDismissMigrationNoticeCommand({
    unitOfWork: stateUnitOfWork,
    publish: () => pushStateChange({ migrationNotices: true }),
    reportEffectError: error => reportWindowDeliveryError(error, { channel: 'notices:dismiss' })
  });
const runDailyResetWorkflow = createRunDailyResetWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now(), dayKey: timestamp => localDayKey(timestamp) },
  idFactory: createDomainId,
  // ARCHITECTURE「日常与能量」:校准要对着「面板当时画的那个数」学,所以这里注入的就是面板用的同一个投影。
  // 设置和上班时间每次预测都现读 —— 昨晚改过作息,今天的校准就该按新的来。
  energyModel: {
    predict: (snapshot, { at, dayKey }) => predictModelLevelAt({
      snapshot,
      settings: getSettings(),
      at,
      dayKey,
      workStartHour: getWorkHours().start
    })
  },
  publish: publishLocalDayReset,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const inboxOrganization = createInboxOrganization({
  unitOfWork: stateUnitOfWork, readSnapshot: () => store.snapshot(), clock: { now: () => Date.now() },
  idFactory: createDomainId, archive: factStore.inboxArchive, durability: store.authoritativeWrites, timelineRecorder,
  taskPolicies: { inferEnergy, suggestDuration, suggestNextStep: title => breakdownTask(title)[0],
    nextWorkStart: now => nextLocalWorkStart(now, getWorkHours().start) },
  publishChange: dirty => pushStateChange(dirty), publishRoutine: fact => routineTimelineEffects.publishCommitted(fact),
  reportEffectError: (error, channel) => reportWindowDeliveryError(error, { channel })
});

const strategyManifest = validateStrategyManifest(STRATEGIES);
// One store holds both proposal kinds so they share a single TTL, size cap and
// id space. The validator dispatches on the recorded kind, so an enrich payload
// can never be applied as a breakdown or vice versa.
const proposalStore = new ProposalStore({
  validate: (proposal, context) => (context.kind === 'enrich'
    ? validateEnrichProposal(proposal, { allowedTags: context.allowedTags })
    : validateProposal(proposal))
});
// LLM diagnostics are metadata-only in every environment, including explicit
// IM_ADHDER_LLM_LOG=1. The trace boundary allowlists counters, safe identifiers
// and mapped error codes; request/response bodies and raw errors never leave it.
// Development may display these safe records by default; packaged builds opt in.
// This switch cannot enable transcript, task-title or memory-content logging.
const llmTrace = createLlmTrace({
  enabled: process.env.IM_ADHDER_LLM_LOG === '1'
    || (process.env.IM_ADHDER_LLM_LOG !== '0' && !appHost.isPackaged()),
  sink: line => console.log(line)
});
// 请求截止线由 core/llm/transport.js 给出默认值与上限，这里提供运行时调整口。
// 超时参数不进入持久化配置，避免把部署参数变成用户数据的 schema 变更。
// ARCHITECTURE「AI 与 LLM」：缩短等待不改变请求取消与代次失效边界。
const aiTimeoutMs = Number(process.env.IM_ADHDER_AI_TIMEOUT_MS) || undefined;

// “这个端点说哪种协议”是运行时协商结果，按端点保留在进程内。
// 它不是用户配置，不写入持久化快照，也不增加设置键。
// 重启后重新协商，以适应端点网关的变化。
const llmProtocolMemory = new Map();
const energyAssistance = createEnergyAssistance({
  requestScope: application.requestScope,
  unitOfWork: stateUnitOfWork,
  capturePlanningEstimate: (snapshot, at) => planningPreferences.captureEstimate(snapshot, at),
  readSnapshot: () => store.snapshot(),
  clock: { now: () => Date.now() },
  getSettings,
  credentialStore,
  timeoutMs: aiTimeoutMs, trace: llmTrace,
  negotiation: llmProtocolMemory, timelineRecorder,
  readEstimate: () => buildRecommendations(2).energy,
  publishEnergy: publishEnergyCheckIn,
  publishChange: pushStateChange,
  notify: payload => showNotification({ ...payload, delivery: 'companion' }),
  reportEffectError: (error, channel) => reportWindowDeliveryError(error, { channel })
});
const captureImpulseCommand = work.captureImpulse.createCaptureImpulseCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: fact => { energyAssistance.publishCapturedImpulse(fact); quickPanelHost.feedback('saved'); },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'impulses:add' })
});
// 请求策略的只有两个按钮，所以这里只留 selectStrategy 在“用户明确要”这一形状下真正会读
// 的那一份——最近出现过哪几条。每日额度与冷却阶梯是给主动推送的调用方准备的，那种调用方
// 目前不存在（主动出现的演出走 surprise-director），而由点击去写它们的账本会反过来压住将
// 来那条路：用户点一次“换一条”，这条策略就有一小时不会主动出现。
const strategyRuntime = { dayKey: null, recentIds: [] };

// 桌面宠物窗口尺寸：常态只占一小块（透明窗口会吃掉桌面点击），
// 打开喂食面板时临时扩容，关闭后收回
const PET_SIZE = { w: 220, h: 220 };
const PET_MENU_SIZE = { w: 520, h: 360 };
const petMenuExpansion = createPetMenuExpansion({ petSize: PET_SIZE, menuSize: PET_MENU_SIZE });
// 注视归一化半径：光标离宠物中心达到该距离时，注视向量即满偏（±1）。
const PET_GAZE_RADIUS = 200;
const PET_PRESENTATION_MAX_TTL_MS = 10 * 60 * 1000;

let tray = null, popover = null, impulseWindow = null, petWindow = null;
let iconFrame = 0;
let petPresentationSequence = 0;
const runtimeSessionClock = new RuntimeSessionClock({
  wallNow: () => Date.now(),
  monotonicNow: () => performance.now()
});
const adjustFocusDurationWorkflow = createAdjustFocusDurationWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => sessionTransitionNow() },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.adjustedAt);
  },
  publish: () => pushStateChange({ pomodoro: true, settings: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const archiveWorkItemWorkflow = createArchiveWorkItemWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: publishArchivedWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:archive' })
});
const restoreWorkItemCommand = work.restoreWorkItem.createRestoreWorkItemCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  renewExpiry: restoredAt => computeAutoExpiry(restoredAt),
  publish: publishRestoredWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:restore' })
});
const clarifyWorkItemWorkflow = createClarifyWorkItemWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  suggestNextAction: title => {
    const suggestion = breakdownTask(title)[0];
    return suggestion ? suggestion.title : null;
  },
  publish: publishClarifiedWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:clarify-now' })
});
const duplicateWorkItemCommand = work.duplicateWorkItem.createDuplicateWorkItemCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: publishDuplicatedWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:duplicate' })
});
const updateRecurrenceSeriesCommand = work.updateRecurrenceSeries.createUpdateRecurrenceSeriesCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: publishUpdatedRecurrenceSeries,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'series:update' })
});
const resolveReviewWorkflow = createResolveReviewWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: fact => pushStateChange({
    reviews: true,
    tasks: fact.updatedTasks.length > 0,
    recommendations: fact.updatedTasks.length > 0
  }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'reviews:resolve' })
});
const resolveFocusLandingWorkflow = createResolveFocusLandingWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: publishResolvedFocusLanding,
  reportEffectError: error => reportWindowDeliveryError(error, {
    channel: 'pomodoro:resolve-focus-landing'
  })
});
const resolveQuickStartWorkflow = createResolveQuickStartWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: wallNow => sessionTransitionNow(wallNow) },
  idFactory: createDomainId,
  renewExpiry: (renewedAt, settings) => computeAutoExpiry(renewedAt, settings),
  synchronize: fact => {
    syncRuntimeSessionClock(fact.session.startedAt || fact.resolvedAt);
    lastSoftReminderAt = fact.session.startedAt || fact.resolvedAt;
  },
  publish: publishResolvedQuickStart,
  reportEffectError: error => reportWindowDeliveryError(error, {
    channel: 'pomodoro:resolve-quick-start'
  })
});
const startFocusSessionWorkflow = createStartFocusSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  idFactory: createDomainId,
  synchronize: fact => {
    syncRuntimeSessionClock(fact.startedAt);
    lastSoftReminderAt = fact.startedAt;
  },
  publish: publishStartedFocusSession,
  reportEffectError: error => reportWindowDeliveryError(error, {
    channel: 'pomodoro:start'
  })
});
const startBreakSessionCommand = createStartBreakSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  idFactory: createDomainId,
  synchronize: fact => {
    syncRuntimeSessionClock(fact.startedAt);
  },
  publish: fact => growthPublisher.startBreak(fact),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const resumeFocusSessionWorkflow = createResumeFocusSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.resumedAt);
    lastSoftReminderAt = fact.resumedAt;
  },
  publish: () => pushStateChange({ pomodoro: true, stats: true, tasks: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const pauseSessionCommand = execution.pauseSession.createPauseSessionCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.pausedAt);
  },
  clearNudge: () => nudge.clearNudge(),
  publish: () => pushStateChange({ pomodoro: true, stats: true, tasks: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const pauseForInterruptionCommand = execution.pauseForInterruption.createPauseForInterruptionCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.pausedAt);
  },
  clearNudge: () => nudge.clearNudge(),
  clearTray: () => {
    if (tray) tray.setTitle('');
  },
  publish: () => pushStateChange({ pomodoro: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const recoverSessionCommand = execution.recoverSession.createRecoverSessionCommand({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.recoveredAt);
  },
  notifyDue: () => showNotification({
    title: '⏸ 上次计时等待确认',
    body: '应用离开期间不会自动发奖励；打开面板选择“确认计入完成”或“放弃本轮”。'
  }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});
const taskUndo = createTaskUndo({ unitOfWork: stateUnitOfWork, clock: { now: () => Date.now() }, idFactory: createDomainId, timelineRecorder,
  publishChange: pushStateChange, reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:undo-complete' }) });
const completeWorkItemWorkflow = createCompleteWorkItemWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => sessionTransitionNow() },
  idFactory: createDomainId,
  undo: taskUndo.registry,
  synchronize: fact => {
    syncRuntimeSessionClock(fact.completedAt);
  },
  publish: fact => { publishCompletedWorkItem(fact); quickPanelHost.feedback('completed'); },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:complete' })
});
const completeWorkStepWorkflow = createCompleteWorkStepWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  publish: fact => { publishCompletedWorkStep(fact); quickPanelHost.feedback('step'); },
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:complete-step' })
});
const skipWorkOccurrenceWorkflow = createSkipWorkOccurrenceWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  publish: publishSkippedWorkOccurrence,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:skip-occurrence' })
});
const updateWorkItemWorkflow = createUpdateWorkItemWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  idFactory: createDomainId,
  inferEnergy,
  suggestDuration,
  publish: publishUpdatedWorkItem,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'tasks:update' })
});
const settleFocusSessionWorkflow = createSettleFocusSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => sessionTransitionNow() },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.settledAt);
  },
  publish: publishSettledFocusSession,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'pomodoro:settle' })
});
const acceptHealthyShutdownWorkflow = createAcceptHealthyShutdownWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.settledAt);
  },
  publishSettlement: fact => { if (fact.completion) timelineRecorder.recordSessionSettlement(fact.completion); },
  clearNudge: () => nudge.clearNudge({ deferredPolicy: 'all' }),
  clearTray: () => {
    if (tray) tray.setTitle('');
  },
  publish: publishHealthyShutdown,
  revealHandoff: revealHealthyShutdownHandoff,
  reportEffectError: error => reportWindowDeliveryError(error, {
    channel: 'work-boundary:healthy-shutdown'
  })
});
const completeDueSessionWorkflow = createCompleteDueSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.settledAt);
  },
  publishSettlement: publishSettledFocusSession,
  present: fact => handleCompletedSession(fact.completion),
  publish: () => pushStateChange({
    pomodoro: true,
    stats: true,
    tasks: true,
    quickStartDecision: true
  }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'timer:session-due' })
});
const stopFocusSessionWorkflow = createStopFocusSessionWorkflow({
  unitOfWork: stateUnitOfWork,
  clock: { now: () => Date.now() },
  sessionClock: { now: (session, wallNow) => runtimeSessionClock.now(session, wallNow) },
  synchronize: fact => {
    syncRuntimeSessionClock(fact.settledAt);
  },
  publishSettlement: publishSettledFocusSession,
  clearNudge: () => nudge.clearNudge(),
  clearTray: () => {
    if (tray) tray.setTitle('');
  },
  present: presentStoppedSession,
  publish: () => pushStateChange({ pomodoro: true, stats: true, tasks: true }),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'pomodoro:stop' })
});
let lastSoftReminderAt = canonicalFocusSession().startedAt || Date.now();
let celebrationUntil = 0;
let surpriseRunInFlight = null;
let petReportedVisualState = 'idle';
let petDockedEdge = null;
let petPeeking = false;
let petLastMouseNearAt = 0;
let petIsDragging = false;
// 锁屏时注视回中（不追踪光标）。
let petScreenLocked = false;
const builtInContentManifest = adaptLegacyPetContent(petContent);
const petContentQuery = companionCapability.petContent.createPetContentQuery({ content: petContent, manifest: builtInContentManifest, skins: SKINS });
let sensitiveForeground = false;
let petRuntime = {
  visible: false,
  menuOpen: false,
  dragging: false,
  prefersReducedMotion: false
};

const screenHost = createScreenHost();
const petDragSession = createPetDragSession({ cursorPoint: screenHost.cursorPoint });
const ipcHost = createIpcHost();
const permissionHost = createPermissionHost();
const powerHost = createPowerHost();
const shortcutHost = createShortcutHost();
const sittingReminder = attention.sittingReminder.createSittingReminder({
  now: () => Date.now(),
  idleSeconds: () => powerHost.systemIdleSeconds(),
  isSessionRunning: () => isActiveSession(canonicalFocusSession()),
  isWorkTime: () => isWorkTime(),
  getSettings: () => ({ ...getSettings(), themePrimary: getCurrentTheme().primary }),
  random: () => Math.random(),
  remind: request => { void startNudgeBestEffort(request, { petMessage: request.message }); }
});
// ARCHITECTURE「日常与能量」:日常提醒采样器,和上面那条久坐提醒挂在同一个 30 秒定时器上(见
// startHydrationTimer)。它通过原writer记录notified并产生routine.reminded / missed，
// 与面板共用day-plan。这里不传petMessage，避免在原提醒之外第二次镜像日常标题；
// DND、前台限制和既有companion单次投递由nudge host处理。
const routineReminder = routinesCapability.routineReminder.createRoutineReminder({
  now: () => Date.now(),
  dayKey: timestamp => localDayKey(timestamp),
  getRoutines: () => store.get('routines') || [],
  getRoutineLog: () => store.get('routineLog') || { days: [] },
  getSettings: () => ({ ...getSettings(), themePrimary: getCurrentTheme().primary }),
  remind: request => startNudgeBestEffort(request),
  recordNotified: input => logRoutineOccurrenceCommand.recordNotified(input),
  recordMissed: routineTimelineEffects.recordMissed
});
// Every reminder surface — notification, corner characters, covering card — and
// the escalation and deferral timers behind them. The rules about what may be
// said and when it may escalate live in the attention capability; this host only
// carries them out against the OS.
const nudge = createNudgeHost({
  resolveRoutineRequest: routineReminder.resolveRequest,
  presentCompanion: text => petWindow?.isVisible() && safeWindowSend(petWindow, 'pet:sync', { message: text }),
  screenHost,
  shortcutHost,
  preloadPath: path.join(__dirname, 'preload-nudge.js'),
  cornerPagePath: path.join(__dirname, 'renderer', 'nudge-corner.html'),
  fullscreenPagePath: path.join(__dirname, 'renderer', 'nudge-fullscreen.html'),
  onDeliveryError: reportWindowDeliveryError
});

// ARCHITECTURE「快捷行动面板」：闪念热键由 quickPanelHost 的绑定阶梯认领，先试用户配置，
// 被占用就依次退到内置候选，最终生效值经 quickPanel:describeShortcut 上报给设置界面。
// 这里只做接线：显示/隐藏复用既有的闪念窗宿主（ARCHITECTURE「快捷行动面板」），落点用宿主按「用户正在看的
// 屏幕」算出的 landing（ARCHITECTURE「快捷行动面板」）。面板可见时先隐藏，所以它永远不会把落点锚到自己身上；
// 因此不必给 ownsSender 传自有窗口判定，用默认值即可。
const quickPanelHost = createQuickPanelHost({
  shortcutHost,
  screenHost,
  isPanelVisible: () => Boolean(impulseWindow && impulseWindow.isVisible()),
  showPanel: display => {
    if (!impulseWindow) createImpulseWindow();
    impulseWindow.setMode(getState().quickPanel, display.workArea);
    pushImpulseSensoryProfile();
    const wb = impulseWindow.getBounds();
    const { x, y } = quickPanelHost.landingFor(display, { width: wb.width, height: wb.height });
    impulseWindow.setPosition(x, y, false);
    impulseWindow.showAndFocus();
    return { ...wb, x, y };
  },
  hidePanel: () => { if (impulseWindow) impulseWindow.hide(); },
  cuePet: (display, panelBounds) => borrowPetForQuickPanel({ petWindow, display, panelBounds, settings: getSettings(), readRuntime: () => petRuntime })
});

const {
  show: showNotification,
  closeAll: closeAppNotifications
} = createNotificationHost({
  presentCompanion: text => petWindow?.isVisible() && safeWindowSend(petWindow, 'pet:sync', { message: text }),
  isSuppressed: () => getSettings().dnd,
  isSoundEnabled: () => getSettings().soundEnabled,
  onError: error => {
    // Notifications are post-commit feedback. A host failure must never make
    // a committed command look retryable to the renderer.
    console.warn('I’m ADHDer notification failed:', error && error.message ? error.message : error);
  }
});

const { lifecycle, surpriseDirector } = createBootstrapRuntime({
  surpriseDirector: {
    manifest: builtInContentManifest,
    loadState: () => store.get('companion'),
    saveState: companion => {
      const result = persistSurpriseStateCommand.execute({ companion });
      if (!result.ok) throw new Error(`surprise state persistence rejected: ${result.reason}`);
      return result;
    },
    clock: { now: () => Date.now(), dayKey: timestamp => localDayKey(timestamp) },
    monotonicClock: { now: () => performance.now() },
    rng: () => Math.random(),
    deliver: envelope => safeWindowSend(petWindow, 'pet:cue', envelope)
  },
  onLifecycleError: (error, resource) => {
    console.warn(`I’m ADHDer lifecycle cleanup failed (${resource.name}):`, error && error.message ? error.message : error);
  }
});
lifecycle.register('electron:ipc-host', () => ipcHost.dispose());
// 活动镜像：设置开启时才运行探针与本机接收端，只把类别交给桌宠和面板（ARCHITECTURE「活动镜像」）。
const activityMirror = createActivityMirror({ appHost, profile: application.profile, getSettings,
  readIdleMs: () => powerHost.systemIdleSeconds() * 1000, publishChange: dirty => pushStateChange(dirty),
  presentMirror: (activity, concurrent) => safeWindowSend(petWindow, 'pet:sync', { activityMirror: activity, activityMirrorConcurrent: concurrent }),
  reportError: (error, channel) => reportWindowDeliveryError(error, { channel }) });
lifecycle.register('activity:mirror', () => activityMirror.dispose());
surpriseDirector.recoverAfterRestart();

appHost.hideDock();
function activatePrimaryWindow() {
  if (!appHost.isReady()) return;
  if (!popover) createPopover();
  positionPopoverNearTray();
  popover.showAndFocus();
}

const showPrivateTaskNotification = createPrivateTaskNotifications(payload => showNotification(payload));

const startNudgeBestEffort = createNudgeDelivery({ nudge, presentCompanion: petTalk,
  reportError: error => console.warn('I’m ADHDer nudge failed:', error?.message || error) });

function reportWindowDeliveryError(error, { channel = 'unknown' } = {}) {
  console.warn(`I’m ADHDer renderer delivery failed (${channel}):`, error && error.message ? error.message : error);
}

function safeWindowSend(win, channel, payload) {
  try {
    return Boolean(win && win.send(channel, payload));
  } catch (error) {
    // Renderer delivery is a projection of canonical main-process state. A
    // crashed/reloading window must not make an already committed IPC action
    // look failed and tempt the user to repeat a toggle or reward action.
    try { reportWindowDeliveryError(error, { channel }); } catch (_) {}
    return false;
  }
}

// 会话只有一个权威副本：持久化状态。先前这里另有一个 focusSession 变量，由 13 处
// synchronize 回调逐个镜像 fact.session，而 runPostCommitEffect 会吞掉并上报回调里的异常
// ——真出错时状态已提交、镜像却没跟上，读到旧会话的地方无从察觉。改成每次读权威值，镜像
// 与提交之间的时序契约随之消失。
function canonicalFocusSession() {
  return store.get('focusSession');
}

function sessionTransitionNow(wallNow = Date.now()) {
  return runtimeSessionClock.now(canonicalFocusSession(), wallNow);
}

function syncRuntimeSessionClock(wallNow = Date.now()) {
  const session = canonicalFocusSession();
  if (isActiveSession(session)) runtimeSessionClock.anchor(session, wallNow);
  else runtimeSessionClock.clear();
}

function notifyLevelUp(reward) {
  companionCapability.levelUpFeedback.presentLevelUp(reward, {
    notify: payload => showNotification({ ...payload, delivery: 'companion' }), presentExpression: petTellExpression
  });
}

function persistFocusSettlement(next, completion, now = sessionTransitionNow()) {
  const result = settleFocusSessionWorkflow.execute({ nextSession: next, completion, settledAt: now });
  if (!result.ok) throw new Error(`focus session settlement rejected: ${result.reason}`);
  return { ...result.reward, foodDrop: result.foodDrop };
}

// ============ SKIN + THEME ============
// 皮肤解锁条件与当前进度的单一来源，避免展示的进度与实际解锁规则脱节
function getCurrentTheme() { return (SKINS[store.get('currentSkin')] || SKINS.pink).theme; }
function announceSkinUnlocks(skinIds) {
  for (const id of skinIds) {
    const skin = SKINS[id];
    if (skin) showNotification({ delivery: 'companion', title: `解锁新皮肤：${skin.name}`, body: `${skin.unlockDesc}。从页眉进入伙伴页即可换上。` });
  }
}
function trayIconAppearance(frame, mood) {
  const skin = SKINS[store.get('currentSkin')] || SKINS.pink;
  return { frame, mood, palette: skin.palette[mood] || skin.palette.idle };
}
function currentMood(session = canonicalFocusSession()) {
  if (Date.now() < celebrationUntil) return 'celebrate';
  if (!isActiveSession(session)) return 'idle';
  if (isActiveFocusSession(session)) return 'focus';
  return sessionKind(session) === STATUS.BREAK ? 'break' : 'idle';
}
function startIconAnimation() {
  lifecycle.interval('timer:icon-animation', () => {
    iconFrame = (iconFrame + 1) % 8;
    if (!tray) return;
    // 这一轮只读取一次 canonical 会话并向下传递，保证同一心跳内的图标、标题与到时判断
    // 使用同一份样本；store.get 返回缓存快照的副本，不会在这里读取 JSON 文件。
    const session = canonicalFocusSession();
    tray.setIcon(trayIconAppearance(iconFrame, currentMood(session)));
    if (isActiveSession(session)) {
      const now = sessionTransitionNow();
      const remainMs = sessionRemainingMs(session, now);
      if (remainMs <= 0) handleSessionDue();
      else {
        const m = Math.floor(remainMs / 60000), s = Math.floor((remainMs % 60000) / 1000);
        tray.setTitle(` ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
        checkSoftReminder(session, now);
      }
    } else if (isPausedSession(session)) tray.setTitle(' ⏸');
    else tray.setTitle('');
  }, 500);
}

// ============ WORK HOURS ============
// 用户工作时间（默认 10:00 - 21:00）
function getWorkHours() { return preferences.workSchedule.getWorkHours(getSettings()); }
function isWorkTime(date = new Date()) { return preferences.workSchedule.isWorkTime(getSettings(), date.getTime()); }
function computeAutoExpiry(at = Date.now(), settings = getSettings()) {
  return preferences.workSchedule.computeAutoExpiry(at, settings);
}
// 到期只做标记，不删数据：面板里可一键顺延或归档
function expireDueTasks({ notify = true } = {}) {
  const result = expireWorkItemsWorkflow.execute({ notify });
  if (!result.ok) throw new Error(`task expiration rejected: ${result.reason}`);
  return result.expiredCount;
}
// schema 8 的迁移器是唯一读 `category` 的地方，这里不再需要运行时补分类。

// ============ LOCAL-DAY RESET & RECOVERY ============
function todayKey(value = Date.now()) { return localDayKey(value); }

function scheduleDailyReset() {
  const now = Date.now();
  const delay = Math.max(1000, nextLocalDayBoundary(now) + 5000 - now);
  lifecycle.timeout('timer:daily-reset', () => { runDailyReset(); scheduleDailyReset(); }, delay);
}
// 一天一次的本地日推进由 run-daily-reset workflow 原子提交：逾期重算、温和归档、
// 循环续期、到期标记与日期标记在同一个事务里落盘。归档提醒与渲染进程投影都是提交后效果。
function runDailyReset() {
  const result = runDailyResetWorkflow.execute();

  // 同一天重复触发或时钟回拨都是正常结果，不是错误。
  return result.ok ? result.archivedCount : 0;
}

// ============ 到点收工提醒 ============
function getSettings() { return normalizeSettings({ ...SETTINGS_DEFAULTS, ...(store.get('settings') || {}) }); }

const { start: startWorkBoundaryWatcher, check: checkWorkBoundaries } = createWorkBoundaryReminder({
  lifecycle, getSettings, readDate: () => new Date(), getWorkHours,
  readLastNotifiedDay: () => store.get('lastWorkEndNotifyDate'),
  readTasks: () => store.get('tasks'),
  activateScheduledTasks, materializeDueReviews, taskStartBlockReason,
  startNudgeSequence: input => nudge.startNudgeSequence(input),
  getCurrentTheme,
  recordWorkEndReminder: input => recordWorkEndReminderCommand.execute(input),
  petTalk
});

function materializeDueReviews(now = Date.now()) {
  const settings = getSettings();
  if (!settings.dailyReviewEnabled) return [];
  const result = materializeDueReviewsCommand.execute({
    now,
    workStartHour: settings.workStartHour,
    workEndHour: settings.workEndHour
  });
  return result.ok ? result.created : [];
}

// DND 只压提醒这一件事,所以门槛留在宿主侧:静音时这一轮完全不进事务,预约仍然
// 保持未通知状态,解除静音后的下一次巡检会重新把它们叫醒。
function activateScheduledTasks(now = Date.now()) {
  if (getSettings().dnd) return 0;
  const result = activateScheduledWorkCommand.execute({ now });
  return result.ok ? result.activatedCount : 0;
}

// ============ PERSISTED FOCUS SESSION ============
function pomodoroView(now = sessionTransitionNow()) {
  return execution.sessionProjection.projectSession(canonicalFocusSession(), now);
}

function announceBondStage(bondResult) {
  if (!bondResult || !bondResult.stageChanged) return;
  const label = relationshipProjection.bondStageLabel(bondResult.stage);
  safeWindowSend(petWindow, 'pet:sync', { message: `我们现在是「${label}」了` });
}

function hasPendingQuickStartDecision() {
  const decision = store.get('quickStartDecision');
  return Boolean(decision && decision.status === 'pending');
}

function hasPendingFocusLandingPrompt() {
  const prompt = store.get('focusLandingPrompt');
  return Boolean(prompt && prompt.status === 'pending');
}

function hasAwaitingOfflineConfirmation() {
  const session = canonicalFocusSession();
  return isPausedSession(session) && session.awaitingOfflineConfirmation === true;
}

// Preserve the existing handoff: a start request first settles a session
// that reached its deadline, then lets the user act on that completion.
// Focus and rest starts share it, so the refusal envelope has one home.
function deferStartToCompletedSession(result) {
  persistFocusSettlement(result.nextSession, result.completion, result.settledAt);
  handleCompletedSession(result.completion);
  pushStateChange({ pomodoro: true, stats: true, tasks: true, quickStartDecision: true });
  return {
    ok: false,
    reason: result.reason,
    completion: result.completion,
    session: pomodoroView(result.settledAt)
  };
}

function startFocusSession(taskId, minutes, options = {}) {
  const result = startFocusSessionWorkflow.execute({
    taskId, minutes, quick: options.quick === true,
    nextAction: options.nextAction, taskVersion: options.taskVersion
  });
  if (result.reason !== 'previous-session-completed') return result;
  return deferStartToCompletedSession(result);
}

function startRestSession(taskId = null, options = {}) {
  const result = startBreakSessionCommand.execute({
    taskId,
    minutes: getSettings().breakMinutes,
    present: options.syncPet !== false,
    userInitiated: options.userInitiated === true
  });
  if (result.reason !== 'previous-session-completed') return result;
  return deferStartToCompletedSession(result);
}

function pauseFocusSession() {
  const result = pauseSessionCommand.execute();
  if (result.reason !== 'session-completed') return result;

  persistFocusSettlement(result.nextSession, result.completion, result.settledAt);
  nudge.clearNudge();
  handleCompletedSession(result.completion);
  pushStateChange({ pomodoro: true, stats: true, tasks: true });
  return { ok: true, session: pomodoroView(result.settledAt) };
}

function publishCreatedWorkItem(fact) {
  pushStateChange({
    tasks: true,
    stats: fact.breakdown,
    recurrenceSeries: Boolean(fact.seriesId),
    nowTask: true,
    recommendations: true
  });
}

function publishExpiredWorkItems(fact) {
  pushStateChange({ tasks: true, nowTask: true, recommendations: true });
  if (fact.notificationRequested && fact.expiredTaskIds.length > 0) {
    showPrivateTaskNotification('expired', fact.expiredTaskIds.length);
  }
}

// 预约到点也只报数量:锁屏上的通知不该说出预约的是什么。
function publishActivatedScheduledWork(fact) {
  pushStateChange({ tasks: true, recommendations: true });
  showPrivateTaskNotification('scheduled', fact.activatedTaskIds.length);
}

function publishLocalDayReset(fact) {
  pushStateChange({
    tasks: true,
    archivedTasks: true,
    recurrenceSeries: true,
    stats: true,
    nowTask: true,
    recommendations: true,
    // 这一趟一定动了这两处:日志按新的「今天」滚过,曲线画的也已经是另一天 ——
    // 哪怕校准什么都没学到,面板上那条线也必须重取。
    routines: true,
    energy: true
  });
  // ARCHITECTURE「日常与能量」:曲线今天为什么变了形,要能事后查。和另外三处记事一样是提交后的派生
  // 历史,写失败只降级,不把已经落盘的这一趟日推进变成可重试的命令。
  if (fact.energyCalibration) {
    timelineRecorder.recordEnergyCalibrated({
      observations: fact.energyCalibration.observations,
      mae: fact.energyCalibration.mae,
      calibratedAt: fact.resetAt
    });
  }
  // 归档提醒只报数量，不带标题：锁屏或共享屏幕上也不泄露任务内容。
  if (fact.archivedTaskIds.length > 0) {
    showNotification({
      delivery: 'companion',
      title: '待办已温和归档',
      body: `${fact.archivedTaskIds.length} 个长期未处理的到期任务已移到归档，可随时恢复；没有扣分。`
    });
  }
}

function publishCompletedWorkItem(fact) { growthPublisher.completeTask(fact); }

function publishArchivedWorkItem() {
  pushStateChange({
    tasks: true,
    archivedTasks: true,
    nowTask: true,
    recommendations: true,
    focusLandingPrompt: true
  });
}

function publishRestoredWorkItem() {
  pushStateChange({ tasks: true, archivedTasks: true, recommendations: true });
}

function publishClarifiedWorkItem() {
  pushStateChange({ tasks: true, nowTask: true, recommendations: true });
}

function publishDuplicatedWorkItem() {
  pushStateChange({ tasks: true, recommendations: true });
}

function publishUpdatedRecurrenceSeries() {
  pushStateChange({ tasks: true, recurrenceSeries: true, recommendations: true });
}

function publishResolvedFocusLanding(fact) { growthPublisher.resolveLanding(fact); }

function publishResolvedQuickStart(fact) { growthPublisher.resolveQuickStart(fact); }

function publishStartedFocusSession(fact) {
  createSessionStartPublisher({
    notify: showNotification,
    recordTimeline: value => timelineRecorder.recordSessionStarted(value), publish: pushStateChange,
    reportEffectError: error => reportWindowDeliveryError(error, { channel: 'pomodoro:start' })
  })(fact);
}

function publishCompletedWorkStep(fact) { growthPublisher.completeStep(fact); }

function publishSkippedWorkOccurrence() {
  pushStateChange({
    tasks: true,
    nowTask: true,
    recommendations: true,
    recurrenceSeries: true,
    focusLandingPrompt: true
  });
}

function publishUpdatedWorkItem(fact) {
  pushStateChange({
    tasks: true,
    nowTask: true,
    recommendations: true,
    recurrenceSeries: fact.scope === 'current-and-future'
  });
}

function publishSettledFocusSession(fact, { publishSkin = true } = {}) {
  // Settlement state is durable before any renderer, notification or pet
  // feedback runs. A closed surface therefore cannot cause rewards to retry.
  // ARCHITECTURE「事实流与长期记忆」：结算记入 session.segment（条形）与 session.completed（点）。
  timelineRecorder.recordSessionSettlement(fact.completion);
  notifyLevelUp(fact.reward);
  announceSkinUnlocks(fact.newlyUnlockedSkins);
  if (publishSkin && fact.newlyUnlockedSkins.length) pushStateChange({ skin: true });
  if (fact.bond) announceBondStage(fact.bond);
}

function publishHealthyShutdown(fact) { growthPublisher.healthyShutdown(fact); }

function revealHealthyShutdownHandoff(fact) {
  if (!fact.hasPendingHandoff) return;
  activatePrimaryWindow();
}

function presentStoppedSession(fact) {
  if (fact.completion.completed && fact.requestedReason === 'stopped') {
    handleCompletedSession(fact.completion);
    return;
  }
  // Only a user-requested stop carries the stopped expression. Internal
  // interruption reasons must remain neutral even though they share cleanup.
  if (fact.requestedReason === 'stopped') {
    petTellExpression('system.stopped', { source: 'essential', ttlMs: 1800, minHoldMs: 600 });
  }
}

function pauseActiveSessionForInterruption({ publish = true } = {}) {
  return pauseForInterruptionCommand.execute({ publish });
}

const resumeFocusSession = createSessionResumeAdapter({
  workflow: resumeFocusSessionWorkflow, settle: persistFocusSettlement,
  present: handleCompletedSession, publish: pushStateChange, project: pomodoroView,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'state:diff' })
});

function stopFocusSession(reason = 'stopped', action = {}) {
  const result = stopFocusSessionWorkflow.execute({ reason, sessionId: action?.sessionId });
  if (!result.ok) return result;
  // Completion presentation can immediately start a break, so return the
  // current projection rather than the workflow's committed idle snapshot.
  return { ...result, session: pomodoroView() };
}

function acceptHealthyShutdown(dayKey) {
  return acceptHealthyShutdownWorkflow.execute({ dayKey });
}

function handleCompletedSession(completion) {
  const settings = getSettings();
  if (completion.kind === STATUS.QUICK_START) {
    celebrationUntil = Date.now() + 2500;
    petTellTemporaryState('celebrating', 2500);
    showNotification({ title: '✨ 两分钟到了', body: '已经跨过启动门槛。现在停下也算完成一次启动。' });
    return;
  }
  if (completion.kind === STATUS.FOCUS) {
    celebrationUntil = Date.now() + 5000;
    startRestSession(completion.taskId, { syncPet: false, userInitiated: false });
    petTellTemporaryState('celebrating', 5000);
    void startNudgeBestEffort({
      type: 'rest',
      message: `完整一轮完成。休息 ${settings.breakMinutes} 分钟，让大脑完成整合。`,
      maxLevel: settings.restMaxLevel,
      character: settings.nudgeCharacter,
      whitelist: settings.nudgeWhitelist,
      themePrimary: getCurrentTheme().primary,
      motionMode: settings.motionMode,
      stimulationMode: settings.stimulationMode,
      soundEnabled: settings.soundEnabled,
      context: { kind: 'focus-complete', taskId: completion.taskId }
    });
    return;
  }
  if (completion.kind === STATUS.BREAK) sittingReminder.noteRested();
  void startNudgeBestEffort({
    type: 'focus',
    message: '休息结束。先看一眼上次落点，再决定是否回来。',
    maxLevel: Math.min(3, settings.focusMaxLevel + 1),
    character: settings.nudgeCharacter,
    whitelist: settings.nudgeWhitelist,
    themePrimary: getCurrentTheme().primary,
    motionMode: settings.motionMode,
    stimulationMode: settings.stimulationMode,
    soundEnabled: settings.soundEnabled,
    context: { kind: 'break-complete', taskId: completion.taskId }
  });
}

function handleSessionDue() {
  const result = completeDueSessionWorkflow.execute();
  if (!result.ok) throw new Error(`due session settlement rejected: ${result.reason}`);
  return result.completed;
}

function checkSoftReminder(session, now) {
  if (!isActiveSession(session) || sessionKind(session) !== STATUS.FOCUS) return;
  const settings = getSettings();
  const intervalMs = settings.softReminderEvery * 60 * 1000;
  if (now - lastSoftReminderAt < intervalMs) return;
  lastSoftReminderAt = now;
  const focusedMin = Math.floor(sessionElapsedMs(session, now) / 60000);
  const msg = `${focusedMin} 分钟了。需要继续、暂停，还是先休息一下？`;
  void startNudgeBestEffort({
    type: 'rest', message: msg,
    maxLevel: Math.min(2, settings.focusMaxLevel),
    character: settings.nudgeCharacter,
    whitelist: settings.nudgeWhitelist,
    themePrimary: getCurrentTheme().primary,
    motionMode: settings.motionMode,
    stimulationMode: settings.stimulationMode,
    soundEnabled: settings.soundEnabled,
    context: { kind: 'focus-check', taskId: session.taskId }
  }, { petMessage: msg });
}

function recoverPersistedFocusSession() {
  return recoverSessionCommand.execute();
}

const startHydrationTimer = createSittingReminderTimer({
  lifecycle,
  // 两个采样器共用这一个 30 秒定时器:久坐提醒和日常提醒。各自带自己的 onError,一个
  // 抛错不会连累另一个(见 bootstrap/sitting-reminder-timer.js 里逐个采样器的 try/catch)。
  samplers: [
    {
      name: 'hydration',
      sample: sittingReminder.sample,
      onError: error => reportWindowDeliveryError(error, { channel: 'attention:sitting' })
    },
    {
      name: 'routine-reminder',
      sample: routineReminder.sample,
      onError: error => reportWindowDeliveryError(error, { channel: 'routines:reminder' })
    }
  ]
});

// ============ BREAKDOWN ============
const proposalPreview = createProposalAssistance({
  requestScope: application.requestScope,
  getSettings, readTasks: () => store.snapshot().tasks, credentialStore, proposalStore,
  presentExpression: petTellExpression, cancelExpression: petCancelExpression,
  scheduleWaiting: (id, callback, delay) => lifecycle.timeout(
    `timer:proposal-waiting:${id}`, callback, delay
  ),
  now: () => Date.now(), requestTtlMs: PET_PRESENTATION_MAX_TTL_MS,
  timeoutMs: aiTimeoutMs, trace: llmTrace, negotiation: llmProtocolMemory
});
const {
  previewBreakdownProposal, previewEnrichProposal, suggestUnstick, aiDisclosure
} = proposalPreview;
const breakdownTask = guidance.localProposal.breakdownTask;
const companionMeals = createCompanionMeals({
  unitOfWork: stateUnitOfWork, readSnapshot: () => store.snapshot(), clock: { now: () => Date.now() },
  foods: FOODS, credentialStore, lifecycle, requestScope: application.requestScope,
  isLocked: () => petScreenLocked, isVisible: () => Boolean(petWindow?.isVisible()),
  publishState: () => pushStateChange({ pet: true, companion: true }),
  present: payload => safeWindowSend(petWindow, 'pet:sync', payload),
  reportError: error => reportWindowDeliveryError(error, { channel: 'pet:meal' })
});
const aiCollaboration = createAiCollaboration({ storage: application.collaborationStorage,
  requestScope: application.requestScope, onProviderChanged: () => companionMeals.invalidateAdvice(),
  readSnapshot: () => store.snapshot(), stateRepository: store, memoryAuthority: application.memoryAuthority, publishChange: pushStateChange, factStore, credentialStore, getSettings,
  trace: llmTrace, timeoutMs: aiTimeoutMs, negotiation: llmProtocolMemory,
  now: () => Date.now(), idFactory: createDomainId, lifecycle,
  changePorts: { unitOfWork: stateUnitOfWork, readRevision: () => store.revision(),
    normalizeState: normalizePersistedState, taskPolicies: { inferEnergy, suggestDuration },
    publish: () => { inboxOrganization.flushResolved(); pushStateChange({ tasks: true, impulses: true, routines: true, energy: true, recommendations: true, recurrenceSeries: true }); },
    publishTimeline: () => pushStateChange({ timeline: true }),
    reportEffectError: error => reportWindowDeliveryError(error, { channel: 'ai:change-confirm' }) } });

// ============ STATE ============
function buildRecommendations(limit = 2) {
  const [snapshot, settings, pomodoro, now] = [store.snapshot(), getSettings(), pomodoroView(), Date.now()];
  return guidance.recommendations.projectRecommendations({ state: snapshot, settings, pomodoro, now, limit, curveLevel: energyCurveLevelNow({ snapshot, settings, pomodoro, now }) }, taskStartBlockReason);
}

// 四个调用点组装的是同一份入参，散着写已经分叉成“有的调 getSettings()、有的用手边的
// settings 局部”。手边已有 settings 的调用点传进来，省掉一次落盘读取。
const currentEnergy = createCurrentEnergyReader({ readSnapshot: () => store.snapshot(),
  getSettings, getPomodoro: pomodoroView, now: () => Date.now() });

const surfaceReads = createSurfaceReadComposition({
  readSnapshot: () => store.snapshot(),
  clock: { now: () => Date.now(), dayKey: timestamp => localDayKey(timestamp) },
  projectSession: (session, wallNow) => execution.sessionProjection.projectSession(
    session, runtimeSessionClock.now(session, wallNow))
});
const petProjectionOptions = contextRevision => ({ skins: SKINS,
  appearanceItems: petContent.PET_APPEARANCE_ITEMS, contextRevision });
const popoverStateQuery = createPopoverStateQuery({
  readSample: surfaceReads.sample, readSnapshot: () => store.snapshot(),
  readRevision: () => surfacePublisher.readRevision(),
  clock: { now: () => Date.now(), dayKey: timestamp => localDayKey(timestamp) }, skins: SKINS, foods: FOODS, credentialStore,
  appearanceItems: petContent.PET_APPEARANCE_ITEMS,
  aiDisclosure, schemaVersion: PERSISTED_SCHEMA_VERSION, countInboxHistory: impulses => inboxOrganization.historyTotal(impulses),
  readActivityMirror: () => activityMirror.projection(), readStorageStatus: () => store.authoritativeWrites.status()
});
const surfacePublisher = createSurfacePublisher({
  readSample: surfaceReads.sample, projectPopover: popoverStateQuery.project,
  projectPet: (sample, revision) => projectPetContext(sample, petProjectionOptions(revision)),
  reconcileReminders: () => nudge.reconcileRoutineReminders(),
  sendPopover: payload => safeWindowSend(popover, 'state:diff', payload),
  sizeQuick: view => { if (impulseWindow?.isVisible()) impulseWindow.setMode(view); },
  sendQuick: payload => safeWindowSend(impulseWindow, 'state:diff', payload),
  sendPet: payload => safeWindowSend(petWindow, 'pet:sync', payload),
  afterPet: () => refreshSurprisePolicy(), reportEffectError: reportWindowDeliveryError
});
const petQueries = createPetQueries({
  readSample: surfaceReads.sample,
  projectState: sample => projectPetState(sample, petProjectionOptions(surfacePublisher.readRevision()),
    { screenLocked: petScreenLocked, visualState: petReportedVisualState }),
  foods: FOODS
});
const growthPublisher = createGrowthPublisher({
  publishChange: pushStateChange, notifyLevelUp, announceBond: announceBondStage,
  announceSkins: announceSkinUnlocks, recordTaskCompletion: fact => timelineRecorder.recordTaskCompleted(fact),
  celebrateTask: fact => {
    celebrationUntil = fact.completedAt + 3000;
    petTellExpression('react.celebrate', { source: 'essential', ttlMs: 3000, minHoldMs: 900 });
    petTellTemporaryState('celebrating', 3000);
    safeWindowSend(petWindow, 'pet:sync', { taskDone: true });
  },
  notifyRecurrence: () => showPrivateTaskNotification('recurrence-ready'), clearNudge: () => nudge.clearNudge(),
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'growth' })
});
function getState() { return popoverStateQuery.execute(); }
function pushStateChange(dirty) { return surfacePublisher.publish(dirty); }

function currentSurpriseContext() {
  const settings = getSettings();
  const sensory = resolveSensoryPolicy({
    motionMode: settings.motionMode,
    stimulationMode: settings.stimulationMode,
    dnd: settings.dnd,
    systemReducedMotion: petRuntime.prefersReducedMotion
  });
  return {
    visible: Boolean(petWindow && petWindow.isAlive() && petWindow.isVisible()
      && petRuntime.visible && !petScreenLocked),
    menuOpen: petRuntime.menuOpen,
    dragging: petIsDragging || petRuntime.dragging,
    dnd: sensory.dnd,
    sensitiveForeground,
    lowStimulation: sensory.lowStimulation,
    reduceMotion: sensory.reduceMotion,
    focused: isActiveFocusSession(canonicalFocusSession()),
    activityMode: settings.petActivityMode
  };
}

function refreshSurprisePolicy() {
  return surpriseDirector.updateContext(currentSurpriseContext());
}

async function runSurpriseDirector() {
  if (surpriseRunInFlight) return surpriseRunInFlight;
  surpriseRunInFlight = (async () => {
    const settings = getSettings();
    sensitiveForeground = settings.dnd
      ? false
      : await nudge.isSensitiveForeground(settings.nudgeWhitelist);
    const context = currentSurpriseContext();
    surpriseDirector.updateContext(context);
    return surpriseDirector.tick(context);
  })();
  try {
    return await surpriseRunInFlight;
  } finally {
    surpriseRunInFlight = null;
  }
}

// ============ PET HELPERS ============
// 主进程只把已发生的业务事实翻译成结构化 presentation；renderer 仍由同一个
// Director 负责优先级、幂等、TTL 与回到最新 base。沿用 pet:sync，不新增
// preload 能力或可由 renderer 任意发送的通道。
function petTellExpression(expressionId, options = {}) {
  if (!petContent.EXPECTED_EXPRESSION_IDS.includes(expressionId)) return null;
  const source = PRESENTATION_TRANSIENT_SOURCES.includes(options.source) ? options.source : 'essential';
  const ttlMs = Math.min(
    PET_PRESENTATION_MAX_TTL_MS,
    Math.max(1, Math.round(Number(options.ttlMs) || 1500))
  );
  const minHoldMs = Math.min(ttlMs, Math.max(0, Math.round(Number(options.minHoldMs) || 0)));
  petPresentationSequence += 1;
  const eventId = typeof options.eventId === 'string' && options.eventId
    ? options.eventId
    : `main.${expressionId}.${petPresentationSequence}`;
  safeWindowSend(petWindow, 'pet:sync', {
    presentation: { eventId, expressionId, source, ttlMs, minHoldMs }
  });
  return eventId;
}
function petCancelExpression(eventId, reason = 'fact-ended') {
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 200) return false;
  const safeReason = typeof reason === 'string' && reason.length > 0
    ? reason.slice(0, 80)
    : 'fact-ended';
  safeWindowSend(petWindow, 'pet:sync', {
    presentation: { eventId, cancel: true, reason: safeReason }
  });
  return true;
}
function pushNeutralPetGaze() {
  safeWindowSend(petWindow, 'pet:gaze', { x: 0, y: 0, near: false, sameDisplay: false });
}
function setPetScreenLocked(locked) {
  petScreenLocked = locked === true;
  if (petScreenLocked) pushNeutralPetGaze();
  safeWindowSend(petWindow, 'pet:sync', { screenLocked: petScreenLocked });
  refreshSurprisePolicy();
}
function petTellTemporaryState(transientState, transientDurationMs) {
  safeWindowSend(petWindow, 'pet:sync', {
    transientState,
    transientDurationMs: Math.max(0, Math.round(Number(transientDurationMs) || 0))
  });
}
function publishPreferencesUpdate(fact) {
  createPreferencesPublisher({
    mealSettingsChanged: keys => companionMeals.settingsChanged(keys),
    refreshHydration: startHydrationTimer, setDnd: value => nudge.setDND(value),
    closeNotifications: closeAppNotifications, activateScheduled: activateScheduledTasks,
    checkBoundaries: checkWorkBoundaries, setPetVisible: value => value ? showPet() : hidePet(),
    syncActivity: () => activityMirror.sync(), rebindShortcut: value => quickPanelHost.rebind(value),
    setQuickPanelEnabled: value => quickPanelHost.setEnabled(value), refreshBoundaryWatcher: startWorkBoundaryWatcher,
    updateSensory: settings => nudge.updateSensoryProfile(settings), publishImpulseSensory: pushImpulseSensoryProfile,
    publishChange: pushStateChange, reportEffectError: error => reportWindowDeliveryError(error, { channel: 'settings:update' })
  })(fact);
}

function publishEnergyCheckIn() {
  pushStateChange({ energy: true, recommendations: true });
}

function publishStrategyFeedback() {
  pushStateChange({ strategy: true });
}

function petTalk(text) {
  if (getSettings().dnd) return;
  safeWindowSend(petWindow, 'pet:sync', { message: text });
}
function getPetData() {
  return store.get('pet') || {};
}
function publishCompanionInteraction(fact) {
  notifyLevelUp(fact.reward);
  if (fact.bond) announceBondStage(fact.bond);
  announceSkinUnlocks(fact.newlyUnlockedSkins || []);
  const rewarded = Boolean(fact.reward && fact.reward.recorded);
  pushStateChange({
    stats: rewarded,
    companion: Boolean(fact.bond),
    pet: rewarded,
    skin: Boolean(fact.newlyUnlockedSkins && fact.newlyUnlockedSkins.length)
  });
}

// ============ IPC ============
const registerIpc = createRendererIpcRegistrar({
  rendererDirectory: path.resolve(__dirname, 'renderer'), ipcHost, allowedSurfacesFor, assertIpcPayload,
  readTasks: () => store.get('tasks'), getSettings
});

registerAppMaintenance({ registerIpc, getState: () => getState(), stateRepository: store, appHost, lifecycle,
  dismissNotice: id => dismissMigrationNoticeCommand.execute({ noticeId: id }),
  hide: () => { if (popover) popover.hide(); }
});

registerIpc('tasks:add', (_, task) => createWorkItemCommand.execute({ task }));

registerIpc('tasks:complete', (_, { id, confirmUnfinishedSteps }) => {
  const result = completeWorkItemWorkflow.execute({ taskId: id, confirmUnfinishedSteps });
  if (!result.ok) {
    if (result.reason === 'unfinished-steps-need-confirmation') {
      petTellExpression('work.waiting', { source: 'essential', ttlMs: 5000, minHoldMs: 800 });
    }
    return { ok: false, reason: result.reason, unfinishedCount: result.unfinishedCount || 0 };
  }
  return result;
});

// 跳过一次重复：不发奖励、不计失败，只把系列往前推一步，回来时面对的是“下一次”而不是昨天的残局。
registerIpc('tasks:skip-occurrence', (_, { id }) => skipWorkOccurrenceWorkflow.execute({ taskId: id }));

registerIpc('tasks:complete-step', (_, { taskId, stepId }) => {
  return completeWorkStepWorkflow.execute({ taskId, stepId });
});

registerIpc('tasks:delete', (_, id) => (
  archiveWorkItemWorkflow.execute({ taskId: id, reason: 'manual-delete' })
));
registerIpc('tasks:archive', (_, id) => (
  archiveWorkItemWorkflow.execute({ taskId: id, reason: 'manual' })
));
registerIpc('tasks:restore', (_, id) => (
  restoreWorkItemCommand.execute({ taskId: id })
));
registerIpc('tasks:set-now', (_, id) => selectNowWorkflow.execute({ taskId: id }));
registerIpc('tasks:pickOne', (_, options) => {
  return buildRecommendations(options.limit);
});
registerIpc('tasks:preview-breakdown', (_, title) => {
  petTellExpression('system.thinking', { source: 'interaction', ttlMs: 900 });
  const steps = breakdownTask(title);
  petTellExpression('work.waiting', { source: 'essential', ttlMs: 5000, minHoldMs: 800 });
  return steps;
});
registerIpc('tasks:add-with-breakdown', (_, task) => (
  createWorkItemCommand.execute({ task, breakdown: true })
));
// A suggestion about an existing task must name a task that is still editable.
// Refusing here keeps a stale renderer from getting advice about a record it can
// no longer legally change.
function proposalTargetRefusal(taskId) { return proposalPreview.targetRefusal(taskId); }

registerIpc('ai:preview-breakdown', async (_, payload) => {
  const refusal = proposalTargetRefusal(payload && payload.taskId);
  return refusal || previewBreakdownProposal(payload);
});
function consumeBreakdownProposal(proposalId, reason) {
  const stored = proposalStore.consume(proposalId);
  petCancelExpression(`proposal.${proposalId}.provider-unavailable`, reason);
  petCancelExpression(`proposal.${proposalId}.waiting`, reason);
  return stored;
}
registerIpc('ai:preview-enrich', async (_, payload) => proposalTargetRefusal(payload && payload.taskId) || previewEnrichProposal(payload || {}));
registerAiCancellation(registerIpc, proposalPreview);
taskUndo.register(registerIpc);
// 和上面两条一样:请求在任何事务之外等,回来之后再重新校验目标还在不在。
// 区别只在于它不产出 proposalId——建议看完就用,没有「接受」这一步。
registerIpc('ai:suggest-unstick', async (_, payload) => {
  const refusal = proposalTargetRefusal(payload && payload.taskId);
  return refusal || suggestUnstick(payload || {});
});
// Shared collaboration owns profile-scoped sessions and compatibility routes.
aiCollaboration.register(registerIpc, { updatePreferencesCommand });
const applyGuidanceProposal = createApplyGuidanceProposalWorkflow({
  proposalStore, updateWorkItemWorkflow, createWorkItemCommand, consumeBreakdownProposal,
  reportEffectError: error => reportWindowDeliveryError(error, { channel: 'proposal:applied' })
});
registerIpc('tasks:apply-proposal', (_, payload) => applyGuidanceProposal.execute(payload));
registerIpc('tasks:dismiss-proposal', (_, { proposalId }) => ({
  ok: Boolean(consumeBreakdownProposal(proposalId, 'proposal-dismissed'))
}));

registerIpc('strategy:request', (_, { phase, taskId }) => {
  const settings = getSettings();
  if (!settings.strategyGuidanceEnabled) return { ok: false, reason: 'strategy-guidance-disabled' };
  const now = Date.now();
  const dayKey = todayKey(now);
  if (strategyRuntime.dayKey !== dayKey) {
    strategyRuntime.dayKey = dayKey;
    strategyRuntime.recentIds = [];
  }
  const task = taskId ? store.get('tasks').find(item => item.id === taskId) || null : null;
  if (taskId && !task) return { ok: false, reason: 'task-not-found' };
  petTellExpression('system.thinking', { source: 'interaction', ttlMs: 1200, minHoldMs: 300 });
  const selection = selectStrategy(strategyManifest, {
    phase,
    task,
    // 任务自带档位是可编辑字段且写入时没有校验，认不出来就当没填，回落到当前精力估算。
    energyBand: ENERGY_BANDS.includes(task && task.energy) ? task.energy : currentEnergy(settings).band,
    explicitRequest: true,
    sensitiveForeground,
    focusActive: isActiveFocusSession(canonicalFocusSession()),
    settings: {
      motionMode: settings.motionMode,
      stimulationMode: settings.stimulationMode,
      dnd: settings.dnd,
      systemReducedMotion: petRuntime.prefersReducedMotion
    },
    feedback: store.get('strategyFeedback'),
    now
  }, strategyRuntime);
  if (!selection.strategy) return { ok: false, reason: selection.reason };
  const recorded = recordStrategyShownCommand.execute({ strategyId: selection.strategy.id });
  if (!recorded.ok) return recorded;
  strategyRuntime.recentIds = [...strategyRuntime.recentIds, selection.strategy.id].slice(-MAX_RECENT);
  return { ok: true, strategy: selection.strategy };
});
registerIpc('strategy:feedback', (_, { strategyId, helpful }) => {
  if (!strategyManifest.some(strategy => strategy.id === strategyId)) return { ok: false, reason: 'strategy-not-found' };
  const recorded = recordStrategyFeedbackCommand.execute({ strategyId, helpful });
  if (!recorded.ok) return recorded;
  return { ok: true };
});
// Manual edits and accepted proposals enter the same atomic workflow, so step
// identity, recurrence scope and execution-reference cleanup cannot diverge.
registerIpc('tasks:update', (_, { id, patch, scope }) => (
  updateWorkItemWorkflow.execute({ taskId: id, patch, scope })
));

// 继续做类似的事：复制出全新的任务与步骤 ID，不携带任何完成历史与奖励身份。
// 这是“完成不可逆”之后的正式出口：想再做一遍，而不是把历史改回未完成。
registerIpc('tasks:duplicate', (_, { id }) => (
  duplicateWorkItemCommand.execute({ taskId: id })
));

// 改规则只影响还没生成的实例；已完成与已跳过的历史从不重写。
registerIpc('series:update', (_, { seriesId, rule, state: seriesState }) => (
  updateRecurrenceSeriesCommand.execute({ seriesId, rule, seriesState })
));


registerIpc('history:list', (_, options) => ({ ok: true, ...pageTaskHistory(store.get('archivedTasks'), options) }));

registerIpc('reviews:open', (_, { id }) => guidance.dailyReview.openReview(store.snapshot(), id));
registerIpc('reviews:resolve', (_, payload) => resolveReviewWorkflow.execute(payload));

registerIpc('tasks:clarify-now', (_, { taskId, blocker, nextAction }) => (
  clarifyWorkItemWorkflow.execute({ taskId, blocker, nextAction })
));

// 时效顺延：用户可以给一个具体时间，不给则按当前默认时效重新算。
registerIpc('tasks:renew', (_, { id, expiresAt }) => {
  const result = updateWorkItemWorkflow.execute({
    taskId: id,
    patch: { expiresAt: expiresAt || computeAutoExpiry() },
    scope: 'current'
  });
  if (!result.ok) return { ok: false, reason: result.reason, expiresAt: null };
  return { ok: true, expiresAt: result.task.expiresAt };
});

registerIpc('pomodoro:start', (_, { taskId, minutes }) => startFocusSession(taskId, minutes));
registerIpc('pomodoro:kickstart', (_, { taskId, nextAction, taskVersion }) => startFocusSession(taskId, 2, { quick: true, nextAction, taskVersion }));
registerIpc('pomodoro:stop', (_, action) => stopFocusSession('stopped', action));
registerIpc('pomodoro:pause', () => pauseFocusSession());
registerIpc('pomodoro:resume', (_, action) => resumeFocusSession(action));
registerIpc('pomodoro:adjust-duration', (_, { minutes }) => adjustFocusDurationWorkflow.execute({ minutes }));
registerIpc('pomodoro:resolve-quick-start', (_, action) => resolveQuickStartWorkflow.execute(action));
registerIpc('pomodoro:resolve-focus-landing', (_, payload) => (
  resolveFocusLandingWorkflow.execute(payload)
));

registerIpc('impulses:add', (_, text) => captureImpulseCommand.execute({ text }));
inboxOrganization.register(registerIpc);
activityMirror.register(registerIpc);

registerIpc('energy:check-in', (_, checkIn) => {
  const result = recordEnergyCheckInCommand.execute({ checkIn });
  if (!result.ok) return result;
  return { ok: true, estimate: buildRecommendations(2).energy };
});
energyAssistance.register(registerIpc);
planningPreferences.register(registerIpc);
// 丢掉学到的参数,曲线回到未校准的样子。changed=false 是"本来就没学过",
// 面板要能把这两种结果说成不同的话。
registerIpc('energy:reset-calibration', () => resetEnergyCalibrationCommand.execute());

registerIpc('skin:switch', (_, skinId) => {
  const result = selectSkinCommand.execute({ skinId });
  return result.ok;
});
// 这两条把 reason 原样交回面板,和 skin:switch 只回 boolean 不同:换皮肤在面板上只有
// 已解锁的皮肤可点,失败只能是并发;佩戴则可能撞上等级回退或目录变动,面板得说清是哪一种。
registerIpc('appearance:equip', (_, payload) => equipAppearanceCommand.equip(payload));
registerIpc('appearance:reset', () => equipAppearanceCommand.reset());
companionFoodShop.register(registerIpc);
// 日常的五条。前三条改清单,后两条记一次「做了/跳过」以及撤回。打卡这条的白名单里
// 还有两个 nudge surface —— 提醒卡上的「已完成」必须能直接落账,否则用户点了卡片、
// 曲线却没动,他会记得自己吃了药而应用记得没有。
registerIpc('routines:add', (_, payload) => manageRoutineCommand.add(payload));
registerIpc('routines:update', (_, payload) => manageRoutineCommand.update(payload));
registerIpc('routines:remove', (_, payload) => manageRoutineCommand.remove(payload));
registerIpc('routines:log', (_, payload) => logRoutineOccurrenceCommand.log(payload));
registerIpc('routines:undo-log', (_, payload) => logRoutineOccurrenceCommand.undo(payload));
registerIpc('nudge:dismiss', (event, actionId) => nudge.dismissCurrentNudge(actionId, event.sender));
registerIpc('nudge:pointer-interactive', (event, interactive) => {
  return nudge.setPointerInteractiveForSender(event.sender, interactive);
});
registerIpc('nudge:test', async (_, payload) => {
  const settings = getSettings();
  const kind = (payload && payload.kind) || 'rest';
  const level = (payload && payload.level) || 1;
  try {
    const result = await nudge.showLevel({
      level,
      type: kind === 'focus' ? 'focus' : 'rest',
      message: kind === 'focus' ? '来专注吧！' : '休息一下～',
      character: settings.nudgeCharacter,
      themePrimary: getCurrentTheme().primary,
      motionMode: settings.motionMode,
      stimulationMode: settings.stimulationMode,
      soundEnabled: settings.soundEnabled
    });
    return result && result.shown === true
      ? { ok: true }
      : { ok: false, reason: result && result.reason || 'nudge-not-shown' };
  } catch (error) {
    console.warn('I’m ADHDer test nudge failed:', error && error.message ? error.message : error);
    return { ok: false, reason: 'nudge-failed' };
  }
});

registerNudgeActions({
  nudge, resolveRoutineRequest: routineReminder.resolveRequest, logRoutineOccurrenceCommand,
  recordTaskAvoidance: input => recordTaskAvoidanceWorkflow.execute(input),
  readFocusSession: canonicalFocusSession, readNowTaskId: () => store.get('nowTaskId'),
  getSettings, acceptHealthyShutdown, stopFocusSession, startRestSession, startFocusSession
});

// ---- Pet IPC ----
registerIpc('pet:getBounds', () => {
  if (!petWindow || !petWindow.isAlive()) return null;
  return petWindow.getBounds();
});
registerIpc('pet:setPosition', (_, { x, y }) => {
  if (!petWindow || !petWindow.isAlive()) return;
  const next = petDragSession.position({
    bounds: petWindow.getBounds(), requested: { x, y },
    visualSize: companionCapability.formRegistry.visualSizeForSkin(store.get('currentSkin')),
    workAreaAt: point => screenHost.nearestDisplay(point).workArea
  });
  petWindow.setPosition(next.x, next.y, false);
});
registerIpc('pet:savePosition', (_, { x, y }) => {
  updatePreferencesCommand.execute({ patch: { petPosition: { x, y } } });
});
registerIpc('pet:dragStart', () => {
  if (!petWindow?.isAlive()) return;
  petDragSession.begin(petWindow.getBounds());
  petIsDragging = true;
  setPetDockedEdge(null);
  pushNeutralPetGaze();
  refreshSurprisePolicy();
});
registerIpc('pet:dragEnd', () => {
  petDragSession.end();
  petIsDragging = false;
  updatePetDockState();
  refreshSurprisePolicy();
});
registerIpc('pet:updateRuntime', (_, runtime) => {
  petRuntime = { ...runtime };
  refreshSurprisePolicy();
  return { ok: true };
});
registerIpc('pet:cueAck', (_, acknowledgement) => surpriseDirector.acknowledge(acknowledgement));

// 菜单与喂食面板打开时窗口临时扩容；几何（收进屏幕、宠物不跳、面板朝空的一侧）
// 归 platform/electron/pet-menu-expansion。
registerIpc('pet:setMenuOpen', (_, open) => {
  if (!petWindow || !petWindow.isAlive()) return null;
  // Keep the passive companion keyboard-reachable after its menu closes.
  // Win32 uses a stable viewport; other platforms retain the expansion planner.
  petWindow.ensureFocusable({ focus: open });
  if (petWindow.setMenuOpen) return petWindow.setMenuOpen(open);
  const plan = petMenuExpansion.plan({
    bounds: petWindow.getBounds(), open: Boolean(open),
    workAreaAt: point => screenHost.nearestDisplay(point).workArea
  });
  if (plan.changed) petWindow.setBounds(plan.bounds, false);
  return plan.geometry;
});

registerIpc('pet:getFeedState', petQueries.getFeedState);

companionFeeding.register(registerIpc);

const petInteractionCooldowns = new Map();
registerIpc('pet:interaction', (_, interactionId) => {
  const now = Date.now();
  const last = petInteractionCooldowns.get(interactionId) || 0;
  if (now - last < 1500) return { ok: false, reason: 'cooldown' };
  petInteractionCooldowns.set(interactionId, now);
  const recorded = recordCompanionInteractionWorkflow.execute({ interactionId });
  if (!recorded.ok) return recorded;
  if (interactionId === 'click-50') {
    return { ok: true, interactionId, gainedXp: recorded.gainedXp, text: INTERACTIONS.clickCount[50].text };
  }
  const definition = interactionId === 'fling'
    ? INTERACTIONS.fling
    : INTERACTIONS.clickCount[Number(interactionId.split('-')[1])];
  return { ok: true, interactionId, gainedXp: 0, text: definition && definition.text, effect: definition && definition.effect };
});

registerIpc('pet:getContent', petContentQuery);
registerIpc('pet:getContextualLine', (_, context) => petContent.getContextualLine(context));
registerIpc('pet:getState', petQueries.getState);
registerIpc('pet:setState', (_, s) => { petReportedVisualState = s; });
registerIpc('pet:startFocus', () => startFocusSession(store.get('nowTaskId'), getSettings().pomodoroMinutes));
registerIpc('pet:openImpulse', () => toggleImpulseWindow(true));
registerIpc('pet:openPanel', () => { if (popover) { positionPopoverNearTray(); popover.showAndFocus(); } });
registerIpc('pet:toggleDnd', () => {
  const nextDnd = !getSettings().dnd;
  const result = updatePreferencesCommand.execute({ patch: { dnd: nextDnd } });
  return result.ok ? { dnd: result.settings.dnd } : result;
});
registerIpc('pet:hide', () => {
  const result = updatePreferencesCommand.execute({ patch: { petEnabled: false } });
  return result.ok ? undefined : result;
});

registerIpc('impulse:open', () => { toggleImpulseWindow(true); return { ok: true }; });
registerIpc('impulse:hide', () => quickPanelHost.hide());
// 只读查询：返回实际注册上的组合（生效值），设置界面据此显示「配了这个到底注册上没有」。
registerIpc('quickPanel:describeShortcut', () => quickPanelHost.describeShortcut());
const timelineDayQuery = createTimelineDayQuery({ timeline: factStore.timeline,
  energyCurveForDay: dayKey => popoverStateQuery.energyCurveForDay(dayKey) });
registerIpc('timeline:getDay', (_, payload) => timelineDayQuery.execute(payload));

// ============ WINDOWS ============
function createPopover() {
  popover = createPopoverWindowHost({
    preloadPath: path.join(__dirname, 'preload-popover.js'),
    pagePath: path.join(__dirname, 'renderer', 'popover.html'),
    workArea: screenHost.primaryDisplay().workArea,
    onDeliveryError: reportWindowDeliveryError
  });
}
function positionPopoverNearTray() {
  if (!tray || !popover) return;
  const bounds = tray.getBounds();
  const display = screenHost.nearestDisplay(popover.anchorForOpen(bounds));
  popover.placeForOpen({ trayBounds: bounds, display });
}
function togglePopover(fromTray = false) {
  if (!popover) createPopover();
  if (popover.isVisible()) popover.hide();
  // 先推最新状态、再显示：隐藏期间渲染器不绘制，先显示的话第一帧是旧内容，随后才刷新，看起来就是闪一下。
  else if (!(fromTray === true && popover.justHiddenByBlur())) { pushStateChange({ all: true }); positionPopoverNearTray(); popover.showAndFocus(); }
}
function createImpulseWindow() {
  impulseWindow = createImpulseWindowHost({
    preloadPath: path.join(__dirname, 'preload-impulse.js'),
    pagePath: path.join(__dirname, 'renderer', 'impulse.html'),
    onLoaded: pushImpulseSensoryProfile,
    onHidden: () => quickPanelHost.panelHidden(),
    onDeliveryError: reportWindowDeliveryError
  });
}
function pushImpulseSensoryProfile() {
  if (!impulseWindow || !impulseWindow.isAlive() || impulseWindow.isLoading()) return;
  const settings = getSettings();
  impulseWindow.send('sensory:profile', {
    motionMode: settings.motionMode,
    stimulationMode: settings.stimulationMode
  });
}
function toggleImpulseWindow(forceShow) {
  if (impulseWindow?.isVisible() && !forceShow) quickPanelHost.hide();
  else quickPanelHost.open();
}

function createPetWindow() {
  const settings = getSettings();
  const savedPos = settings.petPosition;
  const display = savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)
    ? screenHost.nearestDisplay({ x: savedPos.x, y: savedPos.y })
    : screenHost.primaryDisplay();
  const petWidth = PET_SIZE.w, petHeight = PET_SIZE.h;
  const defaultX = display.workArea.x + display.workArea.width - petWidth - 20;
  const defaultY = display.workArea.y + display.workArea.height - petHeight - 20;
  // Validate saved position; discard if off-screen
  let posX = defaultX, posY = defaultY;
  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    const inX = savedPos.x >= display.workArea.x - 40 && savedPos.x <= display.workArea.x + display.workArea.width - 40;
    const inY = savedPos.y >= display.workArea.y - 40 && savedPos.y <= display.workArea.y + display.workArea.height - 40;
    if (inX && inY) { posX = savedPos.x; posY = savedPos.y; }
  }

  petWindow = createPetWindowHost({
    preloadPath: path.join(__dirname, 'preload-pet.js'),
    pagePath: path.join(__dirname, 'renderer', 'pet.html'),
    bounds: { width: petWidth, height: petHeight, x: posX, y: posY },
    onDeliveryError: reportWindowDeliveryError, enableReload: application.profile === 'development',
    onLoaded: () => {
      safeWindowSend(petWindow, 'pet:sync', {
        ...projectPetContext(surfaceReads.sample(), petProjectionOptions(surfacePublisher.readRevision())),
        screenLocked: petScreenLocked
      });
      petDevelopment.after(() => petWindow.send('pet:dock', { edge: petDockedEdge }));
      petWindow.showInactive();
      lifecycle.timeout('timer:initial-surprise', () => { void runSurpriseDirector(); }, 5_000);
    },
    onHidden: markPetWindowHidden,
    onClosed: markPetWindowHidden
  });
}
function markPetWindowHidden() {
  petDragSession.end();
  petIsDragging = false;
  petRuntime.visible = false;
  refreshSurprisePolicy();
}
function showPet() {
  if (petWindow && petWindow.isAlive()) {
    petWindow.showInactive();
    return;
  }
  createPetWindow();
  startPetMouseTracker();
}
function hidePet() {
  stopPetMouseTracker();
  if (petWindow && petWindow.isAlive()) { petWindow.close(); petWindow = null; }
}

const petDevelopment = createPetDevelopment({ profile: application.profile, sourceRoot: __dirname, getWindow: () => petWindow, showPet });
// ---- Mouse tracker for dock/peek behaviour ----
function setPetDockedEdge(edge) {
  const nextEdge = ['top', 'bottom', 'left', 'right'].includes(edge) ? edge : null;
  if (nextEdge === petDockedEdge) return false;
  petDockedEdge = nextEdge;
  petPeeking = false;
  safeWindowSend(petWindow, 'pet:dock', { edge: nextEdge });
  safeWindowSend(petWindow, 'pet:peek', { peek: false, edge: nextEdge });
  return true;
}

function updatePetDockState() {
  if (!petWindow || !petWindow.isAlive() || petIsDragging) return petDockedEdge;
  const bounds = petWindow.getBounds();
  const visibleRect = petVisibleRect(bounds,
    companionCapability.formRegistry.visualSizeForSkin(store.get('currentSkin')));
  const display = screenHost.nearestDisplay({
    x: Math.round(visibleRect.x + visibleRect.width / 2),
    y: Math.round(visibleRect.y + visibleRect.height / 2)
  });
  const nextEdge = resolvePetDockEdge({
    visibleRect,
    workArea: display.workArea,
    currentEdge: petDockedEdge
  });
  setPetDockedEdge(nextEdge);
  return nextEdge;
}

function startPetMouseTracker() {
  lifecycle.interval('timer:pet-pointer', () => {
    if (!petWindow || !petWindow.isAlive()) return;
    // 门禁态不读取全局光标。拖动方向由 renderer 的 pointermove 本地计算；
    // 锁屏、隐藏和菜单态只需要一次中性快照。
    const pointerBlocked = petIsDragging || petRuntime.dragging || petScreenLocked
      || petRuntime.menuOpen || !petRuntime.visible || !petWindow.isVisible();
    if (pointerBlocked) {
      if (petPeeking) {
        petPeeking = false;
        safeWindowSend(petWindow, 'pet:peek', { peek: false, edge: petDockedEdge });
      }
      pushNeutralPetGaze();
      return;
    }
    updatePetDockState();

    const b = petWindow.getBounds();
    const gazeRect = petVisibleRect(b,
      companionCapability.formRegistry.visualSizeForSkin(store.get('currentSkin')));
    const petX = gazeRect.x + gazeRect.width / 2, petY = gazeRect.y + gazeRect.height / 2;
    const cursor = screenHost.cursorPoint();

    // Peek detection when docked — using pet canvas center as anchor
    if (petDockedEdge) {
      const dx = cursor.x - petX, dy = cursor.y - petY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const shouldPeek = dist < 120;
      const now = Date.now();
      if (shouldPeek) {
        petLastMouseNearAt = now;
        if (!petPeeking) {
          petPeeking = true;
          petWindow.send('pet:peek', { peek: true, edge: petDockedEdge });
        }
      } else if (petPeeking && (now - petLastMouseNearAt) > 2500) {
        petPeeking = false;
        petWindow.send('pet:peek', { peek: false, edge: petDockedEdge });
      }
    } else if (petPeeking) {
      petPeeking = false;
      petWindow.send('pet:peek', { peek: false });
    }

    // 注视：把“光标相对宠物可见中心”的方向归一化到 [-1,1] 推给渲染器。
    // 只读推送、不持久化、不记日志、不留轨迹历史。窗口隐藏、拖动、菜单展开
    // 或光标不在同一屏幕时推送中性值，让眼神回到正中。
    const centerX = gazeRect.x + gazeRect.width / 2;
    const centerY = gazeRect.y + gazeRect.height / 2;
    const petDisplay = screenHost.nearestDisplay({ x: Math.round(centerX), y: Math.round(centerY) });
    const cursorDisplay = screenHost.nearestDisplay(cursor);
    const sameDisplay = petDisplay.id === cursorDisplay.id;
    const trackGaze = sameDisplay;
    let gazeX = 0, gazeY = 0, gazeNear = false;
    if (trackGaze) {
      const dx = cursor.x - centerX;
      const dy = cursor.y - centerY;
      gazeX = Math.max(-1, Math.min(1, dx / PET_GAZE_RADIUS));
      gazeY = Math.max(-1, Math.min(1, dy / PET_GAZE_RADIUS));
      gazeNear = Math.sqrt(dx * dx + dy * dy) < 120;
    }
    petWindow.send('pet:gaze', { x: gazeX, y: gazeY, near: gazeNear, sameDisplay });
  }, 200);
}
function stopPetMouseTracker() {
  lifecycle.clear('timer:pet-pointer');
  setPetDockedEdge(null);
}

// ============ LIFECYCLE ============
lifecycle.register('attention:nudge-system', () => nudge.dispose());
lifecycle.register('electron:app-notifications', closeAppNotifications);
lifecycle.register('electron:global-shortcuts', () => shortcutHost.dispose());
// 只释放自己认领的那一个组合，不动其他宿主的热键（ARCHITECTURE「快捷行动面板」）。
lifecycle.register('electron:quick-panel', () => quickPanelHost.dispose());
const processLifecycle = registerProcessLifecycle({
  lifecycle, mealRuntime: companionMeals,
  appHost, closeStorage: application.closeStorage,
  powerHost,
  isSessionRunning: () => isActiveSession(canonicalFocusSession()),
  pauseActiveSessionForInterruption,
  setScreenLocked: setPetScreenLocked,
  activatePrimaryWindow,
  resumeAfterInterruption: () => {
    // Treat an unexpectedly still-active persisted session exactly like
    // process-start recovery: wall time may establish that it is due, but it
    // must wait for explicit confirmation rather than auto-settle after sleep.
    recoverPersistedFocusSession();
    pushStateChange({ pomodoro: true, all: true });
    void runSurpriseDirector();
  }
});

appHost.whenReady().then(() => {
  lifecycle.register('electron:permission-policy', permissionHost.denyAll());
  nudge.setDND(getSettings().dnd);
  recoverPersistedFocusSession();
  tray = createTrayHost({
    initialIcon: trayIconAppearance(0, 'idle'),
    tooltip: application.profile === 'development'
      ? 'I’m ADHDer（开发档位 · 独立数据）'
      : 'I’m ADHDer — 你的像素专注伙伴',
    onClick: () => togglePopover(true),
    onRightClick: () => {
      const settings = getSettings();
      tray.showMenu([{ label: '打开面板', click: togglePopover }, ...petDevelopment.menuItems(),
      { label: `快捷行动  ${quickPanelHost.describeShortcut().label}`.trimEnd(), click: () => toggleImpulseWindow() },
      { type: 'separator' },
      { label: hasAwaitingOfflineConfirmation()
        ? '上轮已到点（打开面板确认）'
        : isTimingSession(canonicalFocusSession()) ? '停止当前计时' : '开始专注', click: () => {
        if (hasAwaitingOfflineConfirmation()) {
          activatePrimaryWindow();
          return { ok: false, reason: 'awaiting-confirmation', session: pomodoroView() };
        }
        if (hasPendingQuickStartDecision() || hasPendingFocusLandingPrompt()) {
          activatePrimaryWindow();
          return {
            ok: false,
            reason: hasPendingQuickStartDecision()
              ? 'quick-start-decision-pending'
              : 'focus-landing-pending',
            session: pomodoroView()
          };
        }
        if (isTimingSession(canonicalFocusSession())) return stopFocusSession();
        return startFocusSession(store.get('nowTaskId'), getSettings().pomodoroMinutes);
      }},
      { label: settings.dnd ? '✓ 免打扰中（点击关闭）' : '开启免打扰', click: () => {
        const nextDnd = !settings.dnd;
        updatePreferencesCommand.execute({ patch: { dnd: nextDnd } });
      }},
      { label: settings.petEnabled ? '✓ 桌面宠物中（点击关闭）' : '召唤桌面宠物', click: () => {
        const en = !settings.petEnabled;
        updatePreferencesCommand.execute({ patch: { petEnabled: en } });
      }},
      { type: 'separator' },
      { label: '开机自启', type: 'checkbox', checked: appHost.openAtLogin(),
        click: (mi) => appHost.setOpenAtLogin(mi.checked) },
      { label: '退出 I’m ADHDer', click: () => appHost.quit() }
      ]);
    }
  });
  lifecycle.register('electron:tray', () => tray.dispose());

  createPopover();
  createImpulseWindow();
  if (getSettings().petEnabled) { createPetWindow(); startPetMouseTracker(); }
  if (application.profile === 'development') lifecycle.register('electron:pet-hot-reload', petDevelopment.start());
  startIconAnimation();
  startHydrationTimer();
  companionMeals.start();
  scheduleDailyReset();
  runDailyReset();
  expireDueTasks({ notify: false });
  lifecycle.interval('timer:expiry-maintenance', () => {
    expireDueTasks();
  }, 60 * 1000);
  lifecycle.interval('timer:surprise-poll', () => { void runSurpriseDirector(); }, 30 * 1000);
  startWorkBoundaryWatcher();
  const shortcutRegistration = shortcutHost.registerAll([
    { accelerator: 'Alt+Space', handler: togglePopover }
  ]);
  if (!shortcutRegistration.ok) {
    showNotification({ title: '⌨️ 快捷键未完全注册', body: '可能与其他应用冲突；仍可从菜单栏打开 I’m ADHDer。' });
  }
  // 闪念面板的全局热键由 quickPanelHost 的绑定阶梯认领，不进入 registerAll；
  // 先 setEnabled 定下开关，再 rebind 把配置的组合记下并（开启时）认领。阶梯自己处理降级，
  // 全部失败只记一条日志并保留菜单栏入口，不弹错误框（兑现兼容是我们的事，不是用户的）。
  quickPanelHost.setEnabled(getSettings().quickPanelEnabled);
  quickPanelHost.rebind(getSettings().quickPanelShortcut);
  processLifecycle.startPowerMonitoring();
  activityMirror.sync();
});
}
