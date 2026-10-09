'use strict';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    if (typeof value !== 'string') continue;
    const line = value.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
  }
  return result;
}

function mergeContentTrees(...trees) {
  const result = {};
  for (const tree of trees) mergeInto(result, tree);
  return result;
}

function mergeInto(target, source) {
  if (!isPlainObject(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = uniqueStrings([...(Array.isArray(target[key]) ? target[key] : []), ...value]);
    } else if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function dialogueStats(library) {
  const pools = {};
  const all = [];
  function visit(value, path = []) {
    if (Array.isArray(value)) {
      const lines = uniqueStrings(value);
      pools[path.join('.')] = lines.length;
      all.push(...lines);
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  }
  visit(library);
  return {
    total: all.length,
    unique: new Set(all).size,
    duplicateCount: all.length - new Set(all).size,
    pools
  };
}

function assertDialogueLibrary(library, { minimum = 600 } = {}) {
  const stats = dialogueStats(library);
  if (stats.total < minimum) throw new RangeError(`dialogue library has ${stats.total} lines; expected at least ${minimum}`);
  for (const [path, size] of Object.entries(stats.pools)) {
    if (size < 1) throw new TypeError(`dialogue pool ${path} is empty`);
  }
  return stats;
}

function createFreshPicker({ historySize = 16, rng = Math.random } = {}) {
  const recentByPool = new Map();
  return function pickFresh(values, poolId = 'default') {
    const lines = uniqueStrings(values);
    if (!lines.length) return '';
    const remembered = recentByPool.get(poolId) || [];
    const recent = new Set(remembered);
    const candidates = lines.filter(line => !recent.has(line));
    const source = candidates.length ? candidates : lines;
    const index = Math.min(source.length - 1, Math.max(0, Math.floor(rng() * source.length)));
    const selected = source[index];
    const keep = Math.min(historySize, Math.max(1, lines.length - 1));
    recentByPool.set(poolId, [...remembered.filter(line => line !== selected), selected].slice(-keep));
    return selected;
  };
}

module.exports = {
  assertDialogueLibrary,
  createFreshPicker,
  dialogueStats,
  mergeContentTrees,
  uniqueStrings
};
