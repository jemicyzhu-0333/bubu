'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const demand = require('../src/capabilities/guidance/domain/task-demand');
const estimate = require('../src/capabilities/guidance/domain/energy-estimate');
const ranking = require('../src/capabilities/guidance/domain/task-ranking');
const availability = require('../src/capabilities/work/domain/task-availability');
const { projectRecommendations } = require('../src/capabilities/guidance/domain/recommendations');
const { projectRecommendations: projectPublicRecommendations } = require('../src/capabilities/guidance/application/recommendations');

const NOW = new Date(2026, 7, 28, 11).getTime();
const task = (id, extra = {}) => ({ id, title: '打开文件', createdAt: 1, energy: 'low', estimateMinutes: 10, ...extra });
const neverClock = () => { throw new Error('unexpected clock sample'); };
const ports = { parsedTimestamp: availability.parsedTimestamp, readNow: neverClock };

test('task demand retains keyword inference duration parsing and fallback order', () => {
  assert.equal(demand.inferEnergy('设计新的支付架构'), 'high');
  assert.equal(demand.inferEnergy('发邮件'), 'low');
  assert.equal(demand.inferEnergy(undefined), 'medium');
  assert.equal(demand.suggestDuration('研究 2 小时', 'high'), 120);
  assert.equal(demand.suggestDuration('做 999 分钟', 'low'), 480);
  assert.equal(demand.suggestDuration('', 'unknown'), 25);
  assert.equal(demand.estimatedMinutes({ estimateMinutes: '', estimatedMin: '12', suggestedMin: 30 }), 12);
  assert.equal(demand.estimatedMinutes({ estimateMinutes: null, suggestedMin: 45 }), 45);
  assert.equal(demand.taskEnergyBand({ title: '设计架构', energy: 'typo' }), 'high');
  assert.equal(Object.isFrozen(demand.ENERGY_BANDS), true);
});

test('explicit finite timestamps never call the injected clock', () => {
  const energy = estimate.currentEnergyEstimate({ now: NOW }, neverClock);
  assert.equal(typeof energy.level, 'number');
  assert.equal(ranking.scoreTask(task('a'), 50, { now: NOW }, neverClock).id, 'a');
  assert.equal(ranking.rankTasks([task('a')], 50, { now: NOW }, ports).length, 1);
  assert.equal(ranking.recommendTasks([task('a')], 50, { now: NOW }, ports).generatedAt, NOW);
  assert.equal(ranking.smartPickTask([task('a')], 50, { now: NOW }, ports).id, 'a');
});

test('missing or invalid time uses only the explicit clock port', () => {
  for (const now of [undefined, 'bad', NaN, Infinity]) {
    let reads = 0;
    const readNow = () => { reads++; return NOW; };
    const result = estimate.currentEnergyEstimate({ now }, readNow);
    assert.equal(reads, 1);
    assert.deepEqual(result, estimate.currentEnergyEstimate({ now: NOW }, neverClock));
  }
  let reads = 0;
  estimate.currentEnergyLevel({}, {}, {}, null, () => { reads++; return NOW; });
  assert.equal(reads, 1);
});

test('coercible null time stays epoch zero rather than sampling a clock', () => {
  assert.deepEqual(estimate.currentEnergyEstimate({ now: null }, neverClock), estimate.currentEnergyEstimate({ now: 0 }, neverClock));
  assert.equal(ranking.recommendTasks([], 50, { now: null }, ports).generatedAt, 0);
});

test('recommendations retain separate rank and generatedAt fallback samples', () => {
  const seen = [];
  const readNow = () => { const value = NOW + seen.length; seen.push(value); return value; };
  const result = ranking.recommendTasks([task('a')], 50, {}, { parsedTimestamp: availability.parsedTimestamp, readNow });
  assert.deepEqual(seen, [NOW, NOW + 1]);
  assert.equal(result.generatedAt, NOW + 1);
});

