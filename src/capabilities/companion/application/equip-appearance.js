'use strict';

// The wardrobe's two writes, wrapped in a transaction.
//
// ARCHITECTURE「事务、投影与 IPC」: a capability command owns this write.
// Workflows coordinate writes spanning capabilities — completing a task moves
// `tasks`, `xp`, `level`, `pet` and
// `companion` together, and the manifest's `workflowWrites` records those. Equipping
// touches `companion` and nothing else, exactly like `persist-surprise-state`, so it
// belongs beside its own domain with a `capabilityWrites` entry. The narrower
// declaration is the point: it is what stops this from ever growing a write to
// `level` without someone noticing.

const appearanceEquipping = require('../domain/appearance-equipping');
const { runPostCommitEffect } = require('../../../shared/post-commit-effects');

const EQUIP_APPEARANCE_WRITES = Object.freeze(['companion']);

function createEquipAppearanceCommand({
  unitOfWork,
  clock,
  items,
  publish = () => {},
  reportEffectError = () => {}
} = {}) {
  if (!unitOfWork || typeof unitOfWork.run !== 'function') {
    throw new TypeError('equip-appearance command requires a unit of work');
  }
  if (!clock || typeof clock.now !== 'function') {
    throw new TypeError('equip-appearance command requires a clock');
  }
  if (!Array.isArray(items)) {
    throw new TypeError('equip-appearance command requires an appearance catalog');
  }
  if (typeof publish !== 'function' || typeof reportEffectError !== 'function') {
    throw new TypeError('equip-appearance command effects must be functions');
  }

  // Both writes announce themselves the same way, because the surface reacts the
  // same way to either: re-read the projection and redraw the pet. The fact carries
  // what changed so a later listener can be pickier without this having to grow a
  // second shape.
  function commit(fact, transaction) {
    if (!transaction.committed) return;
    runPostCommitEffect(publish, Object.freeze({ ...fact, revision: transaction.revision }), reportEffectError);
  }

  function equip({ group, itemId, now, expectedRevision } = {}) {
    const equippedAt = now === undefined ? clock.now() : now;
    const transaction = unitOfWork.run({
      writes: EQUIP_APPEARANCE_WRITES,
      expectedRevision,
      context: { now: equippedAt },
      transition: state => appearanceEquipping.equipAppearance(state, { group, itemId, items, now: equippedAt })
    });
    // A refusal from the domain and a revision conflict from the store arrive the
    // same way and are both reported as-is: the surface shows one and retries the
    // other, and flattening them into a boolean would take that choice away.
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'appearance-equipped', group: transaction.group, itemId: transaction.itemId }, transaction);
    return { ok: true, changed: transaction.committed, group: transaction.group, itemId: transaction.itemId };
  }

  function reset({ now, expectedRevision } = {}) {
    const resetAt = now === undefined ? clock.now() : now;
    const transaction = unitOfWork.run({
      writes: EQUIP_APPEARANCE_WRITES,
      expectedRevision,
      context: { now: resetAt },
      transition: state => appearanceEquipping.resetAppearance(state, { now: resetAt })
    });
    if (!transaction.ok) return { ok: false, reason: transaction.reason };
    commit({ type: 'appearance-reset' }, transaction);
    return { ok: true, changed: transaction.committed };
  }

  return Object.freeze({ equip, reset });
}

module.exports = { EQUIP_APPEARANCE_WRITES, createEquipAppearanceCommand };
