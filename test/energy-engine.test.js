'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inferEnergy,
  suggestDuration,
  currentEnergyLevel,
  currentEnergyEstimate,
  normalizeEnergyCheckIn,
  energyToBand,
  baseEnergyAt,
  smartPickTask,
  rankTasks,
  recommendTasks,
  scoreTask
} = require('../src/application/queries/energy-compatibility');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 7, 28, 11, 0, 0).getTime();

test('legacy inference and duration APIs remain safe and compatible', () => {
  assert.equal(inferEnergy('设计新的支付架构'), 'high');
  assert.equal(inferEnergy('发邮件'), 'low');
  assert.equal(inferEnergy(undefined), 'medium');
  assert.equal(suggestDuration('研究 2 小时', 'high'), 120);
  assert.equal(suggestDuration('看 8 分钟', 'low'), 8);
  assert.equal(suggestDuration('', 'medium'), 25);
});

test('work-hour prior is coarse rather than pseudo-precise', () => {
  const values = [0, 8, 10, 12, 15, 19, 22].map(hour => baseEnergyAt(hour, { workStartHour: 10, workEndHour: 21 }));
  assert.deepEqual(values, [35, 45, 65, 65, 50, 60, 35]);
  assert.ok(values.every(value => value % 5 === 0));
});

test('a fresh user check-in dominates and then decays toward the prior', () => {
  const fresh = currentEnergyEstimate({
    now: NOW,
    settings: { workStartHour: 10, workEndHour: 21 },
    energyCheckIn: { level: 90, state: 'energized', timestamp: NOW }
  });
  const stale = currentEnergyEstimate({
    now: NOW,
    settings: { workStartHour: 10, workEndHour: 21 },
    energyCheckIn: { level: 90, state: 'energized', timestamp: NOW - 6 * HOUR }
  });

  assert.equal(fresh.level, 90);
  assert.equal(fresh.source, 'check-in');
  assert.equal(fresh.confidence, 'high');
  assert.ok(stale.level < fresh.level);
  assert.ok(stale.checkInWeight < fresh.checkInWeight);
  assert.equal(stale.confidence, 'medium');
});

test('a check-in older than one day expires instead of becoming permanent truth', () => {
  const estimate = currentEnergyEstimate({
    now: NOW,
    settings: { workStartHour: 10, workEndHour: 21 },
    energyCheckIn: { level: 5, timestamp: NOW - 25 * HOUR }
  });
  assert.equal(estimate.source, 'time-prior');
  assert.equal(estimate.confidence, 'low');
  assert.equal(estimate.checkInWeight, 0);
  assert.equal(estimate.level, estimate.prior);
});

test('a supplied curve reading replaces the coarse prior without displacing the check-in', () => {
  // F6 section 9: the header bar sits directly above the curve, so it must not compute
  // its own number. When the caller has a curve it hands the reading in here; the
  // five-bucket table steps aside and everything downstream of the prior is unchanged.
  const settings = { workStartHour: 10, workEndHour: 21 };
  const table = currentEnergyEstimate({ now: NOW, settings });
  const curve = currentEnergyEstimate({ now: NOW, settings, modelPrior: 82 });
  assert.equal(table.source, 'time-prior');
  assert.equal(curve.source, 'curve');
  assert.equal(curve.prior, 82);
  assert.ok(curve.level > table.level, '曲线说高就该高,而不是被时段表压回 65');
  // A curve is built from interventions the user actually logged: more than a clock
  // knows, less than a fresh self-report. Neither 'low' nor 'high' would be honest.
  assert.equal(table.confidence, 'low');
  assert.equal(curve.confidence, 'medium');
  assert.match(curve.reason, /日常/);
  // And a real check-in still wins — the curve moved the prior, not the authority.
  const reported = currentEnergyEstimate({
    now: NOW, settings, modelPrior: 82, energyCheckIn: { level: 20, state: 'tired', timestamp: NOW }
  });
  assert.equal(reported.source, 'check-in');
  assert.equal(reported.confidence, 'high');
  assert.ok(reported.level < 40);
  // Garbage from a caller falls back to the table rather than clamping to zero.
  for (const bad of [null, undefined, NaN, 'high', {}]) {
    assert.equal(currentEnergyEstimate({ now: NOW, settings, modelPrior: bad }).level, table.level, String(bad));
  }
  assert.equal(currentEnergyEstimate({ now: NOW, settings, modelPrior: 900 }).prior, 90);
});

