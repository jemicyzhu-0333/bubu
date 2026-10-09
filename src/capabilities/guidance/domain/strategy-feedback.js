'use strict';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validStrategyId(strategyId) {
  return typeof strategyId === 'string'
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(strategyId)
    && strategyId.length <= 100;
}

function recordStrategyShown(feedback, strategyId, now) {
  const source = isPlainObject(feedback) ? feedback : {};
  const previous = isPlainObject(source[strategyId]) ? source[strategyId] : {};
  return {
    ...source,
    [strategyId]: {
      helpful: typeof previous.helpful === 'boolean' ? previous.helpful : null,
      updatedAt: now,
      shownCount: Math.min(1000000, (Number(previous.shownCount) || 0) + 1),
      dismissedCount: Number(previous.dismissedCount) || 0
    }
  };
}

function recordStrategyFeedback(feedback, strategyId, helpful, now) {
  const source = isPlainObject(feedback) ? feedback : {};
  const previous = isPlainObject(source[strategyId]) ? source[strategyId] : {};
  return {
    ...source,
    [strategyId]: {
      helpful,
      updatedAt: now,
      shownCount: Number(previous.shownCount) || 0,
      dismissedCount: Math.min(1000000, (Number(previous.dismissedCount) || 0) + (helpful ? 0 : 1))
    }
  };
}

module.exports = { isValidStrategyId: validStrategyId, recordStrategyShown, recordStrategyFeedback };
