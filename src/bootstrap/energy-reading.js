'use strict';

// 主进程里任何需要“此刻能量”的地方（推荐、桌宠、快捷面板）都从这里读，和面板读同一条曲线：
// 日常打卡、专注负荷（含正在进行的这一段）和自评校正都在曲线里，不再在别处另算一份。
const { preferences } = require('../capabilities');
const { currentEnergyLevelAt } = require('../application');
const { currentEnergyEstimate } = require('../application/queries/energy-compatibility');
const { localDayKey } = require('../core/calendar');

function energyCurveLevelNow({ snapshot, settings, pomodoro = null, now }) {
  const normalized = preferences.normalizeSettings(settings);
  return currentEnergyLevelAt({
    snapshot,
    settings: normalized,
    at: now,
    dayKey: localDayKey(now),
    workStartHour: preferences.workSchedule.getWorkHours(normalized).start,
    pomodoro
  });
}

function createCurrentEnergyReader({ readSnapshot, getSettings, getPomodoro, now }) {
  return function read(settings = getSettings()) {
    const snapshot = readSnapshot(), pomodoro = getPomodoro(), at = now();
    return currentEnergyEstimate({ stats: snapshot.stats, pomodoroState: pomodoro, settings,
      energyCheckIn: snapshot.energyCheckIn, now: at,
      curveLevel: energyCurveLevelNow({ snapshot, settings, pomodoro, now: at }) });
  };
}

module.exports = { energyCurveLevelNow, createCurrentEnergyReader };