test('state-only check-ins, ISO timestamps and bounds are accepted', () => {
  const normalized = normalizeEnergyCheckIn({ status: 'tired', checkedAt: new Date(NOW).toISOString() });
  assert.equal(normalized.level, 25);
  assert.equal(normalized.timestamp, NOW);
  assert.equal(normalizeEnergyCheckIn({ level: 'not-a-number', timestamp: NOW }), null);
  assert.equal(normalizeEnergyCheckIn({ level: 120, timestamp: NOW }).level, 90);
});

test('numeric currentEnergyLevel remains backward compatible and robust to old data', () => {
  const level = currentEnergyLevel(
    { dailyFocus: null },
    { running: false },
    { workStartHour: 10, workEndHour: 21, energyCheckIn: { level: 30, timestamp: NOW - HOUR } }
  );
  assert.equal(typeof level, 'number');
  assert.ok(level >= 10 && level <= 90);
  assert.equal(energyToBand(-10), 'low');
  assert.equal(energyToBand(500), 'high');
  assert.equal(recommendTasks([], -10).energy.level, 10);
  assert.equal(recommendTasks([], 500).energy.level, 90);
  assert.equal(currentEnergyEstimate(null).confidence, 'low');
});

test('focus load uses accumulated active time after pause and resume', () => {
  const estimate = currentEnergyEstimate({
    now: NOW,
    stats: { dailyFocus: {} },
    settings: { workStartHour: 10, workEndHour: 21 },
    pomodoroState: {
      running: true,
      mode: 'focus',
      startedAt: NOW - 60_000,
      elapsedMs: 61 * 60_000
    }
  });
  assert.equal(estimate.activityAdjustment, -8);
});

test('focus load cannot push a displayed estimate below the shared curve floor', () => {
  const estimate = currentEnergyEstimate({
    now: NOW,
    stats: { dailyFocus: { '2026-08-28': 180 * 60_000 } },
    settings: { workStartHour: 10, workEndHour: 21 },
    modelPrior: 10
  });
  assert.equal(estimate.activityAdjustment, -10);
  assert.equal(estimate.level, 10);
});

test('ranking combines urgency, energy, duration and category', () => {
  const tasks = [
    { id: 'easy', title: '发邮件', category: 'adhoc', energy: 'low', suggestedMin: 5, createdAt: NOW - DAY },
    { id: 'urgent', title: '提交发布方案', category: 'midterm', energy: 'medium', suggestedMin: 25, deadline: NOW - HOUR, createdAt: NOW },
    { id: 'deep', title: '设计新架构', category: 'midterm', energy: 'high', suggestedMin: 60, deadline: NOW + 14 * DAY, createdAt: NOW }
  ];
  const ranked = rankTasks(tasks, 25, { now: NOW, limit: 3 });
  assert.equal(ranked[0].id, 'urgent');
  assert.ok(ranked[0].scoreBreakdown.deadline > ranked[0].scoreBreakdown.energyMatch);
  assert.match(ranked[0].reason, /截止时间/);
  assert.equal(ranked.length, 3);
});

test('a task energy band outside the vocabulary is re-inferred, not taken at face value', () => {
  const title = '设计复杂系统';
  const base = { id: 't', title, suggestedMin: 90, category: 'adhoc', createdAt: NOW };
  const scored = energy => scoreTask({ ...base, energy }, { level: 70, band: 'high' }, { now: NOW });
  // `task.energy` is user-editable and nothing validates it on write, so the reader
  // owns the fallback. Pinned here because the rule now lives in one helper instead
  // of an inline list, and the ranking tests above only ever pass valid bands.
  assert.equal(inferEnergy(title), 'high');
  assert.equal(scored('HIGH').scoreBreakdown.energyMatch, scored('high').scoreBreakdown.energyMatch);
  assert.equal(scored(undefined).scoreBreakdown.energyMatch, scored('high').scoreBreakdown.energyMatch);
  assert.notEqual(scored('low').scoreBreakdown.energyMatch, scored('high').scoreBreakdown.energyMatch);
});

test('low energy prefers an approachable short task when urgency is equal', () => {
  const tasks = [
    { id: 'large', title: '设计复杂系统', energy: 'high', suggestedMin: 90, category: 'adhoc', createdAt: NOW },
    { id: 'small', title: '发邮件', energy: 'low', suggestedMin: 10, category: 'adhoc', createdAt: NOW }
  ];
  assert.equal(rankTasks(tasks, { level: 20, band: 'low' }, { now: NOW })[0].id, 'small');
});

