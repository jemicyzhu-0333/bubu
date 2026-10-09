'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STRATEGIES } = require('../src/content/strategies');
const { ENERGY_BANDS } = require('../src/application/queries/energy-compatibility');
const {
  validateStrategyManifest,
  selectStrategy,
  recordStrategyShown,
  recordStrategyFeedback
} = require('../src/core/strategy-registry');

const NOW = Date.parse('2026-09-01T09:00:00Z');

test('the reviewed strategy manifest is closed, bounded and behavior-backed', () => {
  const manifest = validateStrategyManifest(STRATEGIES);
  assert.equal(manifest.length, STRATEGIES.length);
  assert.ok(manifest.length >= 10);
  assert.throws(() => validateStrategyManifest([{ ...STRATEGIES[0], surprise: true }]), /exactly/);
  assert.throws(() => validateStrategyManifest([{ ...STRATEGIES[0], actionId: 'missing-action' }]), /actionId/);
  assert.throws(() => validateStrategyManifest([{ ...STRATEGIES[0], text: '这一定有效' }]), /prohibited/);
});

test('hard gates run before weighting while an explicit request remains available in DND', () => {
  const context = {
    phase: 'pre-start', explicitRequest: false, now: NOW, energyBand: 'medium',
    task: { blocker: 'too-big', estimateMinutes: 30, nextAction: '打开文件' },
    settings: { dnd: true, motionMode: 'balanced', stimulationMode: 'balanced' },
    rng: () => 0
  };
  assert.equal(selectStrategy(STRATEGIES, context).reason, 'dnd');
  const requested = selectStrategy(STRATEGIES, { ...context, explicitRequest: true });
  assert.ok(requested.strategy);
  assert.equal(requested.reason, null);

  const focused = selectStrategy(STRATEGIES, {
    ...context, explicitRequest: true, focusActive: true, settings: { dnd: false }, rng: () => 0
  });
  assert.ok(focused.strategy);
  assert.equal(focused.strategy.focusAllowed, true);
});

test('daily budget, cooldown, recent suppression and local feedback change selection', () => {
  const base = {
    phase: 'recovery', explicitRequest: false, now: NOW, energyBand: 'low',
    task: { blocker: 'interrupted', estimateMinutes: 20, nextAction: '继续第一句' },
    settings: {}, rng: () => 0
  };
  assert.equal(selectStrategy(STRATEGIES, base, { shownToday: 4 }).reason, 'daily-budget');

  const first = selectStrategy(STRATEGIES, base, { shownToday: 0 });
  assert.ok(first.strategy);
  const recent = selectStrategy(STRATEGIES, base, { shownToday: 0, recentIds: [first.strategy.id] });
  assert.ok(!recent.strategy || recent.strategy.id !== first.strategy.id);

  const shown = recordStrategyShown({}, first.strategy.id, NOW);
  assert.equal(shown[first.strategy.id].shownCount, 1);
  const rejected = recordStrategyFeedback(shown, first.strategy.id, false, NOW + 1);
  assert.equal(rejected[first.strategy.id].helpful, false);
  assert.equal(rejected[first.strategy.id].dismissedCount, 1);
  const next = selectStrategy(STRATEGIES, { ...base, explicitRequest: true, feedback: rejected }, {});
  assert.ok(!next.strategy || next.strategy.id !== first.strategy.id);
});

// 每日额度与两级冷却只在“我们主动推”时才该守：用户点了按钮就是要一条，拿额度把他挡回
// 去等于按钮坏了。这一条钉住的是 main.js 的省略——它只维护 recentIds，不记额度与冷却账
// 本，因为它唯一的调用形状是点击。若哪天这些判断改成对明确请求也生效，那边的账本是空
// 的，阶梯会静默失效；而按现在的条目数（多数 phase 只有两条且同族）真去守冷却，按钮会
// 在一次点击后空转十几分钟。
test('an explicit request reads only the recent window, never the unsolicited-cue ledger', () => {
  const base = {
    phase: 'recovery', explicitRequest: true, now: NOW, energyBand: 'low',
    task: { blocker: 'interrupted', estimateMinutes: 20, nextAction: '继续第一句' },
    settings: {}, rng: () => 0
  };
  const exhausted = { shownToday: 1000, dailyBudget: 1, lastShownAtById: {}, lastShownAtByFamily: {} };
  for (const strategy of validateStrategyManifest(STRATEGIES)) {
    exhausted.lastShownAtById[strategy.id] = NOW;
    exhausted.lastShownAtByFamily[strategy.familyId] = NOW;
  }
  const picked = selectStrategy(STRATEGIES, base, exhausted);
  assert.ok(picked.strategy, '额度耗尽且每一条都在冷却里，明确请求仍然要给得出来');

  // 最近窗口两条路都读：它防的是“刚看过的又来一遍”，与谁发起无关。
  const again = selectStrategy(STRATEGIES, base, { recentIds: [picked.strategy.id] });
  assert.ok(!again.strategy || again.strategy.id !== picked.strategy.id);
});

test('an unrecognized energy band is reported instead of being read as medium', () => {
  const context = {
    phase: 'pre-start', explicitRequest: true, now: NOW,
    task: { blocker: 'too-big', estimateMinutes: 30, nextAction: '打开文件' },
    settings: {}, rng: () => 0
  };
  // Silently substituting 'medium' handed the user strategies whose declared bands
  // never matched their state, with nothing anywhere saying so. The caller has to
  // hear about it the same way an unknown phase is reported.
  for (const band of ['HIGH', 'excellent', 'auto', '', null, undefined]) {
    const rejectedBand = selectStrategy(STRATEGIES, { ...context, energyBand: band });
    assert.equal(rejectedBand.strategy, null, `band ${JSON.stringify(band)} must not select`);
    assert.equal(rejectedBand.reason, 'invalid-energy-band');
  }
  assert.ok(selectStrategy(STRATEGIES, { ...context, energyBand: 'medium' }).strategy);
});

test('the strategy manifest and the energy engine agree on the band vocabulary', () => {
  // Core strategy rules cannot import the guidance capability's energy policies.
  // This assertion keeps the two public vocabularies from drifting apart.
  assert.deepEqual([...ENERGY_BANDS].sort(), ['high', 'low', 'medium']);
  for (const strategy of validateStrategyManifest(STRATEGIES)) {
    for (const band of strategy.triggers.energyBands) {
      assert.ok(ENERGY_BANDS.includes(band), `strategy ${strategy.id} declares unknown band ${band}`);
    }
  }
});
