'use strict';

// Shared field primitives. These used to live privately inside validation.js;
// schema 8 splits the task model into its own module, and both need the exact
// same coercion rules. Duplicating them would let the persisted shape and the
// IPC boundary drift apart, which is precisely what strict canonical validation
// is supposed to prevent.

const MAX_NATIVE_COORDINATE = 1_000_000;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function numberInRange(value, fallback, min, max, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const bounded = Math.max(min, Math.min(max, number));
  return integer ? Math.round(bounded) : bounded;
}

function nonNegativeInteger(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  return numberInRange(value, fallback, 0, max, true);
}

/**
 * Clamp an optional integer, or return `null` when the field is genuinely absent.
 *
 * `numberInRange` cannot express this: `Number(null)` is `0`, which is finite, so
 * an absent field would silently clamp up to the minimum. That turned an empty
 * estimate into "1 minute" and an unset friction into "effortless", and it also
 * broke idempotent normalization.
 */
function optionalInteger(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.max(min, Math.min(max, number)));
}

function unitFraction(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number < 0) return 0;
  if (number >= 1) return 1 - Number.EPSILON;
  // Preserve legacy writer output exactly. Older 0.1.0 development builds
  // could persist a mathematically valid fraction with more than six decimal
  // places; changing it during strict current-schema validation would make an
  // otherwise recoverable store refuse to open.
  return number;
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function trimmedString(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const result = value.trim();
  return result ? result.slice(0, maxLength) : fallback;
}

function validDayKey(value) {
  if (typeof value !== 'string' || !/^\d{4,}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day
    ? value
    : null;
}

function validIsoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date) && typeof value !== 'number') return null;
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timestampOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 8.64e15 ? number : null;
}

function uniqueNormalizedId(value, fallback, usedIds) {
  let id = trimmedString(value, null, 200);
  if (!id || usedIds.has(id)) {
    const base = trimmedString(fallback, 'recovered', 200);
    id = base;
    let suffix = 1;
    while (usedIds.has(id)) {
      const ending = `-${suffix++}`;
      id = `${base.slice(0, 200 - ending.length)}${ending}`;
    }
  }
  usedIds.add(id);
  return id;
}

module.exports = {
  MAX_NATIVE_COORDINATE,
  isPlainObject,
  numberInRange,
  nonNegativeInteger,
  optionalInteger,
  unitFraction,
  booleanOr,
  trimmedString,
  validDayKey,
  validIsoOrNull,
  timestampOrNull,
  uniqueNormalizedId
};
