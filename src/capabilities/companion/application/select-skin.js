'use strict';

const skinSelection = require('../domain/skin-selection');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const SELECT_SKIN_WRITES = Object.freeze(['currentSkin', 'pet']);

function createSelectSkinCommand({
  unitOfWork,
  availableSkinIds,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('select-skin command requires a unit of work');
  }
  if (!Array.isArray(availableSkinIds) || availableSkinIds.length === 0) {
    throw new TypeError('select-skin command requires a skin catalog');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('select-skin command effects must be functions');
  }

  function execute({ skinId, expectedRevision } = {}) {
    const transaction = unitOfWork.run({
      writes: SELECT_SKIN_WRITES,
      expectedRevision,
      transition: state => skinSelection.selectSkin(state, { skinId, availableSkinIds })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) {
      const fact = Object.freeze({
        type: 'skin-selected',
        skinId: transaction.skinId,
        revision: transaction.revision
      });
      runPostCommitEffect(publish, fact, reportEffectError);
    }
    return { ok: true, changed: transaction.committed, skinId: transaction.skinId };
  }

  return Object.freeze({ execute });
}

module.exports = { SELECT_SKIN_WRITES, createSelectSkinCommand };
