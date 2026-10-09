// A versioned, content-free projection across the existing pet:sync boundary.
// Only the main process owns freshness and expiry; renderers never infer a TTL.
const KEYS = Object.freeze(['v', 'music', 'coding', 'ai']);
const EMPTY_CONCURRENT_ACTIVITY = Object.freeze({ v: 1, music: false, coding: false, ai: false });

function normalizeConcurrentActivity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== KEYS.length || keys.some(key => !KEYS.includes(key))) return null;
  if (value.v !== 1 || ['music', 'coding', 'ai'].some(key => typeof value[key] !== 'boolean')) return null;
  return Object.freeze({ v: 1, music: value.music, coding: value.coding, ai: value.ai });
}

export { EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity };
