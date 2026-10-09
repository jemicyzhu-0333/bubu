'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRelationshipProjection, BOND_STAGES } = require('../src/capabilities/companion').relationshipProjection;
const { normalizeCompanionState } = require('../src/core/companion-state');
const withDango = relationship => normalizeCompanionState({ relationships: { dango: relationship } });

test('relationship projection is pure, role-specific, deterministic and bounded', () => {
  const companion = withDango({ firstMetAt: 0, bondPoints: 26,
    foodAffinity: { fish: 9, cake: 5, milk: 5, unknown: 100 }, milestones: ['bond-warming'] });
  const before = structuredClone(companion);
  const options = { pet: { satiation: 60, totalFeeds: 4 }, companion, foods: {
    fish: { name: '鱼', emoji: '🐟' }, cake: { name: '蛋糕', emoji: '🍰' }, milk: { name: '牛奶', emoji: '🥛' }
  }, now: 3 * 86400000 };
  const projection = buildRelationshipProjection(options);
  assert.equal(projection.bond.stage, 'warming'); assert.equal(projection.bond.toNext, 14); assert.equal(projection.bond.percent, 50);
  assert.equal(projection.daysTogether, 4); assert.deepEqual(projection.foodAffinity.map(item => item.id), ['fish','cake','milk']);
  assert.deepEqual(projection.milestones, [{ id: 'bond-warming', label: '和它慢慢熟了', hint: '12 点' }]);
  assert.deepEqual(companion, before); assert.deepEqual(BOND_STAGES.map(entry => entry.min), [0,12,40,100]);
  assert.equal(buildRelationshipProjection({ ...options, currentSkin: 'usagi' }).bond.points, 0);
});
test('max relationship has no negative distance or overflow percent', () => {
  const projection = buildRelationshipProjection({ pet: {}, companion: withDango({ bondPoints: 10000 }), foods: {}, now: 100 });
  assert.equal(projection.bond.stage, 'trusted'); assert.equal(projection.bond.nextLabel, null);
  assert.equal(projection.bond.toNext, 0); assert.equal(projection.bond.percent, 100);
});
test('journey rewards persist once earned and survive absence without a streak', () => {
  const { applyBondToState } = require('../src/capabilities/companion/domain/completion-benefits');
  const state = { companion: withDango({ firstMetAt: 1, foodAffinity: { fish: 1 }, counters: { 'task-complete': 1 } }) };
  applyBondToState(state, { points: 0, counterId: 'focus-complete', at: 100 });
  const project = now => buildRelationshipProjection({ companion: state.companion, foods: { fish: { name: '小鱼', emoji: '🐟' } }, now });
  assert.equal(project(100).journey.earned, 2); assert.ok(state.companion.relationships.dango.milestones.includes('journey-first-light'));
  assert.equal(project(365 * 86400000).journey.earned, 2); assert.equal(project(100).journey.chapters[2].letter, null);
  assert.ok(project(100).journey.chapters[1].letter); const count = state.companion.relationships.dango.milestones.length;
  applyBondToState(state, { points: 0, at: 101 }); assert.equal(state.companion.relationships.dango.milestones.length, count);
});
test('tasting tiers require actual food while chapters combine task, focus and variety facts', () => {
  const companion = withDango({ foodAffinity: { fish: 8, cake: 3 }, counters: { 'task-complete': 10, 'focus-complete': 12 } });
  const projection = buildRelationshipProjection({ companion, foods: {
    fish: { name: '小鱼' }, cake: { name: '蛋糕' }, milk: { name: '牛奶' }, basic: { name: '基础餐' }
  }, now: 100 });
  assert.deepEqual(projection.tastes.map(t => t.label), ['常备点心','熟悉的味道','未尝过']);
  assert.equal(projection.journey.earned, 3); assert.equal(projection.journey.next.id, 'rain-window');
  assert.equal(projection.journey.next.requirements.find(r => r.id === 'tastes').current, 2);
  assert.equal(projection.tastes.some(t => t.id === 'basic'), false);
});
