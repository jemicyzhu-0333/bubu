'use strict';

const {
  normalizeCompanionState,
  relationshipStage,
  incrementRelationship,
  addMilestone,
  companionRole
} = require('../../../core/companion-state');
const { grantDailyFoodTickets } = require('./food-shop');
const { localDayKey, compareDayKeys } = require('../../../core/calendar');

const { projectJourney } = require('./journey');

const BOND_POINTS = Object.freeze({
  feed: 1,
  taskComplete: 0,
  focusComplete: 0,
  interaction: 1
});
const SKIN_UNLOCK_RULES = Object.freeze(Object.fromEntries(Object.entries({
  forest: 3, ocean: 5, sakura: 7, flame: 4, moon: 6, bat: 8, crown: 10, robot: 10, woodsman: 7
}).map(([id, target]) => [id, Object.freeze({ metric: 'level', target })])));

function applyBondToState(state, { points = 0, counterId = null, foodId = null, at, kind = 'care', dayKey = null } = {}) {
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError('invalid-bond-time');
  const before = normalizeCompanionState(state.companion);
  const role = companionRole(state.currentSkin);
  const beforeStage = relationshipStage(before.relationships[role].bondPoints);
  const day = dayKey ?? localDayKey(at);
  compareDayKeys(day, day);
  if (!before.bondDay || day > before.bondDay) {
    before.bondDay = day;
    before.bondClaims = { advance: false, close: false, care: false };
  }
  if (!['advance', 'close', 'care'].includes(kind)) throw new TypeError('invalid-bond-event');
  const granted = day === before.bondDay && points > 0 && !before.bondClaims[kind] ? (kind === 'advance' ? 2 : 1) : 0;
  if (granted) before.bondClaims[kind] = true;
  let next = incrementRelationship(before, { points: granted, counterId, foodId, at, role });
  const relationship = next.relationships[role];
  const afterStage = relationshipStage(relationship.bondPoints);
  const stageChanged = afterStage !== beforeStage;
  if (stageChanged) next = addMilestone(next, `bond-${afterStage}`, role);
  for (const chapter of projectJourney(relationship).chapters) {
    if (chapter.unlocked) next = addMilestone(next, `journey-${chapter.id}`, role);
  }
  state.companion = next;
  return { stage: afterStage, stageChanged, bondPoints: relationship.bondPoints, granted, role };
}

function applyGrowthBenefits(state, { reward, now } = {}) {
  const firstAdvance = reward?.firstAdvance === true;
  const closeGranted = reward?.closeGranted === true;
  if (!firstAdvance && !closeGranted) return { foodDrop: null, bond: null, ticketsGranted: false };
  const tickets = firstAdvance ? grantDailyFoodTickets(state, reward.event.dateKey) : { granted: false };
  let bond = null;
  if (firstAdvance) bond = applyBondToState(state, { points: 2, kind: 'advance', at: now, dayKey: reward.event.dateKey });
  if (closeGranted) bond = applyBondToState(state, { points: 1, kind: 'close', at: now, dayKey: reward.event.dateKey });
  return { foodDrop: null, bond, ticketsGranted: tickets.granted };
}

function skinUnlockProgress(state, at = null) {
  return Object.fromEntries(Object.entries(SKIN_UNLOCK_RULES).map(([id, rule]) => [
    id,
    { current: state.level, target: rule.target }
  ]));
}

function unlockEligibleSkins(state, { now = null } = {}) {
  const unlocked = new Set(Array.isArray(state.unlockedSkins) ? state.unlockedSkins : []);
  const newlyUnlocked = [];
  for (const [id, progress] of Object.entries(skinUnlockProgress(state, now))) {
    if (progress.current < progress.target || unlocked.has(id)) continue;
    unlocked.add(id);
    newlyUnlocked.push(id);
  }
  if (newlyUnlocked.length) state.unlockedSkins = [...unlocked];
  return newlyUnlocked;
}

function applyTaskCompletionBenefits(state, { now } = {}) {
  const bond = applyBondToState(state, { points: 0, counterId: 'task-complete', at: now });
  return { foodDrop: null, bond };
}

function applyFocusCompletionBenefits(state, { now } = {}) {
  const bond = applyBondToState(state, {
    points: BOND_POINTS.focusComplete,
    counterId: 'focus-complete',
    at: now
  });
  return { foodDrop: null, bond };
}

module.exports = {
  BOND_POINTS,
  SKIN_UNLOCK_RULES,
  applyBondToState,
  applyGrowthBenefits,
  skinUnlockProgress,
  unlockEligibleSkins,
  applyTaskCompletionBenefits,
  applyFocusCompletionBenefits
};
