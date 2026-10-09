'use strict';
const { FOOD_LEVELS, FOOD_ORDER, favoriteFood, foodUnlocked } = require('../../../content/food-progression.mjs');
const { FOOD_ECONOMY } = require('../../../content/growth-policy.mjs');
const { compareDayKeys } = require('../../../core/calendar');

const FOOD_PRICES = Object.freeze({
  berry: 1,
  carrot: 1,
  rice: 2,
  milk: 2,
  fish: 2,
  bone: 2,
  donut: 3,
  coffee: 3,
  mushroom: 3,
  cake: 4
});

const SHOP_ORDER = Object.freeze(FOOD_ORDER.filter(id => id !== 'basic'));
const MAX_INVENTORY_PER_FOOD = FOOD_ECONOMY.inventoryLimit;

function spendFoodTickets(state, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1) return { ok: false, reason: 'food-price-invalid' };
  const tickets = state?.pet?.foodTickets;
  if (!Number.isSafeInteger(tickets) || tickets < amount) return { ok: false, reason: 'insufficient-food-tickets' };
  state.pet = { ...state.pet, foodTickets: tickets - amount };
  return { ok: true, foodTickets: state.pet.foodTickets };
}

function grantDailyFoodTickets(state, dayKey) {
  compareDayKeys(dayKey, dayKey);
  const pet = state.pet;
  if (!pet || !Number.isSafeInteger(pet.foodTickets) || pet.foodTickets < 0) throw new TypeError('invalid-food-wallet');
  if (pet.lastTicketDay && dayKey <= pet.lastTicketDay) return { granted: false, foodTickets: pet.foodTickets };
  if (pet.foodTickets > Number.MAX_SAFE_INTEGER - FOOD_ECONOMY.dailyTickets) throw new RangeError('food-wallet-capacity');
  state.pet = { ...pet, foodTickets: pet.foodTickets + FOOD_ECONOMY.dailyTickets, lastTicketDay: dayKey };
  return { granted: true, foodTickets: state.pet.foodTickets };
}

function quoteFood(foodId, foods) {
  const price = FOOD_PRICES[foodId];
  const food = foods && foods[foodId];
  if (!Number.isInteger(price) || !food || food.id !== foodId) {
    return { ok: false, reason: 'unknown-food' };
  }
  return { ok: true, foodId, price, food };
}

function grantFood(state, { foodId, foods, amount = 1 } = {}) {
  if (!Number.isInteger(FOOD_PRICES[foodId])
      || (foods !== undefined && (!foods || !foods[foodId] || foods[foodId].id !== foodId))) {
    return { ok: false, reason: 'unknown-food' };
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    return { ok: false, reason: 'food-amount-invalid' };
  }
  if (!state || !state.pet || typeof state.pet !== 'object') {
    throw new TypeError('food grant requires canonical pet state');
  }
  const inventory = { ...(state.pet.foodInventory || {}) };
  const current = inventory[foodId];
  if (!Number.isSafeInteger(current) || current < 0) throw new TypeError('invalid-food-inventory');
  if (current > MAX_INVENTORY_PER_FOOD - amount) {
    return { ok: false, reason: 'food-inventory-full' };
  }
  inventory[foodId] = current + amount;
  state.pet = { ...state.pet, foodInventory: inventory };
  return { ok: true, foodId, amount, inventory: inventory[foodId] };
}

function projectFoodShop({ foods, inventory, foodTickets = 0, level = 1, currentSkin = 'pink', affinity = {} } = {}) {
  const availableTickets = Number.isSafeInteger(foodTickets) && foodTickets >= 0 ? foodTickets : 0;
  return {
    foodTickets: availableTickets,
    items: SHOP_ORDER.flatMap(foodId => {
      const quote = quoteFood(foodId, foods);
      if (!quote.ok) return [];
      return [{
        id: foodId,
        level: FOOD_LEVELS[foodId],
        unlocked: foodUnlocked(foodId, level),
        favorite: foodId === favoriteFood(currentSkin),
        tasted: affinity[foodId] || 0,
        name: quote.food.name,
        emoji: quote.food.emoji,
        satiation: Number(quote.food.satiation) || 0,
        price: quote.price,
        inventory: Math.max(0, Math.floor(Number(inventory && inventory[foodId]) || 0)),
        affordable: foodUnlocked(foodId, level) && availableTickets >= quote.price
      }];
    })
  };
}

module.exports = {
  FOOD_PRICES,
  SHOP_ORDER,
  MAX_INVENTORY_PER_FOOD,
  quoteFood,
  foodUnlocked,
  grantFood,
  spendFoodTickets,
  grantDailyFoodTickets,
  projectFoodShop
};
