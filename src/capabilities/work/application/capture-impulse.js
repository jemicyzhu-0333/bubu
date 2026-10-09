'use strict';

const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const { captureImpulse } = require('../domain/impulse-inbox');

const CAPTURE_IMPULSE_WRITES = Object.freeze(['impulses']);

function createCaptureImpulseCommand({
  unitOfWork,
  clock,
  idFactory,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('capture-impulse command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('capture-impulse command requires a clock');
  }
  if (typeof idFactory !== 'function') {
    throw new TypeError('capture-impulse command requires an identity policy');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('capture-impulse command effects must be functions');
  }

  function execute({ text, expectedRevision } = {}) {
    const capturedAt = clock.now();
    const transaction = unitOfWork.run({
      writes: CAPTURE_IMPULSE_WRITES,
      expectedRevision,
      context: { now: capturedAt },
      transition: state => {
        const captured = captureImpulse(
          state,
          { text, createdAt: capturedAt },
          { createId: idFactory }
        );
        return captured.ok ? { ok: true, impulseId: captured.impulse.id } : captured;
      }
    });

    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'impulse-captured',
        impulseId: transaction.impulseId,
        capturedAt,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true };
  }

  return Object.freeze({ execute });
}

module.exports = { CAPTURE_IMPULSE_WRITES, createCaptureImpulseCommand };
