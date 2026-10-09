'use strict';

const { normalizePersistedState } = require('../../src/platform/persistence/persisted-schema');
const { taskCreation } = require('../../src/capabilities/work');
const { progressState } = require('../../src/capabilities/progress');
const { GROWTH, levelCost } = require('../../src/content/growth-policy.mjs');
const { localDayKey, addDaysToKey } = require('../../src/core/calendar');

const SCENARIOS = Object.freeze([
  'all', 'hungry', 'full', 'flame-near',
  'recurring', 'menu', 'heatmap', 'level-up', 'form-usagi', 'focus-landing'
]);

function buildScenario(scenario, now) {
  if (!SCENARIOS.includes(scenario)) throw new RangeError(`unknown dev scenario: ${scenario}`);
  const state = normalizePersistedState({}, { now });
  state.settings.autoCheckUpdates = false;
  const today = localDayKey(now);
  let sequence = 0;
  const policy = {
    now,
    createId: prefix => `bench-${prefix}-${++sequence}`,
    inferEnergy: () => 'medium',
    suggestDuration: () => 25
  };
  const includes = name => scenario === name || scenario === 'all';
  if (includes('hungry') || scenario === 'full') {
    state.pet.satiation = scenario === 'full' ? 90 : 15;
    state.pet.lastSatiationTick = now;
    state.pet.satiationDecayRemainder = 0;
  }
  // Lv.4 unlock: one explicit first step from Lv.3, 60/90 XP earns 30 XP.
  // Active-day history remains a heatmap fixture, not an unlock prerequisite.
  if (scenario === 'flame-near') {
    state.level = 3;
    state.xp = levelCost(state.level) - GROWTH.firstAdvance - GROWTH.unit;
  }
  if (includes('menu')) {
    for (let index = 1; index <= 12; index += 1) {
      taskCreation.createTask(state, { title: `演示任务 ${index}：检查底部更多菜单`, steps: [] }, policy);
    }
  }
  if (includes('recurring')) {
    taskCreation.createTask(state, {
      title: '从八天前继续这一次', plannedFor: addDaysToKey(today, -8),
      recurrence: { frequency: 'daily', interval: 1, strategy: 'fixed', weekdays: null },
      steps: [{ title: '打开资料' }]
    }, policy);
    state.lastResetDate = today;
  }
  if (includes('heatmap')) {
    for (let offset = 0; offset < 30; offset += 1) {
      const day = addDaysToKey(today, -offset);
      const intensity = offset * 3 % 5;
      const stats = progressState.ensureStats(state);
      for (const [field, amount] of Object.entries({
        dailyFocus: intensity * 25 * 60000, dailyCompletions: intensity,
        dailyLaunches: intensity + 1, dailyReturns: Math.max(0, intensity - 1)
      })) progressState.incrementDaily(stats, field, day, amount);
    }
  }
  if (scenario === 'level-up' || scenario === 'flame-near') {
    // Keep automatic meals out of this bounded growth/30-minute-soak fixture.
    state.pet.satiation = 90;
    const created = taskCreation.createTask(state, {
      title: '完成第一步后升级', steps: [{ title: '验证手动成长与每日食票' }]
    }, policy);
    state.nowTaskId = created.task.id;
  }
  if (scenario === 'form-usagi') {
    state.currentSkin = 'usagi';
    const created = taskCreation.createTask(state, {
      title: '观察长耳伙伴的四边探头', steps: [{ title: '确认长耳、披风与气泡不重叠' }]
    }, policy);
    state.nowTaskId = created.task.id;
  }
  // Persisted handoff fixture: exercise the real renderer/IPC resolution without waiting a full round.
  if (scenario === 'focus-landing') {
    const created = taskCreation.createTask(state, {
      title: '准备周五的分享', steps: [{ title: '写下三个小标题' }]
    }, policy);
    state.nowTaskId = created.task.id;
    state.focusLandingPrompt = {
      sessionId: 'bench-completed-focus', taskId: created.task.id,
      completedAt: now - 1000, status: 'pending'
    };
  }
  return normalizePersistedState(state, { now });
}

module.exports = { SCENARIOS, buildScenario };
