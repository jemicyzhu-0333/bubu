'use strict';

const { isDeepStrictEqual } = require('node:util');

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MAX_COUNT = 1_000_000;
const LIMITS = Object.freeze({
  counters: 64,
  foodAffinity: 64,
  milestones: 128,
  lastByFamily: 128,
  recent: 64,
  discoveries: 512,
  activePackIds: 32,
  completedArcIds: 256,
  equipped: 16
});
const TERMINAL_OUTCOMES = Object.freeze(['completed', 'cancelled', 'rejected']);
const PENDING_STATUSES = Object.freeze(['issued', 'received', 'started']);
const RELATIONSHIP_STAGES = Object.freeze([
  Object.freeze({ stage: 'new', min: 0 }),
  Object.freeze({ stage: 'warming', min: 12 }),
  Object.freeze({ stage: 'familiar', min: 40 }),
  Object.freeze({ stage: 'trusted', min: 100 })
]);

const COMPANION_ROLES = Object.freeze(['dango', 'usagi']);

function companionRole(currentSkin) {
  return currentSkin === 'usagi' ? 'usagi' : 'dango';
}

function relationshipFor(companion, currentSkin) {
  return normalizeCompanionState(companion).relationships[companionRole(currentSkin)];
}

function defaultRelationship() {
  return {
    firstMetAt: null, lastSeenAt: null, lastInteractionAt: null,
    bondPoints: 0, counters: {}, foodAffinity: {}, milestones: []
  };
}

