const GROWTH = Object.freeze({ firstAdvance: 20, unit: 10, unitsPerDay: 3, close: 10, dailyMax: 60 });
const FOOD_ECONOMY = Object.freeze({ initialTickets: 6, dailyTickets: 3, inventoryLimit: 999 });
const BASIC_MEAL = Object.freeze({ dailyLimit: 3, hungryAt: 45, baseline: 55 });
function levelCost(level) {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError('invalid-growth-level');
  return Math.min(30 * level, 450);
}
function lifetimeXp(level, xp = 0) {
  levelCost(level);
  if (!Number.isSafeInteger(xp) || xp < 0) throw new RangeError('invalid-growth-xp');
  const ramp = Math.min(level - 1, 15);
  const total = 15 * ramp * (ramp + 1) + Math.max(0, level - 16) * 450 + xp;
  if (!Number.isSafeInteger(total)) throw new RangeError('growth-xp-capacity');
  return total;
}
export { GROWTH, FOOD_ECONOMY, BASIC_MEAL, levelCost, lifetimeXp };
