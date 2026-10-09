'use strict';

const { isDeepStrictEqual } = require('node:util');

const STATE_PATH = /^[a-z][A-Za-z0-9]*$/;

function assertRepository(repository) {
  if (!repository
      || typeof repository.snapshot !== 'function'
      || typeof repository.commit !== 'function'
      || typeof repository.revision !== 'function') {
    throw new TypeError('unit of work requires snapshot, commit and revision repository ports');
  }
}

function normalizeWrites(writes) {
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new TypeError('unit of work requires at least one declared state path');
  }
  const normalized = [];
  const seen = new Set();
  for (const path of writes) {
    if (typeof path !== 'string' || !STATE_PATH.test(path)) {
      throw new TypeError('unit of work write paths must be top-level state fields');
    }
    if (seen.has(path)) throw new TypeError(`duplicate unit of work state path: ${path}`);
    seen.add(path);
    normalized.push(path);
  }
  return new Set(normalized);
}

function changedTopLevelPaths(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter(key => (
      Object.prototype.hasOwnProperty.call(before, key)
        !== Object.prototype.hasOwnProperty.call(after, key)
      || !isDeepStrictEqual(before[key], after[key])
    ))
    .sort();
}

function revisionConflict(expectedRevision, actualRevision) {
  return {
    ok: false,
    reason: 'state-revision-conflict',
    expectedRevision,
    actualRevision,
    committed: false,
    revision: actualRevision
  };
}

function createUnitOfWork({ repository } = {}) {
  assertRepository(repository);

  function run({ writes, transition, context = {}, expectedRevision } = {}) {
    const allowedWrites = normalizeWrites(writes);
    if (typeof transition !== 'function') throw new TypeError('unit of work transition must be a function');
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError('unit of work context must be an object');
    }
    if (expectedRevision !== undefined
        && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new TypeError('expected revision must be a non-negative safe integer');
    }

    const startingRevision = repository.revision();
    if (!Number.isSafeInteger(startingRevision) || startingRevision < 0) {
      throw new Error('state repository returned an invalid revision');
    }
    if (expectedRevision !== undefined && expectedRevision !== startingRevision) {
      return revisionConflict(expectedRevision, startingRevision);
    }

    const before = repository.snapshot();
    if (!before || typeof before !== 'object' || Array.isArray(before)) {
      throw new Error('state repository returned an invalid snapshot');
    }
    const draft = structuredClone(before);
    const returned = transition(draft);
    if (returned && typeof returned.then === 'function') {
      throw new TypeError('unit of work transition must be synchronous');
    }
    if (returned !== undefined && (!returned || typeof returned !== 'object' || Array.isArray(returned))) {
      throw new TypeError('unit of work transition result must be an object');
    }
    const outcome = returned || { ok: true };
    if (outcome.ok === false) {
      return { ...outcome, committed: false, revision: startingRevision };
    }

    const changedPaths = changedTopLevelPaths(before, draft);
    const undeclared = changedPaths.filter(path => !allowedWrites.has(path));
    if (undeclared.length) {
      throw new Error(`unit of work changed undeclared state path: ${undeclared.join(', ')}`);
    }
    if (changedPaths.length === 0) {
      return {
        ...outcome,
        ok: outcome.ok !== false,
        state: before,
        committed: false,
        revision: startingRevision,
        changedPaths
      };
    }

    const currentRevision = repository.revision();
    if (currentRevision !== startingRevision) {
      return revisionConflict(startingRevision, currentRevision);
    }
    const state = repository.commit(draft, { ...context, expectedRevision: startingRevision,
      ...(changedPaths.includes('aiCollaboration') ? { durability: 'authoritative' } : {}) });
    const committedRevision = repository.revision();
    if (committedRevision !== startingRevision + 1) {
      throw new Error('canonical commit must advance the state revision exactly once');
    }
    return {
      ...outcome,
      ok: outcome.ok !== false,
      state,
      committed: true,
      revision: committedRevision,
      changedPaths
    };
  }

  return Object.freeze({ run });
}

module.exports = { createUnitOfWork };
