'use strict';
const FOOD_IDS = Object.freeze(['basic', 'rice', 'milk', 'carrot', 'berry', 'fish', 'bone']);
const FIELDS = Object.freeze(['character', 'satiation', 'meal', 'foods', 'favorite']);
function mealInput(payload) {
  if (!payload || !['dango', 'usagi'].includes(payload.character)
      || !Number.isFinite(payload.satiation) || payload.satiation < 25 || payload.satiation > 100
      || !['breakfast', 'lunch', 'dinner', 'snack'].includes(payload.meal)
      || !Array.isArray(payload.foods) || !payload.foods.length || payload.foods.length > FOOD_IDS.length
      || payload.foods.some(id => !FOOD_IDS.includes(id))) throw new TypeError('invalid-pet-meal-input');
  // This explicit projection is also the disclosure boundary. Preserve fractions.
  return { character: payload.character, satiation: payload.satiation, meal: payload.meal,
    foods: [...new Set(payload.foods)], favorite: payload.foods.includes(payload.favorite) ? payload.favorite : null };
}
function validateMealAdvice(raw, payload) {
  const input = mealInput(payload);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).length !== 3 || !['foodId', 'waitMinutes', 'reactionIndex'].every(key => Object.hasOwn(raw, key))
      || !input.foods.includes(raw.foodId) || ![0, 5, 10].includes(raw.waitMinutes) || ![0, 1, 2].includes(raw.reactionIndex)) {
    throw new TypeError('invalid-pet-meal-advice');
  }
  return { foodId: raw.foodId, waitMinutes: input.satiation <= 45 ? 0 : raw.waitMinutes, reactionIndex: raw.reactionIndex };
}
const PET_MEAL_TASK = Object.freeze({
  name: 'pet-meal', schemaName: 'pet_meal', fields: FIELDS,
  instruction: 'Choose a small meal for a fictional desktop companion using only its available food IDs. Satiation is a virtual game value, not human health. Prefer its favorite occasionally. Choose waitMinutes 0, 5 or 10 (0 when satiation <=45). reactionIndex selects one of three local food-specific lines. Output only the requested JSON; no other actions or text.',
  buildInput: mealInput,
  buildSchema: payload => ({ type: 'object', additionalProperties: false, required: ['foodId', 'waitMinutes', 'reactionIndex'],
    properties: { foodId: { type: 'string', enum: mealInput(payload).foods }, waitMinutes: { type: 'integer', enum: [0, 5, 10] }, reactionIndex: { type: 'integer', enum: [0, 1, 2] } } }),
  repair(raw) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 1024) throw new TypeError('invalid-pet-meal-output');
    return JSON.parse(raw);
  },
  validate: validateMealAdvice
});
module.exports = { PET_MEAL_TASK, mealInput, validateMealAdvice };
