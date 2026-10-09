'use strict';
// ARCHITECTURE「日常与能量」:把 routineLog、自评与校准档案拼成一条面板能直接画的曲线。
//
// 放在查询层而不是某个能力里,是因为它必须跨能力读:`routines`/`routineLog` 归
// routines,`energyCheckIn`/`energySelfReports`/`energyProfile` 归 guidance,`settings` 归 preferences。
// 组合三份状态是投影的活 —— 让其中任何一个能力去读另外两个,边界就白划了。
//
// 送出去的是**裁过的**曲线。core 那份每个采样点都挂着 attribution / baseline /
// slope,96 个点整份推过 IPC 是几十 KB,而 ARCHITECTURE「日常与能量」 要画的是一条 sparkline:它每点只
// 需要一个数。逐点悬停归因不在 ARCHITECTURE「日常与能量」 的范围里;将来时间轴要看,timeline:getDay 可以
// 按天单独要整份,那是一次请求一天,不是每次 delta 都推。
const { buildEnergyCurve, resolveBaselineParams } = require('../../core/energy-curve');
const { energyCurveTrials } = require('../../capabilities/guidance');
const { normalizeWakeTimes } = require('../../core/wellbeing');
const { addDaysToKey, localDayStart } = require('../../core/calendar');
const { effectProfileForKind, defaultEnergyBaseline } = require('../../content/energy-effects.mjs');

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 只收「已完成」的打卡。`notified` 是提醒发出去了,`skipped` 是明确没做,`missed` 是
// 过了窗口 —— 这三种都不该在曲线上留一个隆起,否则「我没喝那杯咖啡」会被画成喝了。
function collectEffects({ routines, routineLog, dayKey }) {
  const definitions = new Map(
    (Array.isArray(routines) ? routines : [])
      .filter(routine => isPlainObject(routine) && typeof routine.id === 'string')
      .map(routine => [routine.id, routine])
  );
  // 昨天的也要收:一杯 22:00 的咖啡、一次 23:30 的小睡,尾巴是跨零点的
  // (routine-schema 把日志保留在 2 天就是为了这个)。
  const wanted = new Set([addDaysToKey(dayKey, -1), dayKey]);
  const effects = [];
  for (const day of (isPlainObject(routineLog) && Array.isArray(routineLog.days) ? routineLog.days : [])) {
    if (!isPlainObject(day) || !wanted.has(day.dayKey)) continue;
    for (const entry of (Array.isArray(day.entries) ? day.entries : [])) {
      if (!isPlainObject(entry) || entry.status !== 'done' || !Number.isFinite(entry.at)) continue;
      const routine = definitions.get(entry.routineId);
      if (!routine) continue;
      // `custom` 的 effect 是 null(content 里就是 null):用户说了「这件事我要记录」,
      // 没说「它让我更有精力」。记下来但不上曲线。
      const profile = isPlainObject(routine.effect) ? routine.effect : effectProfileForKind(routine.kind);
      if (!isPlainObject(profile) || typeof profile.profileId !== 'string') continue;
      effects.push({
        // 带 routineId 而不是 occurrenceId:面板要拿它回查标题,而 ARCHITECTURE「日常与能量」 定下的规矩是
        // 标题只存在 routines.items 一处,不许被复制进第二处。
        id: routine.id,
        label: null,
        kind: routine.kind,
        profileId: profile.profileId,
        at: entry.at,
        magnitude: entry.magnitude,
        amplitude: profile.amplitude,
        durationMin: profile.durationMin
      });
    }
  }
  return effects;
}

// 干预刻度:只画落在这一天里的那些。昨天那杯咖啡的尾巴会抬高今天凌晨的曲线,但它的
// 刻度属于昨天 —— 画在今天的时间轴上会指向一个没发生过的时刻。
function collectMarks(effects, dayStart) {
  const marks = [];
  for (const effect of effects) {
    const minute = Math.round((effect.at - dayStart) / MS_PER_MINUTE);
    if (minute < 0 || minute >= MINUTES_PER_DAY) continue;
    marks.push({ minute, id: effect.id, kind: effect.kind || null });
  }
  return marks.sort((left, right) => left.minute - right.minute);
}

