'use strict';

const { isDeepStrictEqual } = require('node:util');

function createStateCommitBoundary(options = {}) {
  if (typeof options.read !== 'function' || typeof options.write !== 'function' || typeof options.normalize !== 'function') {
    throw new TypeError('state commit boundary requires read, write and normalize functions');
  }
  let revision = Number.isSafeInteger(options.initialRevision) ? options.initialRevision : 0;

  function commit(candidate, context = {}) {
    const normalized = options.normalize(candidate, context);
    const secondPass = options.normalize(normalized, context);
    if (!isDeepStrictEqual(normalized, secondPass)) throw new Error('canonical state normalization is not idempotent');
    options.write(normalized, context);
    revision += 1;
    return { state: normalized, revision };
  }

  function update(mutator, context = {}) {
    if (typeof mutator !== 'function') throw new TypeError('state mutator must be a function');
    const current = options.read();
    const candidate = structuredClone(current);
    const returned = mutator(candidate);
    return commit(returned === undefined ? candidate : returned, context);
  }

  return Object.freeze({ commit, update, revision: () => revision });
}

module.exports = { createStateCommitBoundary };
