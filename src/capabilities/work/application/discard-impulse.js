'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { consumeImpulse } = require('../domain/impulse-inbox');

const DISCARD_IMPULSE_WRITES = Object.freeze(['impulses']);

function createDiscardImpulseCommand({
  unitOfWork,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('discard-impulse command requires a unit of work');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('discard-impulse command effects must be functions');
  }

  function execute({ impulseId, expectedRevision } = {}) {
    const transaction = unitOfWork.run({
      writes: DISCARD_IMPULSE_WRITES,
      expectedRevision,
      transition: state => consumeImpulse(state, impulseId)
    });

    if (!transaction.ok) {
      return transaction.reason === 'impulse-not-found'
        ? { ok: false }
        : { ok: false, reason: transaction.reason };
    }
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'impulse-discarded',
        impulseId: transaction.impulse.id,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true };
  }

  return Object.freeze({ execute });
}

module.exports = { DISCARD_IMPULSE_WRITES, createDiscardImpulseCommand };
