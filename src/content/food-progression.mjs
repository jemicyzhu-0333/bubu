// Stable catalog rules. Unlocks use lifetime level, never spendable XP.
const FOOD_LEVELS = Object.freeze({ basic: 1, berry: 1, carrot: 1, rice: 2, milk: 2, fish: 3, bone: 3, donut: 4, coffee: 5, mushroom: 6, cake: 8 });
const FOOD_ORDER = Object.freeze(Object.keys(FOOD_LEVELS));
const FAVORITE_FOODS = Object.freeze({ pink: 'berry', forest: 'mushroom', ocean: 'fish', sakura: 'donut', moon: 'milk', flame: 'carrot', crown: 'cake', robot: 'coffee', woodsman: 'rice', bat: 'bone', usagi: 'carrot' });
function favoriteFood(skin = 'pink') { return FAVORITE_FOODS[skin] || (typeof skin === 'string' && skin.startsWith('usagi') ? 'carrot' : 'berry'); }
function foodUnlocked(id, level = 1) { return Number.isInteger(FOOD_LEVELS[id]) && level >= FOOD_LEVELS[id]; }
export { FOOD_LEVELS, FOOD_ORDER, FAVORITE_FOODS, favoriteFood, foodUnlocked };
