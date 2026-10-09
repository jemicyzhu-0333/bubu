'use strict';
const { appetiteLabel } = require('../../../content/food-rituals.mjs');

const {
  normalizeCompanionState,
  relationshipStage,
  RELATIONSHIP_STAGES,
  relationshipFor
} = require('../../../core/companion-state');

const { projectJourney, projectTastes } = require('./journey');

const BOND_STAGES = Object.freeze([
  Object.freeze({ ...RELATIONSHIP_STAGES[0], label: '刚认识' }),
  Object.freeze({ ...RELATIONSHIP_STAGES[1], label: '慢慢熟了' }),
  Object.freeze({ ...RELATIONSHIP_STAGES[2], label: '熟悉了' }),
  Object.freeze({ ...RELATIONSHIP_STAGES[3], label: '很信任' })
]);

const MILESTONE_LABELS = Object.freeze({
  'bond-warming': '和它慢慢熟了',
  'bond-familiar': '成了熟悉的伙伴',
  'bond-trusted': '它很信任你了'
});

function requireTimestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('companion projection requires a finite timestamp');
  }
  return value;
}

function bondStageLabel(stage) {
  const found = BOND_STAGES.find(entry => entry.stage === stage);
  return found ? found.label : BOND_STAGES[0].label;
}

function milestoneHint(id) {
  const entry = BOND_STAGES.find(stage => `bond-${stage.stage}` === id);
  return entry ? `${entry.min} 点` : '';
}

function topFoodAffinity(affinity, foods, limit) {
  return Object.entries(affinity || {})
    .filter(([id]) => id !== 'basic' && foods && foods[id])
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id, count]) => ({
      id,
      count,
      name: foods[id].name,
      emoji: foods[id].emoji
    }));
}

function buildRelationshipProjection({ pet, companion, foods, now, currentSkin = 'pink', topFoods = 3 } = {}) {
  const projectedAt = requireTimestamp(now);
  const normalized = normalizeCompanionState(companion);
  const relationship = relationshipFor(normalized, currentSkin);
  const bondPoints = relationship.bondPoints;
  const stage = relationshipStage(bondPoints);
  const index = Math.max(0, BOND_STAGES.findIndex(entry => entry.stage === stage));
  const current = BOND_STAGES[index];
  const next = BOND_STAGES[index + 1] || null;
  const span = next ? next.min - current.min : 0;
  const gained = bondPoints - current.min;
  return {
    satiation: pet && pet.satiation,
    appetiteLabel: appetiteLabel(pet?.satiation ?? 65),
    totalFeeds: (pet && pet.totalFeeds) || 0,
    bond: {
      points: bondPoints,
      stage,
      label: current.label,
      nextLabel: next ? next.label : null,
      toNext: next ? Math.max(0, next.min - bondPoints) : 0,
      percent: next && span > 0 ? Math.min(100, Math.round((gained / span) * 100)) : 100
    },
    daysTogether: relationship.firstMetAt === null
      ? 0
      : Math.max(1, Math.floor((projectedAt - relationship.firstMetAt) / 86_400_000) + 1),
    journey: projectJourney(relationship),
    bondRoadmap: BOND_STAGES.slice(1).map(item => ({ id: `bond-${item.stage}`, label: item.label, points: item.min,
      unlocked: bondPoints >= item.min, remaining: Math.max(0, item.min - bondPoints) })),
    tastes: projectTastes(relationship.foodAffinity, foods),
    foodAffinity: topFoodAffinity(relationship.foodAffinity, foods, topFoods),
    milestones: relationship.milestones.filter(id => !id.startsWith('journey-')).map(id => ({
      id,
      label: MILESTONE_LABELS[id] || id,
      hint: milestoneHint(id)
    }))
  };
}

module.exports = {
  BOND_STAGES,
  MILESTONE_LABELS,
  bondStageLabel,
  buildRelationshipProjection
};
