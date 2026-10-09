import { t } from '../shared/interface/i18n.mjs';
import {
  createFoodRequest,
  foodRequestResolved,
  foodRequestNeedsRefresh,
  FOOD_REQUEST_TTL_MS as REQUEST_TTL_MS
} from '../../capabilities/companion/contract/food-request.mjs';
import { BASIC_MEAL, FOOD_ECONOMY } from '../../content/growth-policy.mjs';

// Request ownership outlives a menu visit. A transport failure is not evidence
// of a failed commit; only a terminal receipt or verified refresh can release it.
function createFoodRequestLifecycle({ send, refresh, validateRefresh, now = Date.now,
  nonce = () => globalThis.crypto.randomUUID() } = {}) {
  const requests = new Map();
  const busy = foodId => requests.get(foodId)?.busy === true;

  async function refreshExpired(foodId, entry) {
    try {
      const snapshot = await refresh();
      if (!validateRefresh(snapshot)) throw new TypeError('invalid-food-refresh');
      if (requests.get(foodId) === entry) requests.delete(foodId);
      return { result: { ok: false, reason: 'food-command-expired' }, snapshot, retryRequired: true };
    } catch (_) {
      return { result: { ok: false, reason: 'food-refresh-failed' }, refreshFailed: true };
    }
  }

  async function run(foodId) {
    let entry = requests.get(foodId);
    if (entry?.busy) return { ignored: true };
    if (!entry) {
      entry = { request: createFoodRequest(foodId, now(), nonce()), busy: false, expired: false };
      requests.set(foodId, entry);
    }
    entry.busy = true;
    try {
      if (entry.expired || now() - entry.request.issuedAt > REQUEST_TTL_MS) {
        entry.expired = true;
        return await refreshExpired(foodId, entry);
      }
      let result;
      try { result = await send(entry.request); }
      catch (_) { return { result: { ok: false, reason: 'food-result-unknown' }, unresolved: true }; }
      if (foodRequestNeedsRefresh(result)) {
        entry.expired = true;
        return await refreshExpired(foodId, entry);
      }
      const resolved = foodRequestResolved(result);
      if (resolved && requests.get(foodId) === entry) requests.delete(foodId);
      return { result, unresolved: !resolved };
    } finally {
      entry.busy = false;
    }
  }
  return Object.freeze({ run, busy, pending: foodId => requests.has(foodId) });
}

function isFeedSnapshot(value) {
  return Boolean(value && Number.isFinite(value.satiation) && value.satiation >= 0 && value.satiation <= 100
    && value.foodInventory && typeof value.foodInventory === 'object' && !Array.isArray(value.foodInventory)
    && Number.isSafeInteger(value.totalFeeds) && value.totalFeeds >= 0
    && Number.isInteger(value.basicMeal?.remaining) && value.basicMeal.remaining >= 0 && value.basicMeal.remaining <= BASIC_MEAL.dailyLimit
    && typeof value.basicMeal.eligible === 'boolean');
}

function foodRequestMessage(outcome, action = '喂食') {
  if (outcome.refreshFailed) return t('上次结果还未核对，刷新失败。再次点击会先核对库存。');
  if (outcome.retryRequired) return t('库存已刷新，上次请求已过核对期限。核对后可再次点击。');
  if (outcome.unresolved) return t('上次{action}结果尚未确认，再次点击会核对同一请求。', { action: t(action) });
  const messages = {
    'out-of-stock': '这份食物已经没有库存了。',
    'basic-meal-limit': '今天的基础餐已经用完。',
    'basic-meal-not-needed': t('现在还不饿，基础餐留到饱食不高于 {value} 时。', { value: BASIC_MEAL.hungryAt }),
    'insufficient-food-tickets': t('食物券不足，今天首次推进后可获得 {count} 张。', { count: FOOD_ECONOMY.dailyTickets }),
    'food-inventory-full': '这份食物的库存已满。',
    'food-locked': '达到对应等级后解锁。',
    'food-command-capacity': '当前请求记录已满，稍后再试。',
    'food-command-conflict': '请求身份不一致，这次没有执行。',
    'invalid-food-command': '这次请求无效，没有执行。',
    'unknown-food': '这份食物不可用。',
    'food-counter-capacity': '喂食记录已达到上限。',
    'meal-version-capacity': '照料记录已达到上限。'
  };
  return messages[outcome.result?.reason] ? t(messages[outcome.result.reason]) : t('这次没有完成{action}。', { action: t(action) });
}

export { createFoodRequestLifecycle, isFeedSnapshot, foodRequestMessage };
