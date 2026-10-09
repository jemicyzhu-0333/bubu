'use strict';

const { foodRitual } = require('../../content/food-rituals.mjs');
const companion = require('../../capabilities/companion');
const progress = require('../../capabilities/progress');
const { basicMealAvailability } = require('../queries/companion-feed-state');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const FEED_COMPANION_WRITES = Object.freeze([
  'pet',
  'companion',
  'rewardLedger'
]);

function reactionFor(food, random) {
  const reactions = Array.isArray(food && food.reactions) ? food.reactions : [];
  if (!reactions.length) return null;
  let value = 0;
  try {
    value = random();
  } catch {
    value = 0;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) value = 0;
  return reactions[Math.floor(value * reactions.length)] || reactions[0];
}

function createFeedCompanionWorkflow({
  unitOfWork,
  clock,
  foods,
  random = () => 0,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('feed-companion workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('feed-companion workflow requires a clock');
  }
  if (!foods || typeof foods !== 'object' || Array.isArray(foods)) {
    throw new TypeError('feed-companion workflow requires a food catalog');
  }
  if (typeof random !== 'function' || typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('feed-companion workflow ports must be functions');
  }

  function execute({ foodId, commandId, issuedAt, expectedRevision } = {}) {
    const fedAt = clock.now();
    const reaction = reactionFor({ reactions: foodRitual(foodId).lines }, random);
    const transaction = unitOfWork.run({
      writes: FEED_COMPANION_WRITES,
      expectedRevision,
      context: { now: fedAt },
      transition: state => {
        const command = companion.foodCommand.prepareFoodCommand(state, { foodId, commandId, issuedAt, kind: 'feed', now: fedAt });
        if (!command.ok) return command;
        if (command.replayed) return { ...command.result, replayed: true };
        const basic = basicMealAvailability(state, fedAt);
        if (foodId === 'basic' && !basic.eligible) return { ok: false, reason: basic.reason };
        const prepared = companion.feeding.prepareFeed(state, {
          foodId,
          food: foods[foodId],
          now: fedAt,
          dayKey: basic.dayKey
        });
        if (!prepared.ok) return prepared;

        if (foodId === 'basic') {
          const claim = progress.basicMeals.claimBasicMeal(state, { dayKey: basic.dayKey, at: fedAt });
          if (!claim.ok) return claim;
        }
        const bond = foodId === 'basic' ? null : companion.completionBenefits.applyBondToState(state, {
          points: companion.completionBenefits.BOND_POINTS.feed,
          counterId: 'feed',
          foodId: foodId === 'basic' ? null : foodId,
          at: fedAt
        });
        const result = {
          ok: true,
          foodId,
          bond,
          gainedXp: 0,
          satiation: prepared.satiation,
          totalFeeds: prepared.totalFeeds,
          favorite: prepared.favorite,
          animation: prepared.favorite ? 'favorite' : foods[foodId].animation,
          reaction: prepared.favorite ? foodRitual(foodId).favoriteLine : reaction
        };
        companion.foodCommand.rememberFoodCommand(state, command, result);
        return result;
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };

    const response = {
      ok: true,
      replayed: transaction.replayed === true,
      rejected: false,
      foodId: transaction.foodId,
      gainedXp: transaction.gainedXp,
      xpCapped: false,
      satiation: transaction.satiation,
      totalFeeds: transaction.totalFeeds,
      favorite: transaction.favorite,
      reaction: transaction.reaction,
      animation: transaction.animation
    };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'companion-fed',
        foodId: transaction.foodId,
        bond: transaction.bond,
        gainedXp: transaction.gainedXp,
        satiation: transaction.satiation,
        totalFeeds: transaction.totalFeeds,
        fedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { FEED_COMPANION_WRITES, createFeedCompanionWorkflow };