function collectSignalMarks(signals, dayStart) {
  return (Array.isArray(signals) ? signals : []).flatMap(signal => {
    if (!isPlainObject(signal) || !Number.isFinite(signal.at)) return [];
    const minute = Math.round((signal.at - dayStart) / MS_PER_MINUTE);
    if (minute < 0 || minute >= MINUTES_PER_DAY) return [];
    return [{
      minute,
      id: signal.id || null,
      kind: 'impulse-ai',
      label: typeof signal.reason === 'string' ? signal.reason : null
    }];
  }).sort((left, right) => left.minute - right.minute);
}

// 专注负荷的输入：已经结算的专注（奖励账本里每次结算都带结束时间和实际专注时长）加上
// 正在进行的这一段。只收专注和两分钟启动，休息不算消耗。昨天晚上的也收：它的急性部分
// 会拖到今天凌晨，累积部分由 core 只按今天开始的专注计。
const FOCUS_SOURCES = new Set(['focus-complete', 'quick-start-complete']);
const FOCUS_MODES = new Set(['focus', 'quick-start']);
function collectFocusSessions({ rewardLedger, pomodoro, now, dayKey }) {
  const dayStart = localDayStart(dayKey);
  const windowStart = dayStart - 12 * 60 * MS_PER_MINUTE;
  const sessions = [];
  const events = isPlainObject(rewardLedger) && Array.isArray(rewardLedger.events) ? rewardLedger.events : [];
  for (const event of events) {
    if (!isPlainObject(event) || !FOCUS_SOURCES.has(event.source)) continue;
    const endMs = Number(event.createdAt);
    const elapsedMs = isPlainObject(event.metadata) ? Number(event.metadata.elapsedMs) : NaN;
    if (!Number.isFinite(endMs) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) continue;
    if (endMs < windowStart || endMs > dayStart + MINUTES_PER_DAY * MS_PER_MINUTE) continue;
    sessions.push({ startMs: endMs - elapsedMs, endMs });
  }
  if (isPlainObject(pomodoro) && FOCUS_MODES.has(pomodoro.mode) && Number.isFinite(now)) {
    const elapsedMs = Number(pomodoro.elapsedMs);
    if (Number.isFinite(elapsedMs) && elapsedMs > 0) sessions.push({ startMs: now - elapsedMs, endMs: now });
  }
  return sessions;
}
// 只读已留存的自评，不按采集开关丢弃历史、不补造记录。相同时刻历史中最后一项胜出，
// 有效 latest 最后覆盖；时间取观测本身，有限查询时点之后的记录不能提前参与曲线或置信度。
function collectCheckIns(energyCheckIn, history, now) {
  const events = isPlainObject(history) && Array.isArray(history.events) ? history.events : [];
  const latest = isPlainObject(energyCheckIn)
    ? { at: energyCheckIn.timestamp, level: energyCheckIn.level } : null;
  const byTimestamp = new Map();
  for (const entry of [...events, latest]) {
    if (!isPlainObject(entry) || !Number.isFinite(entry.at) || !Number.isFinite(entry.level)
        || (Number.isFinite(now) && entry.at > now)) continue;
    byTimestamp.set(entry.at, { at: entry.at, level: entry.level });
  }
  return [...byTimestamp.values()].sort((left, right) => left.at - right.at);
}

// 没报过或跳过都是 null：曲线照旧按上班时间推。
function reportedWakeMinutes(wakeTimes, dayKey) {
  const value = normalizeWakeTimes(wakeTimes)[dayKey];
  return Number.isInteger(value) ? value : null;
}

function resolveProfile(energyProfile, workStartHour, wakeMinutes = null) {
  const profile = isPlainObject(energyProfile) ? energyProfile : null;
  const base = profile && isPlainObject(profile.baseline)
    ? profile.baseline
    : defaultEnergyBaseline({ workStartHour });
  // 本人报过今天几点起的：当天的起点用它，不再按上班时间去猜（熬夜后的第二天猜错最多）。
  // 只改当天这一份，不写回校准档案；超出 wakeHour 的可调范围时由 resolveBaselineParams 夹住。
  const baseline = Number.isInteger(wakeMinutes) ? { ...base, wakeHour: wakeMinutes / 60 } : base;
  return {
    // 没有校准档案时用 content 的默认基线,并且把上班时间喂进去 —— resolveBaselineParams
    // 自己兜底时调的是 defaultEnergyBaseline(),不带参数,推不出这个人的起床时间。
    baseline,
    effectScale: profile && isPlainObject(profile.effectScale) ? profile.effectScale : null,
    residualMae: profile && Number.isFinite(profile.lastResidualMae) ? profile.lastResidualMae : null,
    calibrated: Boolean(profile),
    observations: profile && Number.isInteger(profile.observations) ? profile.observations : 0
  };
}

