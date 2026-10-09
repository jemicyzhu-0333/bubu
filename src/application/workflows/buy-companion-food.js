'use strict';

const companion = require('../../capabilities/companion');
const { runPostCommitEffect } = require('../../shared/post-commit-effects');

const BUY_COMPANION_FOOD_WRITES = Object.freeze(['pet']);

function createBuyCompanionFoodWorkflow({
  unitOfWork,
  clock,
  foods,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('buy-companion-food workflow requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') throw new TypeError('food shop requires a clock');
  if (!foods || typeof foods !== 'object' || Array.isArray(foods)) {
    throw new TypeError('buy-companion-food workflow requires a food catalog');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('buy-companion-food workflow effects must be functions');
  }

  function execute({ foodId, commandId, issuedAt, expectedRevision } = {}) {
    const now = clock.now();
    const transaction = unitOfWork.run({
      writes: BUY_COMPANION_FOOD_WRITES,
      expectedRevision,
      context: { now },
      transition: state => {
        const command = companion.foodCommand.prepareFoodCommand(state, { foodId, commandId, issuedAt, kind: 'buy', now });
        if (!command.ok) return command;
        if (command.replayed) return { ...command.result, replayed: true };
        const quote = companion.foodShop.quoteFood(foodId, foods);
        if (!quote.ok) return quote;
        if (!companion.foodShop.foodUnlocked(foodId, state.level || 1)) return { ok: false, reason: 'food-locked' };
        const spent = companion.foodShop.spendFoodTickets(state, quote.price);
        if (!spent.ok) return spent;
        const granted = companion.foodShop.grantFood(state, { foodId, foods });
        if (!granted.ok) return granted;
        const result = {
          ok: true,
          foodId,
          price: quote.price,
          foodTickets: spent.foodTickets,
          inventory: granted.inventory
        };
        companion.foodCommand.rememberFoodCommand(state, command, result);
        return result;
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    const response = {
      ok: true,
      changed: transaction.committed,
      replayed: transaction.replayed === true,
      foodId: transaction.foodId,
      price: transaction.price,
      foodTickets: transaction.foodTickets,
      inventory: transaction.inventory
    };
    if (transaction.committed) {
      runPostCommitEffect(publish, Object.freeze({
        type: 'companion-food-bought',
        ...response,
        revision: transaction.revision
      }), reportEffectError);
    }
    return response;
  }

  return Object.freeze({ execute });
}

module.exports = { BUY_COMPANION_FOOD_WRITES, createBuyCompanionFoodWorkflow };
