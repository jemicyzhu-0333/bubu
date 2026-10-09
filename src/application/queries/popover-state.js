'use strict';
const { work, progress, execution, guidance, preferences, companion, routines } = require('../../capabilities');
const { pageTaskHistory } = require('../../core/history-page');
const { energyLabel } = require('./energy-compatibility');
const { buildEnergyCurveView } = require('./energy-curve-view');
const { createSurfaceReadComposition } = require('./surface-read-composition');
const { levelCost } = require('../../content/growth-policy.mjs');
const { DIRTY_FIELDS } = require('../../core/state-channel.mjs');
const { relationshipFor } = require('../../core/companion-state');
function createPopoverStateQuery({ readSample, readSnapshot, readRevision, clock, skins, foods, appearanceItems, credentialStore, aiDisclosure, pomodoroView, schemaVersion: PERSISTED_SCHEMA_VERSION, countInboxHistory = null, readActivityMirror = () => null, readStorageStatus = () => null }) {
  const taskStartBlockReason = work.availability.taskStartBlockReason;
  const sample = readSample || createSurfaceReadComposition({ readSnapshot, clock,
    projectSession: (session, now) => pomodoroView
      ? pomodoroView(now, session) : execution.sessionProjection.projectSession(session, now)
  }).sample;
  let inboxHistoryCountVersion = 0;
  function readInboxHistoryTotal(impulses) {
    try {
      const total = typeof countInboxHistory === 'function' ? countInboxHistory(impulses) : null;
      return Number.isSafeInteger(total) && total >= 0 ? total : null;
    } catch (_) { return null; }
  }
  // 橱窗跟着面板状态一起投影,而不是自己开一条查询通道:它要读的 level、unlockedSkins、
  // currentSkin、companion.appearance 全在这份快照里,再开一条通道就等于让同一份状态
  // 有两个到达时刻,面板会先画出新等级、后画出旧解锁。
  //
  // 只带 id 不带完整配饰对象:面板画预览用的是 pet-appearance 那套 art,配饰目录本身
  // 已经通过 pet:getContent 到过渲染进程,再随每次 delta 复制一遍 16 个对象没有意义。
  function projectAppearanceChoices(snapshot) {
    const outfitFor = skinId => companion.appearanceSelection.selectAppearance({
      items: appearanceItems,
      level: snapshot.level,
      unlockedSkins: snapshot.unlockedSkins,
      currentSkin: skinId,
      equipped: snapshot.companion && snapshot.companion.appearance && snapshot.companion.appearance.equipped
    });
    const selection = outfitFor(snapshot.currentSkin);
    // A different species has a separate set of slots. Preview only the
    // IDs that would be worn after switching; do not leak persistent state
    // or replicate the accessory catalog into the renderer projection.
    const wornIdsBySkin = Object.fromEntries(Object.keys(skins).map(skinId => [
      skinId, outfitFor(skinId).worn.map(item => item.id)
    ]));
    return { choices: selection.choices, wornIds: selection.worn.map(item => item.id), wornIdsBySkin };
  }
  function project(sampled, dirty = null) {
    // Full queries keep the complete projection; publication only computes
    // these expensive branches when its existing delta contract consumes them.
    const fields = dirty && !dirty.all ? new Set(Object.entries(DIRTY_FIELDS)
      .flatMap(([flag, names]) => dirty[flag] ? names : [])) : null;
    const { snapshot, now, settings, pomodoro, energyCurve, recommendations,
      energyEstimate, focusMinutes, quickPanel, workStart, workEnd } = sampled;
    const stats = snapshot.stats;
    const nowTaskId = snapshot.nowTaskId;
    const nowTaskCandidate = snapshot.tasks.find(task => task.id === nowTaskId) || null;
    const nowTask = taskStartBlockReason(nowTaskCandidate, now) === null ? nowTaskCandidate : null;
    const withEditEligibility = prompt => prompt ? { ...prompt,
      taskEditable: work.sessionInvestment.canReceiveLandingNote(snapshot, prompt.taskId) } : null;
    const quickStartDecision = withEditEligibility(snapshot.quickStartDecision);
    const landing = withEditEligibility(snapshot.focusLandingPrompt);
    const focusLandingPrompt = landing ? { ...landing,
      healthyShutdown: landing.status === 'pending'
        && snapshot.focusSession.status === 'paused' && snapshot.focusSession.pausedFrom === 'focus'
        && snapshot.focusSession.sessionId === landing.sessionId
    } : null;
    const historyPage = !fields || fields.has('history') || fields.has('archivedTasks') ? pageTaskHistory(snapshot.archivedTasks) : null;
    return {
      revision: readRevision(),
      schemaVersion: PERSISTED_SCHEMA_VERSION,
      tasks: snapshot.tasks, archivedTasks: historyPage?.items,
      impulses: snapshot.impulses.filter(item => !item.resolution),
      // Resolved captures move to the fact-store archive; the count spans both places.
      activityMirror: readActivityMirror(),
      inboxHistoryTotal: readInboxHistoryTotal(snapshot.impulses),
      // A count read can recover without a canonical write; only inbox deltas
      // carry this generation, so unrelated changes never freshen an old count.
      inboxHistoryCountVersion: ++inboxHistoryCountVersion,
      history: historyPage ? {
        total: historyPage.total,
        nextCursor: historyPage.nextCursor,
        retention: historyPage.retention
      } : undefined,
      nowTaskId: nowTask ? nowTask.id : null, nowTask,
      xp: snapshot.xp, level: snapshot.level, levelCost: levelCost(snapshot.level),
      foodTickets: snapshot.pet.foodTickets, feedState: sampled.feedState,
      settings, stats,
      skins: companion.skinProjection.projectSkins(snapshot, skins, { now }), currentSkin: snapshot.currentSkin,
      appearance: !fields || fields.has('appearance') ? projectAppearanceChoices(snapshot) : undefined,
      companionProjection: companion.relationshipProjection.buildRelationshipProjection({ pet: snapshot.pet, companion: snapshot.companion, foods, now, currentSkin: snapshot.currentSkin }),
      foodShop: companion.foodShop.projectFoodShop({
        foods,
        inventory: snapshot.pet && snapshot.pet.foodInventory,
        level: snapshot.level, currentSkin: snapshot.currentSkin, affinity: relationshipFor(snapshot.companion, snapshot.currentSkin).foodAffinity,
        foodTickets: snapshot.pet.foodTickets
      }),
      theme: (skins[snapshot.currentSkin] || skins.pink).theme,
      energy: { ...energyEstimate, label: energyLabel(energyEstimate.level), estimated: true },
      energyCheckIn: snapshot.energyCheckIn,
      // 今天几点起的：ask 为真时能量块里问一次（答了或跳过就不再问）；minutes 是已报的分钟数。
      wake: (() => {
        const dayKey = clock.dayKey(now);
        return {
          dayKey,
          ask: guidance.wakeTime.shouldAskWakeTime(snapshot.wakeTimes, dayKey),
          minutes: guidance.wakeTime.wakeMinutesFor(snapshot.wakeTimes, dayKey)
        };
      })(),
      // 只在进展页时间线里给本人自己看；不进任何模型请求。
      moodNotes: snapshot.moodNotes,
      // 关掉开关时是 null —— 面板据此决定画不画那条 sparkline,不用再读一遍 settings。
      energyCurve,
      recommendations,
      work: { start: workStart, end: workEnd, isWorkTime: preferences.workSchedule.isWorkTime(settings, now) },
      recurrenceSeries: snapshot.recurrenceSeries,
      // 会话时长只有一份定义，面板的时长选择器、托盘与宠物菜单都读这个投影，
      // 不再各自硬编码上限。
      focusMinutes,
      // ARCHITECTURE「快捷行动面板」：只消费这份最小投影；模式、候选和步骤不会在 renderer
      // 再推导一遍，主进程的窗口高度和 surface 画出的内容因此始终一致。
      quickPanel,
      reviews: snapshot.reviews,
      strategy: { enabled: settings.strategyGuidanceEnabled, phases: ['pre-start', 'distraction', 'working-memory', 'time-visibility', 'recovery'] },
      ai: !fields || fields.has('ai') ? {
        enabled: settings.aiBreakdownEnabled,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
        credential: credentialStore.status(),
        disclosure: aiDisclosure(settings)
      } : undefined,
      migrationNotices: snapshot.migrationNotices,
      // 自动失效已经不是某类任务的默认行为，只是“若现在开启会算到哪”的预览。
      autoExpiryPreview: preferences.workSchedule.computeAutoExpiry(now, settings),
      focusSession: snapshot.focusSession,
      pomodoro,
      quickStartDecision,
      quickStartResolutionPending: Boolean(quickStartDecision && quickStartDecision.status === 'pending'),
      focusLandingPrompt,
      // 日常跟着面板状态走,不另开查询通道:它和时间轴那条不同,今天要打的卡是
      // 「现在怎么样」的一部分,和 XP、能量同一个到达时刻,否则会先画出新的完成
      // 数、后画出旧的曲线。
      routines: {
        items: snapshot.routines,
        today: routines.dayPlan.buildDayPlan({
          routines: snapshot.routines,
          routineLog: snapshot.routineLog,
          dayKey: clock.dayKey(now),
          now
        }),
        remindersEnabled: settings.routineRemindersEnabled,
        curveEnabled: settings.energyCurveEnabled
      },
      storageStatus: readStorageStatus(),
      serverNow: now
    };
  }

  // ARCHITECTURE「日常与能量」:当日时间轴上方那条能量带。它不进 `execute()` 的投影 —— 时间轴一次只看
  // 一天，而且多半是过去的某一天;把每一天的曲线都塞进每次 delta 推送,等于为了一次点
  // 击持续复制 365 份数组。所以由 timeline:getDay 按请求算一次。
  //
  // 走的是和今天那条**同一个** buildEnergyCurveView:两条曲线必须出自同一份实现,否则
  // 「昨天这个点是 62」和「今天回看昨天这个点是 58」会同时成立,而两个数都出自本机。
  // 不新增通道:主进程把它挂在 timeline:getDay 已有的响应里。
  function energyCurveForDay(dayKey) {
    const snapshot = readSnapshot();
    const settings = preferences.normalizeSettings(snapshot.settings);
    const { start: workStart } = preferences.workSchedule.getWorkHours(settings);
    // now 照实传:core 自己判断它落不落在这一天里,过去的那些天于是自动没有 nowMinute、
    // 没有趋势、没有推荐窗口 —— 在一条历史曲线上标「现在」会指向一个没发生过的时刻。
    return buildEnergyCurveView({
      snapshot, settings, now: clock.now(), dayKey, workStartHour: workStart
    });
  }

  function execute() { return project(sample()); }
  return Object.freeze({ execute, project, energyCurveForDay });
}
module.exports = { createPopoverStateQuery };
