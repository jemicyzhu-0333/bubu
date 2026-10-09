'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { completionBenefits, skinProjection } = require('../src/capabilities/companion');
const { SKINS } = require('../src/skins.mjs');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

// count 个不同的日子（都在同一个月里），每天完成过 1 件事。
function usedDays(count) {
  return Object.fromEntries(Array.from({ length: count }, (_unused, index) => [`2026-09-${String(index + 1).padStart(2, '0')}`, 1]));
}

test('all skin thresholds use their owning metric and unlock idempotently inside the reward draft', () => {
  for (const [skin, rule] of Object.entries(completionBenefits.SKIN_UNLOCK_RULES)) {
    const state = { unlockedSkins: ['pink'], level: 1, stats: {} };
    const setMetric = value => {
      if (rule.metric === 'level') state.level = value;
      // 最近一个月里用过的天数不是一个存下来的数，是从每日统计里数出来的：要几天，就铺几天。
      else if (rule.metric === 'activeDays30') state.stats.dailyCompletions = usedDays(value);
      else state.stats[rule.metric] = value;
    };
    setMetric(rule.target - 1);
    assert.equal(completionBenefits.unlockEligibleSkins(state).includes(skin), false);
    setMetric(rule.target);
    assert.equal(completionBenefits.unlockEligibleSkins(state).includes(skin), true);
    assert.deepEqual(completionBenefits.unlockEligibleSkins(state), []);
    assert.equal(state.unlockedSkins.filter(id => id === skin).length, 1);
  }
});

test('the bundled long-eared form has no unlock progress and survives a canonical role-state round trip', () => {
  const now = 1_700_000_000_000;
  const state = normalizePersistedState({}, { now });
  assert.deepEqual(state.unlockedSkins, ['pink']);
  assert.equal(Object.hasOwn(completionBenefits.SKIN_UNLOCK_RULES, 'usagi'), false);
  assert.deepEqual(Object.keys(SKINS).sort(),
    [...Object.keys(completionBenefits.SKIN_UNLOCK_RULES), 'pink', 'usagi'].sort());
  const form = skinProjection.projectSkins(state, SKINS).find(skin => skin.id === 'usagi');
  assert.equal(form.unlocked, true);
  assert.equal(form.progress, null);
  assert.equal(form.formId, 'usagi');
  assert.equal(form.formName, '乌沙奇 2.0');
  assert.equal(form.unlockLevel, 1);
  const pink = skinProjection.projectSkins(state, SKINS).find(skin => skin.id === 'pink');
  assert.equal(pink.formId, 'dango');
  for (const [id, rule] of Object.entries(completionBenefits.SKIN_UNLOCK_RULES)) {
    const projected = skinProjection.projectSkins(state, SKINS).find(skin => skin.id === id);
    assert.equal(projected.unlockLevel, rule.target);
    assert.equal(projected.unlockDesc, `Lv.${rule.target} 解锁`);
  }

  const chosen = { ...state, currentSkin: 'usagi' };
  assert.deepEqual(normalizePersistedState(chosen, { now }), chosen);
  assert.deepEqual(chosen.unlockedSkins, ['pink'], 'a free form does not require a migration or extra unlock write');
});

test('flame, moon and bat unlock permanently at levels four, six and eight', () => {
  for (const [id, level] of [['flame', 4], ['moon', 6], ['bat', 8]]) {
    assert.deepEqual(completionBenefits.SKIN_UNLOCK_RULES[id], { metric: 'level', target: level });
    const state = { level: level - 1, unlockedSkins: ['pink'], stats: { dailyCompletions: usedDays(30) } };
    assert.equal(completionBenefits.unlockEligibleSkins(state).includes(id), false);
    state.level = level;
    assert.equal(completionBenefits.unlockEligibleSkins(state).includes(id), true);
    state.level = 1; state.stats = {};
    assert.equal(completionBenefits.unlockEligibleSkins(state).includes(id), false);
    assert.equal(state.unlockedSkins.includes(id), true);
  }
});
