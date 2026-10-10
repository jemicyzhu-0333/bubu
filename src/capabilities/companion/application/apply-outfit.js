'use strict';
const { applyOutfit } = require('../domain/outfit-applying');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');
const APPLY_OUTFIT_WRITES = Object.freeze(['companion']);

function createApplyOutfitCommand({ unitOfWork, clock, items, looks, publish = () => {}, reportEffectError = () => {} } = {}) {
  if (typeof unitOfWork?.run !== 'function' || typeof clock?.now !== 'function'
      || !Array.isArray(items) || !Array.isArray(looks)
      || typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('outfit command requires transaction, clock, catalog and effect ports');
  }
  // Snapshot trusted content at construction. Renderer payloads cannot supply or
  // later mutate recipe pieces, unlock levels, forms or slot assignments.
  const catalog = structuredClone(items);
  const presets = new Map(looks.map(look => [look.id, structuredClone(look)]));
  function apply({ lookId, expectedSkin, expectedRevision, now = clock.now() } = {}) {
    const transaction = unitOfWork.run({ writes: APPLY_OUTFIT_WRITES, expectedRevision, context: { now },
      transition: state => applyOutfit(state, { look: presets.get(lookId), expectedSkin, items: catalog, now }) });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    if (transaction.committed) runPostCommitEffect(publish,
      Object.freeze({ type: 'appearance-outfit-applied', lookId: transaction.lookId, revision: transaction.revision }), reportEffectError);
    return { ok: true, changed: transaction.committed, lookId: transaction.lookId };
  }
  return Object.freeze({ apply });
}
module.exports = { APPLY_OUTFIT_WRITES, createApplyOutfitCommand };
