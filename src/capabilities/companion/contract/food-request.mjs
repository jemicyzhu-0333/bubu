import { FOOD_ORDER } from '../../../content/food-progression.mjs';

const FOOD_REQUEST_TTL_MS = 10 * 60 * 1000;

function createFoodRequest(foodId, issuedAt, nonce) {
  if (!FOOD_ORDER.includes(foodId) || !Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > 8.64e15
    || typeof nonce !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(nonce)) {
    throw new TypeError('invalid-food-request-identity');
  }
  return Object.freeze({ foodId, issuedAt, commandId: `${issuedAt}-${nonce}` });
}
const FINAL_REJECTIONS = new Set([
  'invalid-food-command', 'food-command-conflict', 'food-command-capacity',
  'unknown-food', 'food-locked', 'insufficient-food-tickets', 'food-inventory-full',
  'out-of-stock', 'basic-meal-limit', 'basic-meal-not-needed',
  'meal-version-capacity', 'food-counter-capacity'
]);
// Expiry alone does not resolve an uncertain identity. A successful authoritative
// refresh and a subsequent explicit retry must precede creating a replacement.
function foodRequestResolved(result) { return result?.ok === true || FINAL_REJECTIONS.has(result?.reason); }
function foodRequestNeedsRefresh(result) { return result?.reason === 'food-command-expired'; }
export { createFoodRequest, foodRequestResolved, foodRequestNeedsRefresh, FOOD_REQUEST_TTL_MS };
