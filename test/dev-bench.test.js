'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCENARIOS, buildScenario } = require('../tools/dev-bench/scenarios');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { seriesRefresh } = require('../src/capabilities/work');
const { completionBenefits } = require('../src/capabilities/companion');
const { activeDaysInWindow } = require('../src/core/active-days');
const { localDayKey } = require('../src/core/calendar');
const now = new Date(2026, 8, 12, 12).getTime();

test('every isolated bench scenario round-trips the production schema exactly', () => {
  for (const scenario of SCENARIOS) {
    const fixture = buildScenario(scenario, now);
    assert.deepEqual(normalizePersistedState(fixture, { now }), fixture);
    assert.equal(fixture.settings.autoCheckUpdates, false);
    assert.equal(fixture.settings.aiBreakdownEnabled, false);
    assert.equal(fixture.settings.aiPetMealsEnabled, false);
  }
  assert.throws(() => buildScenario('unknown', now), /unknown/);
});

test('the bench reproduces hunger, a level-based flame boundary, long list and catch-up without user data', () => {
  const state = buildScenario('all', now);
  assert.equal(state.pet.satiation, 15);
  assert.equal(activeDaysInWindow(state.stats, localDayKey(now)), 30, 'the heatmap scenario fills the whole month');
  const near = buildScenario('flame-near', now);
  assert.equal(activeDaysInWindow(near.stats, localDayKey(now)), 0);
  assert.deepEqual(completionBenefits.skinUnlockProgress(near).flame, { current: 3, target: 4 });
  assert.equal(near.xp, 60);
  assert.ok(near.tasks.find(task => task.id === near.nowTaskId).steps.length > 0);
  assert.equal('streak' in near, false);
  assert.equal(state.tasks.length, 13);
  assert.equal(Object.keys(state.stats.dailyFocus).length, 30);
  const result = seriesRefresh.refreshSeriesOccurrences(state, { now, today: '2026-09-12' }, { createId: () => 'unused' });
  assert.equal(result.rolledTaskIds.length, 1);
  assert.equal(state.tasks[0].occurrenceDate, '2026-09-12');
});

test('form bench shows the bundled pet and complete outfit on a fresh level-one profile', () => {
  const state = buildScenario('form-usagi', now);
  assert.equal(state.currentSkin, 'usagi');
  assert.equal(state.level, 1);
  assert.deepEqual(state.unlockedSkins, ['pink']);
  const selection = require('../src/capabilities/companion').appearanceSelection.selectAppearance({
    items: require('../src/content/appearance.mjs').PET_APPEARANCE_ITEMS,
    level: state.level, unlockedSkins: state.unlockedSkins,
    currentSkin: state.currentSkin, equipped: state.companion.appearance.equipped
  });
  assert.deepEqual(selection.worn.map(item => item.id).sort(),
    ['usagi.ear-bow', 'usagi.star-collar', 'usagi.travel-cape'].sort());
});

test('bench entry stays unshipped', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.every(pattern => !pattern.startsWith('tools')));
});