test('rank forwards fallback clock when its first supplied sample is invalid', () => {
  let reads = 0;
  const readNow = () => ++reads === 1 ? NaN : NOW;
  const ranked = ranking.rankTasks([task('a')], 50, {}, { parsedTimestamp: availability.parsedTimestamp, readNow });
  assert.equal(reads, 2);
  assert.equal(ranked[0].id, 'a');
});

test('curve level remains authoritative and check-in metadata preserves invalid Date behavior', () => {
  const value = estimate.currentEnergyEstimate({ now: NOW, curveLevel: 62.4,
    energyCheckIn: { level: 20, timestamp: NOW }, stats: { dailyFocus: {} } }, neverClock);
  assert.equal(value.level, 62);
  assert.equal(value.prior, 62);
  assert.equal(value.activityAdjustment, 0);
  assert.equal(value.source, 'check-in');
  const invalid = estimate.normalizeEnergyCheckIn({ level: 50, timestamp: new Date(NaN) });
  assert.equal(Number.isNaN(invalid.timestamp), true);
  assert.equal(availability.parsedTimestamp(new Date(NaN)), null);
});

test('legacy ranking expiry flags remain distinct from authoritative startability', () => {
  const expiredWithoutDate = task('expired', { expired: true });
  assert.equal(availability.taskStartBlockReason(expiredWithoutDate, NOW), null);
  assert.deepEqual(ranking.rankTasks([expiredWithoutDate], 50, { now: NOW }, ports), []);
  assert.equal(ranking.rankTasks([expiredWithoutDate], 50, { now: NOW, includeExpired: true }, ports)[0].task, expiredWithoutDate);
});

test('ranking keeps stable ties original identity and input immutability', () => {
  const first = Object.freeze(task('a'));
  const second = Object.freeze(task('b'));
  const source = Object.freeze([second, first]);
  const ranked = ranking.rankTasks(source, 50, { now: NOW }, ports);
  assert.deepEqual(ranked.map(item => item.id), ['a', 'b']);
  assert.equal(ranked[0].task, first);
  assert.equal(ranking.smartPickTask(source, 50, { now: NOW }, ports), first);
  assert.equal(source[0], second);
});

test('work expiry parser remains injected and is sampled with original short-circuit order', () => {
  const values = [];
  const expiresAt = NOW + 1;
  const parsedTimestamp = value => { values.push(value); return availability.parsedTimestamp(value); };
  assert.equal(ranking.rankTasks([task('a', { expiresAt })], 50, { now: NOW }, { parsedTimestamp, readNow: neverClock }).length, 1);
  assert.deepEqual(values, [expiresAt, expiresAt]);
});

test('domain recommendation projector preserves supplied now and independent fallback reads', () => {
  const input = { state: { tasks: [task('a'), task('b')], stats: {}, nowTaskId: 'b' }, settings: {}, pomodoro: null };
  const observed = []; let reads = 0;
  const result = projectRecommendations(input, (_, now) => { observed.push(now); return null; }, () => NOW + reads++);
  assert.equal(reads, 3);
  assert.deepEqual(observed, [undefined, undefined]);
  assert.equal(result.generatedAt, undefined);
  assert.equal(result.nowCandidate.id, 'b');
});

test('public recommendation adapter preserves two arguments and resolves wall clock lazily', () => {
  const original = Date.now;
  let reads = 0;
  try {
    Date.now = () => { reads++; return NOW; };
    const input = { state: { tasks: [task('a')], stats: {} }, settings: {}, pomodoro: null };
    assert.equal(projectPublicRecommendations.length, 2);
    projectPublicRecommendations(input, () => null);
    assert.equal(reads, 2);
    Date.now = () => { throw new Error('finite time must not read clock'); };
    assert.equal(projectPublicRecommendations({ ...input, now: NOW }, availability.taskStartBlockReason).generatedAt, NOW);
  } finally { Date.now = original; }
});
