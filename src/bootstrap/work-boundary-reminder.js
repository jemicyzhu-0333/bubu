'use strict';
const { nativeCopy } = require('../platform/electron/interface-copy');

const { localDayKey: todayKey, addDaysToKey, compareDayKeys } = require('../core/calendar');

function createWorkBoundaryReminder({
  lifecycle,
  getSettings,
  readDate,
  getWorkHours,
  readLastNotifiedDay,
  readTasks,
  activateScheduledTasks,
  materializeDueReviews,
  taskStartBlockReason,
  startNudgeSequence,
  getCurrentTheme,
  recordWorkEndReminder,
  petTalk
}) {
  const workEndReminderInFlight = new Set();

  function startWorkBoundaryWatcher() {
    lifecycle.interval('timer:work-boundary', () => { void checkWorkBoundaries(); }, 60 * 1000);
    void checkWorkBoundaries();
  }

  async function checkWorkBoundaries() {
    const settings = getSettings();
    const now = readDate();
    activateScheduledTasks(now.getTime());
    materializeDueReviews(now.getTime());
    if (!settings.workEndReminder || settings.dnd) return;
    const { start, end } = getWorkHours();
    let boundaryDay = null;
    if (end === 24) {
      // Midnight belongs to the workday that just ended. Keep a bounded
      // catch-up window until the next workday starts so DND at 00:00 does not
      // consume the only chance to see the reminder.
      if (now.getHours() >= start) return;
      boundaryDay = addDaysToKey(todayKey(now), -1);
    } else {
      if (now.getHours() < end) return;
      boundaryDay = todayKey(now);
    }
    const lastNotifiedDay = readLastNotifiedDay();
    if ((lastNotifiedDay && compareDayKeys(boundaryDay, lastNotifiedDay) <= 0)
        || workEndReminderInFlight.has(boundaryDay)) return;
    const actionable = readTasks().filter(task => taskStartBlockReason(task, now.getTime()) === null).length;
    const msg = actionable > 0
      ? nativeCopy('到点收工了。还有 {count} 件可行动事项，先给明天留一个轻松落点。', { count: actionable })
      : nativeCopy('到点收工了，今天已经足够了 🌙');
    workEndReminderInFlight.add(boundaryDay);
    try {
      const result = await startNudgeSequence({
        type: 'rest',
        message: msg,
        maxLevel: 2,
        character: settings.nudgeCharacter,
        whitelist: settings.nudgeWhitelist,
        themePrimary: getCurrentTheme().primary,
        motionMode: settings.motionMode,
        stimulationMode: settings.stimulationMode,
        soundEnabled: settings.soundEnabled,
        actions: [
          { id: 'accept-rest', label: '收工并检查落点', primary: true },
          { id: 'defer-5', label: '5 分钟后再提醒', deferMinutes: 5 }
        ],
        context: { kind: 'work-end', dayKey: boundaryDay },
        priority: 100
      });
      if (!result || result.shown !== true) return;
      // DND may have changed while the foreground-app check was in flight.
      if (getSettings().dnd) return;
      const recorded = recordWorkEndReminder({ dayKey: boundaryDay });
      if (recorded.ok && recorded.changed && !result.limitedToLevel) petTalk(msg);
    } catch (_) {
      // A transient notification failure must leave the date unconsumed so the
      // next watcher tick can retry safely.
      return;
    } finally {
      workEndReminderInFlight.delete(boundaryDay);
    }
  }

  return Object.freeze({ start: startWorkBoundaryWatcher, check: checkWorkBoundaries });
}

module.exports = { createWorkBoundaryReminder };
