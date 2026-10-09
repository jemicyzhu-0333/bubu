'use strict';
const { FOOD_IDS } = require('../contract/constants');
const { FOOD_REQUEST_TTL_MS: COMMAND_TTL_MS } = require('../contract/food-request.mjs');
const MAX_FOOD_RECEIPTS = 200;
const FUTURE_SKEW_MS = 30_000;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const closed = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
function validIdentity(commandId, issuedAt) {
  if (!timestamp(issuedAt) || typeof commandId !== 'string' || commandId.length > 80) return false;
  const prefix = `${issuedAt}-`;
  return commandId.startsWith(prefix) && /^[a-zA-Z0-9_-]{1,50}$/.test(commandId.slice(prefix.length));
}
function validBond(bond) {
  return closed(bond, ['stage', 'stageChanged', 'bondPoints', 'granted', 'role'])
    && ['new', 'warming', 'familiar', 'trusted'].includes(bond.stage)
    && typeof bond.stageChanged === 'boolean' && nonnegative(bond.bondPoints)
    && [0, 1, 2].includes(bond.granted) && ['dango', 'usagi'].includes(bond.role);
}
function validResult(result, kind, foodId) {
  if (!plain(result) || result.ok !== true || result.foodId !== foodId) return false;
  if (kind === 'buy') {
    return foodId !== 'basic' && closed(result, ['ok', 'foodId', 'price', 'foodTickets', 'inventory'])
      && Number.isSafeInteger(result.price) && result.price >= 1 && result.price <= 4
      && nonnegative(result.foodTickets) && Number.isSafeInteger(result.inventory)
      && result.inventory >= 1 && result.inventory <= 999;
  }
  return closed(result, ['ok', 'foodId', 'bond', 'gainedXp', 'satiation', 'totalFeeds', 'favorite', 'animation', 'reaction'])
    && (foodId === 'basic' ? result.bond === null : validBond(result.bond))
    && result.gainedXp === 0 && Number.isFinite(result.satiation) && result.satiation >= 0 && result.satiation <= 100
    && (foodId !== 'basic' || result.satiation <= 55) && nonnegative(result.totalFeeds)
    && typeof result.favorite === 'boolean' && (foodId !== 'basic' || result.favorite === false)
    && ['happy', 'chew', 'dance', 'healthy', 'shroom', 'favorite'].includes(result.animation)
    && typeof result.reaction === 'string' && result.reaction.length > 0 && result.reaction.length <= 200;
}
function normalizeFoodReceipts(raw = []) {
  if (!Array.isArray(raw) || raw.length > MAX_FOOD_RECEIPTS) throw new TypeError('invalid-food-receipts');
  const ids = new Set();
  for (const row of raw) {
    if (!closed(row, ['commandId', 'kind', 'foodId', 'issuedAt', 'result'])
      || !validIdentity(row.commandId, row.issuedAt) || ids.has(row.commandId)
      || !['buy', 'feed'].includes(row.kind) || !FOOD_IDS.includes(row.foodId)
      || !validResult(row.result, row.kind, row.foodId) || JSON.stringify(row.result).length > 2048) {
      throw new TypeError('invalid-food-receipt');
    }
    ids.add(row.commandId);
  }
  return structuredClone(raw);
}
function prepareFoodCommand(state, { commandId, foodId, issuedAt, kind, now }) {
  if (!validIdentity(commandId, issuedAt) || !FOOD_IDS.includes(foodId)
    || !['buy', 'feed'].includes(kind) || !timestamp(now)) return { ok: false, reason: 'invalid-food-command' };
  const receipts = normalizeFoodReceipts(state.pet.foodCommands);
  const prior = receipts.find(row => row.commandId === commandId);
  if (prior) {
    if (prior.foodId !== foodId || prior.kind !== kind || prior.issuedAt !== issuedAt) {
      return { ok: false, reason: 'food-command-conflict' };
    }
    return { ok: true, replayed: true, result: prior.result };
  }
  // Successful issuance is a durable high-water mark. For an unseen ID we
  // fail closed if its issuance predates it, including delayed commands and
  // a rollback after receipt pruning. Retained IDs already replayed above.
  const latestIssuedAt = receipts.reduce((latest, row) => Math.max(latest, row.issuedAt), 0);
  const commandTime = Math.max(now, latestIssuedAt);
  if (issuedAt < latestIssuedAt || issuedAt < commandTime - COMMAND_TTL_MS || issuedAt > now + FUTURE_SKEW_MS) {
    return { ok: false, reason: 'food-command-expired' };
  }
  const retained = receipts.filter(row => row.issuedAt >= commandTime - COMMAND_TTL_MS);
  if (retained.length >= MAX_FOOD_RECEIPTS) return { ok: false, reason: 'food-command-capacity' };
  return { ok: true, replayed: false, retained, identity: { commandId, foodId, issuedAt, kind } };
}
function rememberFoodCommand(state, prepared, result) {
  if (!prepared.ok || prepared.replayed || result.ok !== true) throw new TypeError('invalid-food-command-result');
  state.pet.foodCommands = normalizeFoodReceipts([...prepared.retained, { ...prepared.identity, result }]);
}
module.exports = { COMMAND_TTL_MS, MAX_FOOD_RECEIPTS, FUTURE_SKEW_MS, normalizeFoodReceipts, prepareFoodCommand, rememberFoodCommand };