test('next action and recent avoidance are surfaced with a two-minute start', () => {
  const task = {
    id: 'blocked',
    title: '准备季度汇报',
    category: 'midterm',
    energy: 'high',
    suggestedMin: 60,
    activationFriction: 'high',
    recentAvoidanceCount: 3,
    lastAvoidedAt: NOW,
    steps: [
      { title: '收集数据', done: true },
      { title: '新建三页空白幻灯片', done: false }
    ]
  };
  const result = rankTasks([task], 50, { now: NOW })[0];
  assert.deepEqual(result.nextStep, { index: 1, title: '新建三页空白幻灯片', estimatedMin: null });
  assert.equal(result.recommendedStartMinutes, 2);
  assert.match(result.reason, /明确下一步/);
  assert.match(result.reason, /多次推迟/);
  assert.equal(result.signals.needsBreakdown, false);
});

test('selection history decays and provides a continuity explanation', () => {
  const recent = {
    id: 'recent', title: '整理会议记录', category: 'adhoc', energy: 'medium',
    pickCount: 2, lastPickedAt: NOW - HOUR, createdAt: NOW
  };
  const old = { ...recent, id: 'old', lastPickedAt: NOW - 30 * DAY };
  const ranked = rankTasks([old, recent], 50, { now: NOW });
  assert.equal(ranked[0].id, 'recent');
  assert.ok(ranked[0].scoreBreakdown.recentSelection > ranked[1].scoreBreakdown.recentSelection);
  assert.match(ranked[0].reason, /减少切换成本/);
});

test('ranking is stable and does not mutate input', () => {
  const tasks = [
    { id: 'b', title: '任务 B', category: 'adhoc', energy: 'medium', suggestedMin: 25, createdAt: 2 },
    { id: 'a', title: '任务 A', category: 'adhoc', energy: 'medium', suggestedMin: 25, createdAt: 1 },
    { id: 'done', title: '已完成', done: true, createdAt: 0 }
  ];
  const snapshot = JSON.stringify(tasks);
  const first = rankTasks(tasks, 50, { now: NOW }).map(candidate => candidate.id);
  const second = rankTasks(tasks, 50, { now: NOW }).map(candidate => candidate.id);
  assert.deepEqual(first, ['a', 'b']);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(tasks), snapshot);
});

test('invalid deadlines and sparse legacy tasks do not break ranking', () => {
  const tasks = [
    { title: '旧任务' },
    { id: 'invalid-date', title: '回复消息', deadline: 'not-a-date', suggestedMin: -10 }
  ];
  const ranked = rankTasks(tasks, undefined, { now: NOW, limit: 20 });
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every(candidate => Number.isFinite(candidate.score)));
  assert.ok(ranked.every(candidate => candidate.recommendedStartMinutes >= 2));
});

test('expired adhoc tasks stay in triage unless explicitly requested', () => {
  const tasks = [
    { id: 'expired', title: '已到期闪念', category: 'adhoc', expired: true, energy: 'low', suggestedMin: 5 },
    { id: 'active', title: '当前小任务', category: 'adhoc', expired: false, energy: 'low', suggestedMin: 10 }
  ];

  assert.deepEqual(rankTasks(tasks, 20, { now: NOW }).map(item => item.id), ['active']);
  assert.deepEqual(
    rankTasks(tasks, 20, { now: NOW, includeExpired: true }).map(item => item.id).sort(),
    ['active', 'expired']
  );
});

test('future appointments stay out of recommendations until their local work slot arrives', () => {
  const tasks = [
    { id: 'scheduled', title: '下个工作时段再看', category: 'adhoc', scheduledFor: new Date(NOW + HOUR).toISOString() },
    { id: 'ready', title: '现在可做', category: 'adhoc' }
  ];
  assert.deepEqual(rankTasks(tasks, 50, { now: NOW }).map(item => item.id), ['ready']);
  assert.deepEqual(
    rankTasks(tasks, 50, { now: NOW, includeScheduled: true }).map(item => item.id).sort(),
    ['ready', 'scheduled']
  );
  assert.deepEqual(rankTasks(tasks, 50, { now: NOW + HOUR }).map(item => item.id).sort(), ['ready', 'scheduled']);
});

test('recommendTasks adds envelope while smartPickTask still returns a task', () => {
  const tasks = [
    { id: 'later', title: '设计', energy: 'high', category: 'adhoc', createdAt: 2 },
    { id: 'first', title: '发消息', energy: 'low', category: 'daily', createdAt: 1 }
  ];
  const recommendation = recommendTasks(tasks, 20, { now: NOW, limit: 2 });
  assert.equal(recommendation.candidates.length, 2);
  assert.equal(recommendation.topCandidate, recommendation.candidates[0]);
  assert.equal(smartPickTask(tasks, 20, { now: NOW }).id, recommendation.topCandidate.id);
  assert.equal(smartPickTask([], 50), null);
});
