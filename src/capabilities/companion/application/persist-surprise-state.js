'use strict';

const { normalizeCompanionState } = require('../../../core/companion-state');

const PERSIST_SURPRISE_STATE_WRITES = Object.freeze(['companion']);

function createPersistSurpriseStateCommand({ unitOfWork } = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('persist-surprise-state command requires a unit of work');
  }

  function execute({ companion, expectedRevision } = {}) {
    // SurpriseDirector already validates its full runtime snapshot before it
    // calls this port. Keep the command strict as well so a direct caller
    // cannot turn malformed surprise data into a silent canonical rewrite.
    const normalizedIncoming = normalizeCompanionState(companion, { strict: true });
    const transaction = unitOfWork.run({
      writes: PERSIST_SURPRISE_STATE_WRITES,
      expectedRevision,
      transition: state => {
        const current = normalizeCompanionState(state.companion);
        // Discoveries are append-only; a stale Director snapshot must not
        // erase current IDs or replace their original timestamps.
        state.companion = normalizeCompanionState({
          ...current,
          surprise: normalizedIncoming.surprise,
          collection: {
            ...current.collection,
            discoveries: { ...normalizedIncoming.collection.discoveries, ...current.collection.discoveries }
          }
        }, { strict: true });
        return { ok: true };
      }
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    return { ok: true, changed: transaction.committed };
  }

  return Object.freeze({ execute });
}

module.exports = { PERSIST_SURPRISE_STATE_WRITES, createPersistSurpriseStateCommand };
