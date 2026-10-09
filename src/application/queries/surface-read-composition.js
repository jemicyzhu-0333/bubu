'use strict';
const { work, execution, guidance, preferences } = require('../../capabilities');
const { buildEnergyCurveView } = require('./energy-curve-view');
const { buildQuickPanelView } = require('./quick-panel-view');
const { projectCompanionFeedState } = require('./companion-feed-state');
const { projectSessionResumeAction } = require('./session-resume-action');
const { MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES, FOCUS_MINUTE_PRESETS, normalizeFocusMinutes } = execution.sessionDuration;

// Internal read composition only. No command, care maintenance or surface wire
// payload may acquire another canonical snapshot or sample another wall clock.
function createSurfaceReadComposition({ readSnapshot, clock, projectSession }) {
  const taskStartBlockReason = work.availability.taskStartBlockReason;
  function sample() {
    const snapshot = readSnapshot();
    const now = clock.now();
    const settings = preferences.normalizeSettings(snapshot.settings);
    const pomodoro = { ...projectSession(snapshot.focusSession, now), resumeAction: projectSessionResumeAction({
      session: snapshot.focusSession, tasks: snapshot.tasks, now
    }) };
    const { start: workStart, end: workEnd } = preferences.workSchedule.getWorkHours(settings);
    // 曲线要先算:头部那条能量条把它的 `modelLevel` 当 prior(ARCHITECTURE「日常与能量」),否则条上的数字和
    // 曲线上的 now 点会各算一遍、在同一屏上写出两个不同的值。
    // 读数永远来自曲线模型；“显示能量曲线”这个开关只决定画不画，不决定用不用。
    const energyModel = buildEnergyCurveView({
      snapshot, settings: { ...settings, energyCurveEnabled: true }, now,
      dayKey: clock.dayKey(now), workStartHour: workStart, pomodoro
    });
    const energyCurve = settings.energyCurveEnabled ? energyModel : null;
    const recommendations = guidance.recommendations.projectRecommendations({
      state: snapshot, settings, pomodoro, now, limit: 2,
      modelPrior: energyModel ? energyModel.modelLevel : null,
      curveLevel: energyModel ? energyModel.nowLevel : null
    }, taskStartBlockReason);
    const energyEstimate = recommendations.energy;
    const focusMinutes = {
      min: MIN_FOCUS_MINUTES,
      max: MAX_FOCUS_MINUTES,
      presets: FOCUS_MINUTE_PRESETS,
      chosen: normalizeFocusMinutes(settings.lastChosenFocusMinutes, settings.pomodoroMinutes)
    };
    const quickPanel = buildQuickPanelView({
      tasks: snapshot.tasks,
      startState: snapshot,
      now,
      pomodoro,
      recommendations,
      focusMinutes
    });
    const feedState = projectCompanionFeedState(snapshot, now);
    return Object.freeze({ snapshot, now, settings, pomodoro, energyCurve, feedState,
      recommendations, energyEstimate, focusMinutes, quickPanel, workStart, workEnd });
  }
  return Object.freeze({ sample });
}
module.exports = { createSurfaceReadComposition };