function defaultCompanionState() {
  return {
    relationships: { dango: defaultRelationship(), usagi: defaultRelationship() },
    bondDay: null,
    bondClaims: { advance: false, close: false, care: false },
    surprise: {
      budgetDay: null,
      attentionSpent: 0,
      ambientSpent: 0,
      nextAmbientAt: null,
      lastGlobalAt: null,
      lastByFamily: {},
      recent: [],
      pending: null
    },
    collection: {
      discoveries: {},
      activePackIds: ['builtin-core'],
      completedArcIds: []
    },
    appearance: {
      equipped: {},
      updatedAt: null
    }
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(object, keys, label) {
  if (!isPlainObject(object)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new TypeError(`${label} has unknown key: ${key}`);
  }
}

function normalizeId(value, fallback = null) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : fallback;
}

function normalizeTimestamp(value, fallback = null) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function normalizeCount(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : fallback;
}

function validDay(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day
    ? value
    : null;
}

function normalizeMap(raw, { limit, valueNormalizer, label, strict }) {
  if (strict && !isPlainObject(raw)) throw new TypeError(`${label} must be an object`);
  const entries = isPlainObject(raw) ? Object.entries(raw) : [];
  if (strict && entries.length > limit) throw new RangeError(`${label} exceeds capacity ${limit}`);
  const result = {};
  for (const [key, value] of entries) {
    const normalizedKey = normalizeId(key);
    const normalizedValue = valueNormalizer(value, null);
    if (!normalizedKey || normalizedValue === null) {
      if (strict) throw new TypeError(`${label} contains an invalid entry`);
      continue;
    }
    result[normalizedKey] = normalizedValue;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function normalizeIdSet(raw, { limit, fallback = [], label, strict }) {
  if (strict && !Array.isArray(raw)) throw new TypeError(`${label} must be an array`);
  const source = Array.isArray(raw) ? raw : fallback;
  if (strict && source.length > limit) throw new RangeError(`${label} exceeds capacity ${limit}`);
  const values = [];
  for (const value of source) {
    const id = normalizeId(value);
    if (!id) {
      if (strict) throw new TypeError(`${label} contains an invalid id`);
      continue;
    }
    values.push(id);
  }
  const result = [...new Set(values)].sort();
  if (strict && result.length !== source.length) throw new TypeError(`${label} must contain unique ids`);
  return result.slice(0, limit);
}

function normalizeRecent(raw, strict) {
  if (strict && !Array.isArray(raw)) throw new TypeError('companion.surprise.recent must be an array');
  const source = Array.isArray(raw) ? raw : [];
  if (strict && source.length > LIMITS.recent) {
    throw new RangeError(`companion.surprise.recent exceeds capacity ${LIMITS.recent}`);
  }
  const result = [];
  for (const item of source) {
    if (strict) assertKnownKeys(item, ['decisionId', 'cueId', 'familyId', 'finishedAt', 'outcome'], 'companion.surprise.recent item');
    const entry = {
      decisionId: normalizeId(item && item.decisionId),
      cueId: normalizeId(item && item.cueId),
      familyId: normalizeId(item && item.familyId),
      finishedAt: normalizeTimestamp(item && item.finishedAt),
      outcome: item && TERMINAL_OUTCOMES.includes(item.outcome) ? item.outcome : null
    };
    if (Object.values(entry).some(value => value === null)) {
      if (strict) throw new TypeError('companion.surprise.recent contains an invalid entry');
      continue;
    }
    result.push(entry);
  }
  return result.slice(-LIMITS.recent);
}

function normalizePending(raw, strict) {
  if (raw === null || raw === undefined) return null;
  if (strict) assertKnownKeys(raw, ['decisionId', 'cueId', 'familyId', 'issuedAt', 'expiresAt', 'status', 'attempts'], 'companion.surprise.pending');
  if (!isPlainObject(raw)) {
    if (strict) throw new TypeError('companion.surprise.pending must be null or an object');
    return null;
  }
  const result = {
    decisionId: normalizeId(raw.decisionId),
    cueId: normalizeId(raw.cueId),
    familyId: normalizeId(raw.familyId),
    issuedAt: normalizeTimestamp(raw.issuedAt),
    expiresAt: normalizeTimestamp(raw.expiresAt),
    status: PENDING_STATUSES.includes(raw.status) ? raw.status : null,
    attempts: [1, 2, 3].includes(raw.attempts) ? raw.attempts : null
  };
  const invalid = Object.values(result).some(value => value === null)
    || result.expiresAt <= result.issuedAt
    || result.expiresAt > result.issuedAt + 60_000;
  if (invalid) {
    if (strict) throw new TypeError('companion.surprise.pending is invalid');
    return null;
  }
  return result;
}

// Deliberately not reusing `normalizeMap`: that helper reads a `null` value as a
// broken entry and drops it, while here `null` is a real choice — "this group is
// empty because the user took it off". Dropping it would let the default item
// for that group grow back on the next read.
//
// Also deliberately catalog-agnostic, and not because the catalog is out of
// reach — `src/content/appearance.mjs` could be required from here the way
// `content-pack.js` requires `behaviors.mjs`. It is left out because persistence
// must not reject a saved choice just because the catalog changed under it.
// Shape is checked here, and whether an item still exists (and is unlocked) is
// decided at selection time, where an unknown id is discarded rather than raised.
function normalizeEquipped(raw, strict) {
  if (strict && !isPlainObject(raw)) throw new TypeError('companion.appearance.equipped must be an object');
  const entries = isPlainObject(raw) ? Object.entries(raw) : [];
  if (strict && entries.length > LIMITS.equipped) {
    throw new RangeError(`companion.appearance.equipped exceeds capacity ${LIMITS.equipped}`);
  }
  const result = [];
  for (const [group, item] of entries) {
    const groupId = normalizeId(group);
    const itemId = item === null ? null : normalizeId(item);
    if (!groupId || (item !== null && itemId === null)) {
      if (strict) throw new TypeError('companion.appearance.equipped contains an invalid entry');
      continue;
    }
    result.push([groupId, itemId]);
  }
  result.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return Object.fromEntries(result.slice(0, LIMITS.equipped));
}

function normalizeRelationship(raw, role, strict) {
  const relationship = isPlainObject(raw) ? raw : {};
  if (strict) assertKnownKeys(raw, [
    'firstMetAt', 'lastSeenAt', 'lastInteractionAt', 'bondPoints', 'counters', 'foodAffinity', 'milestones'
  ], `companion.relationships.${role}`);
  if (Object.hasOwn(relationship.foodAffinity || {}, 'basic')) throw new TypeError('basic food has no affinity');
  return {
    firstMetAt: normalizeTimestamp(relationship.firstMetAt),
    lastSeenAt: normalizeTimestamp(relationship.lastSeenAt),
    lastInteractionAt: normalizeTimestamp(relationship.lastInteractionAt),
    bondPoints: normalizeCount(relationship.bondPoints),
    counters: normalizeMap(relationship.counters, {
      limit: LIMITS.counters, valueNormalizer: normalizeCount,
      label: `companion.relationships.${role}.counters`, strict
    }),
    foodAffinity: normalizeMap(relationship.foodAffinity, {
      limit: LIMITS.foodAffinity, valueNormalizer: normalizeCount,
      label: `companion.relationships.${role}.foodAffinity`, strict
    }),
    milestones: normalizeIdSet(relationship.milestones, {
      limit: LIMITS.milestones, label: `companion.relationships.${role}.milestones`, strict
    })
  };
}

function normalizeCompanionState(raw, options = {}) {
  const strict = options.strict === true;
  const defaults = defaultCompanionState();
  if (strict) assertKnownKeys(raw, ['relationships', 'bondDay', 'bondClaims', 'surprise', 'collection', 'appearance'], 'companion');
  const source = isPlainObject(raw) ? raw : {};
  const relationships = isPlainObject(source.relationships) ? source.relationships : {};
  const claims = isPlainObject(source.bondClaims) ? source.bondClaims : {};
  const surprise = isPlainObject(source.surprise) ? source.surprise : {};
  const collection = isPlainObject(source.collection) ? source.collection : {};
  const appearance = isPlainObject(source.appearance) ? source.appearance : {};
  if (strict) {
    assertKnownKeys(source.relationships, COMPANION_ROLES, 'companion.relationships');
    assertKnownKeys(source.bondClaims, ['advance', 'close', 'care'], 'companion.bondClaims');
    assertKnownKeys(surprise, ['budgetDay', 'attentionSpent', 'ambientSpent', 'nextAmbientAt', 'lastGlobalAt', 'lastByFamily', 'recent', 'pending'], 'companion.surprise');
    assertKnownKeys(collection, ['discoveries', 'activePackIds', 'completedArcIds'], 'companion.collection');
    assertKnownKeys(appearance, ['equipped', 'updatedAt'], 'companion.appearance');
  }
  const result = {
    relationships: Object.fromEntries(COMPANION_ROLES.map(role => [role, normalizeRelationship(relationships[role], role, strict)])),
    bondDay: validDay(source.bondDay),
    bondClaims: { advance: claims.advance === true, close: claims.close === true, care: claims.care === true },
    surprise: {
      budgetDay: validDay(surprise.budgetDay),
      attentionSpent: normalizeCount(surprise.attentionSpent),
      ambientSpent: normalizeCount(surprise.ambientSpent),
      nextAmbientAt: normalizeTimestamp(surprise.nextAmbientAt),
      lastGlobalAt: normalizeTimestamp(surprise.lastGlobalAt),
      lastByFamily: normalizeMap(surprise.lastByFamily, {
        limit: LIMITS.lastByFamily, valueNormalizer: normalizeTimestamp,
        label: 'companion.surprise.lastByFamily', strict
      }),
      recent: normalizeRecent(surprise.recent, strict),
      pending: normalizePending(surprise.pending, strict)
    },
    collection: {
      discoveries: normalizeMap(collection.discoveries, {
        limit: LIMITS.discoveries, valueNormalizer: normalizeTimestamp,
        label: 'companion.collection.discoveries', strict
      }),
      activePackIds: normalizeIdSet(collection.activePackIds, {
        limit: LIMITS.activePackIds, fallback: defaults.collection.activePackIds,
        label: 'companion.collection.activePackIds', strict
      }),
      completedArcIds: normalizeIdSet(collection.completedArcIds, {
        limit: LIMITS.completedArcIds, label: 'companion.collection.completedArcIds', strict
      })
    },
    // Emitted unconditionally, even for a store that has never held it: the
    // strict branch below compares `raw` against this result key for key, so an
    // `appearance` that only appears once something is worn would make every
    // pre-wardrobe store read as non-canonical.
    appearance: {
      equipped: normalizeEquipped(appearance.equipped, strict),
      updatedAt: normalizeTimestamp(appearance.updatedAt)
    }
  };
  if (!result.collection.activePackIds.length) result.collection.activePackIds = [...defaults.collection.activePackIds];
  if (strict && !isDeepStrictEqual(raw, result)) {
    throw new TypeError('companion state is not canonical');
  }
  return result;
}

function relationshipStage(bondPoints) {
  const points = normalizeCount(bondPoints);
  return [...RELATIONSHIP_STAGES].reverse().find(entry => points >= entry.min).stage;
}

function incrementRelationship(companion, { points = 0, counterId = null, foodId = null, at = null, role = 'dango' } = {}) {
  if (!COMPANION_ROLES.includes(role)) throw new TypeError('invalid companion role');
  if (foodId === 'basic') throw new TypeError('basic food has no affinity');
  if (!Number.isInteger(points) || points < 0) throw new RangeError('relationship points must only increase');
  const state = normalizeCompanionState(companion);
  const relationship = state.relationships[role];
  relationship.bondPoints = Math.min(MAX_COUNT, relationship.bondPoints + points);
  if (counterId) relationship.counters = incrementMap(relationship.counters, counterId, LIMITS.counters, 'counter');
  if (foodId) relationship.foodAffinity = incrementMap(relationship.foodAffinity, foodId, LIMITS.foodAffinity, 'food affinity');
  const timestamp = normalizeTimestamp(at);
  if (timestamp !== null) {
    relationship.firstMetAt = relationship.firstMetAt === null ? timestamp : Math.min(relationship.firstMetAt, timestamp);
    relationship.lastSeenAt = relationship.lastSeenAt === null ? timestamp : Math.max(relationship.lastSeenAt, timestamp);
    relationship.lastInteractionAt = relationship.lastInteractionAt === null ? timestamp : Math.max(relationship.lastInteractionAt, timestamp);
  }
  return state;
}

function incrementMap(map, id, limit, label) {
  if (!normalizeId(id)) throw new TypeError(`${label} id is invalid`);
  if (!Object.prototype.hasOwnProperty.call(map, id) && Object.keys(map).length >= limit) {
    throw new RangeError(`${label} capacity reached`);
  }
  const next = { ...map, [id]: Math.min(MAX_COUNT, (map[id] || 0) + 1) };
  return Object.fromEntries(Object.entries(next).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function addDurableId(companion, section, field, id, limit) {
  if (!normalizeId(id)) throw new TypeError(`${field} id is invalid`);
  const state = normalizeCompanionState(companion);
  const values = state[section][field];
  if (values.includes(id)) return state;
  if (values.length >= limit) throw new RangeError(`${field} capacity reached`);
  state[section][field] = [...values, id].sort();
  return state;
}

function addMilestone(companion, id, role = 'dango') {
  if (!COMPANION_ROLES.includes(role)) throw new TypeError('invalid companion role');
  if (!normalizeId(id)) throw new TypeError('milestones id is invalid');
  const state = normalizeCompanionState(companion);
  const values = state.relationships[role].milestones;
  if (values.includes(id)) return state;
  if (values.length >= LIMITS.milestones) throw new RangeError('milestones capacity reached');
  state.relationships[role].milestones = [...values, id].sort();
  return state;
}

function completeArc(companion, id) {
  return addDurableId(companion, 'collection', 'completedArcIds', id, LIMITS.completedArcIds);
}

function addDiscovery(companion, id, at) {
  if (!normalizeId(id) || normalizeTimestamp(at) === null) throw new TypeError('discovery is invalid');
  const state = normalizeCompanionState(companion);
  const discoveries = state.collection.discoveries;
  if (Object.prototype.hasOwnProperty.call(discoveries, id)) return state;
  if (Object.keys(discoveries).length >= LIMITS.discoveries) throw new RangeError('discoveries capacity reached');
  state.collection.discoveries = Object.fromEntries(
    Object.entries({ ...discoveries, [id]: at }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  );
  return state;
}

function appendRecent(companion, entry) {
  const state = normalizeCompanionState(companion);
  const normalized = normalizeRecent([entry], true)[0];
  state.surprise.recent = [...state.surprise.recent, normalized].slice(-LIMITS.recent);
  return state;
}

function setLastByFamily(companion, familyId, at) {
  if (!normalizeId(familyId) || normalizeTimestamp(at) === null) throw new TypeError('family cooldown entry is invalid');
  const state = normalizeCompanionState(companion);
  const entries = { ...state.surprise.lastByFamily, [familyId]: at };
  const orderedForEviction = Object.entries(entries).sort(([leftId, leftAt], [rightId, rightAt]) => (
    leftAt - rightAt || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
  ));
  while (orderedForEviction.length > LIMITS.lastByFamily) {
    const [evictedId] = orderedForEviction.shift();
    delete entries[evictedId];
  }
  state.surprise.lastByFamily = Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  );
  return state;
}

module.exports = {
  ID_PATTERN,
  MAX_COUNT,
  LIMITS,
  TERMINAL_OUTCOMES,
  PENDING_STATUSES,
  RELATIONSHIP_STAGES,
  COMPANION_ROLES,
  companionRole,
  relationshipFor,
  defaultCompanionState,
  normalizeCompanionState,
  relationshipStage,
  incrementRelationship,
  addMilestone,
  addDiscovery,
  completeArc,
  appendRecent,
  setLastByFamily
};