// 归因行取整后 0 的那些直接丢掉:一条写着「咖啡 +0」的行读起来像个 bug,
// 而它真实的意思是「这件事此刻已经没影响了」——那就不该占一行。
function trimAttribution(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      const projected = {
        source: row.source,
        id: row.id || null,
        delta: Math.round(row.delta)
      };
      if (row.source === 'impulse-ai' && typeof row.label === 'string') projected.label = row.label;
      return projected;
    })
    .filter(row => row.delta !== 0)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
}

// 入参是「这一天 + 这个人的三份状态」,出参是投影里的一个字段(关掉开关时是 null)。
// dayKey 由调用方给:今天的面板给今天,timeline:getDay 给它要的那一天,同一份实现。
function buildEnergyCurveView({ snapshot, settings, now, dayKey, workStartHour = null, pomodoro = null } = {}) {
  if (!isPlainObject(snapshot) || !isPlainObject(settings)) return null;
  if (!settings.energyCurveEnabled) return null;
  if (typeof dayKey !== 'string' || !dayKey) return null;
  const { baseline, effectScale, residualMae, calibrated, observations } =
    resolveProfile(snapshot.energyProfile, workStartHour, reportedWakeMinutes(snapshot.wakeTimes, dayKey));
  const source = energyCurveTrials.curveSource({ profile: snapshot.energyProfile || null, baseline: resolveBaselineParams(baseline) });
  const trial = energyCurveTrials.curveTrialStatus(snapshot, { source, now });
  const effects = collectEffects({
    routines: snapshot.routines,
    routineLog: snapshot.routineLog,
    dayKey
  });
  const curve = buildEnergyCurve({
    dayKey,
    now: Number.isFinite(now) ? now : null,
    baseline,
    baselineTrial: trial.active ? trial.overlay : null,
    effectScale,
    effects,
    energySignals: snapshot.energySignals,
    focusSessions: collectFocusSessions({ rewardLedger: snapshot.rewardLedger, pomodoro, now, dayKey }),
    checkIns: collectCheckIns(snapshot.energyCheckIn, snapshot.energySelfReports, now),
    residualMae
  });
  return {
    dayKey: curve.dayKey,
    sampleMinutes: curve.sampleMinutes,
    // 一天 96 个整数,压过去大约 400 字节。面板画 sparkline 要的就是这个。
    levels: curve.samples.map(sample => Math.round(sample.level)),
    nowMinute: curve.nowMinute === null ? null : Math.round(curve.nowMinute),
    nowLevel: curve.nowLevel === null ? null : Math.round(curve.nowLevel),
    // ARCHITECTURE「日常与能量」:模型在折进自评之前的读数。头部那条能量条要拿它当 prior,才不会出现
    // 「条上写 55、曲线的 now 点在 68」这种同屏两个真相。
    modelLevel: curve.nowModelLevel === null ? null : Math.round(curve.nowModelLevel),
    trend: curve.trend,
    confidence: curve.confidence,
    attribution: trimAttribution(curve.nowAttribution),
    marks: [
      ...collectMarks(effects, localDayStart(dayKey)),
      ...collectSignalMarks(snapshot.energySignals, localDayStart(dayKey))
    ].sort((left, right) => left.minute - right.minute),
    windows: curve.suggestedWindows.map(window => ({
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      peak: Math.round(window.peak)
    })),
    calibrated,
    observations
  };
}

// ARCHITECTURE「日常与能量」:校准要和界面对同一个数说话,所以这里不另算一份模型,而是复用上面那份视图的
// `modelLevel`。两条理由:它已经把自评从曲线里减掉了 —— 拿没减过的 nowLevel 去比对
// 自评,残差会被自评自己抹平,模型看起来永远很准却什么也学不到;而各算一份的话,校准
// 和头部那条能量条迟早会对同一时刻给出两个模型值,到那时无从判断哪个是对的。
function predictModelLevelAt({ snapshot, settings, at, dayKey, workStartHour = null } = {}) {
  const view = buildEnergyCurveView({ snapshot, settings, now: at, dayKey, workStartHour });
  // 校准热身期要反复按这个种子重置基线,种子就取 `resolveProfile` 没档案时用的那一份 ——
  // 同一个人同一套上班时间,界面和校准不能从两个不同的起点出发。
  const baselineSeed = defaultEnergyBaseline({ workStartHour });
  if (!view || view.modelLevel === null || view.nowMinute === null) {
    return { modelLevel: null, minuteOfDay: null, effects: [], baselineSeed };
  }
  // 归因行带的是 routineId(ARCHITECTURE「日常与能量」:标题只存 routines.items 一处),而 effectScale 按
  // profileId 存。这张对照表按当天真实收到的打卡重建,领域层因此不必为了翻译一个 id
  // 去读 routines 表和内容目录。
  const profileOf = new Map(
    collectEffects({ routines: snapshot.routines, routineLog: snapshot.routineLog, dayKey })
      .map(effect => [effect.id, effect.profileId])
  );
  const totals = new Map();
  for (const row of view.attribution) {
    if (row.source !== 'routine') continue;
    const profileId = profileOf.get(row.id);
    if (!profileId) continue;
    // 同一档效果今天打了两次卡就并成一行:此刻这档效果一共抬了多少,才是能用来调它
    // 缩放系数的那个量。
    totals.set(profileId, (totals.get(profileId) || 0) + row.delta);
  }
  return {
    modelLevel: view.modelLevel,
    minuteOfDay: view.nowMinute,
    baselineSeed,
    // 按 id 排序,让「谁主导了这一刻」在 delta 打平时也只有一个答案 —— 校准必须可复算。
    effects: [...totals]
      .map(([profileId, delta]) => ({ profileId, delta }))
      .sort((left, right) => left.profileId.localeCompare(right.profileId))
  };
}

function currentEnergyLevelAt({ snapshot, settings, at, dayKey, workStartHour = null, pomodoro = null } = {}) {
  const view = buildEnergyCurveView({
    snapshot,
    settings: { ...(settings || {}), energyCurveEnabled: true },
    now: at,
    dayKey,
    workStartHour,
    pomodoro
  });
  return view && Number.isFinite(view.nowLevel) ? view.nowLevel : null;
}

function buildEnergyCurveSource({ snapshot, dayKey, workStartHour = null } = {}) {
  if (!isPlainObject(snapshot)) return null;
  const { baseline } = resolveProfile(snapshot.energyProfile, workStartHour, reportedWakeMinutes(snapshot.wakeTimes, dayKey));
  return energyCurveTrials.curveSource({ profile: snapshot.energyProfile || null, baseline: resolveBaselineParams(baseline) });
}
function capturePlanningEstimate({ snapshot, settings, at, dayKey, workStartHour = null, pomodoro = null } = {}) {
  const source = buildEnergyCurveSource({ snapshot, dayKey, workStartHour });
  const view = buildEnergyCurveView({ snapshot, settings: { ...settings, energyCurveEnabled: true }, now: at, dayKey, workStartHour, pomodoro });
  if (!source || !view || view.modelLevel === null) return null;
  const status = energyCurveTrials.curveTrialStatus(snapshot, { source, now: at });
  return { modelLevel: view.modelLevel, sourceVersion: status.active
    ? JSON.stringify({ base: source.version, trialId: status.trial.id, trialVersion: status.trial.version }) : source.version,
    baseline: status.active ? status.overlay.baseline : source.baseline };
}
function buildEnergyTrialComparison({ snapshot, settings, now, dayKey, workStartHour = null, pomodoro = null, trial } = {}) {
  if (!trial) return null;
  const input = { settings: { ...settings, energyCurveEnabled: true }, now, dayKey, workStartHour, pomodoro };
  const current = buildEnergyCurveView({ ...input, snapshot: { ...snapshot, energyCurveTrials: { version: 0, active: null, undo: null } } });
  const proposed = buildEnergyCurveView({ ...input, snapshot: { ...snapshot,
    energyCurveTrials: { version: trial.version, active: trial, undo: null } } });
  return current && proposed ? { dayKey, sampleMinutes: current.sampleMinutes, current: current.levels,
    proposed: proposed.levels, currentLevel: current.nowLevel, proposedLevel: proposed.nowLevel,
    estimateRange: [10, 90], label: 'nonmedical-planning-estimate' } : null;
}
module.exports = { buildEnergyCurveView, predictModelLevelAt, currentEnergyLevelAt, collectFocusSessions,
  buildEnergyCurveSource, capturePlanningEstimate, buildEnergyTrialComparison };
