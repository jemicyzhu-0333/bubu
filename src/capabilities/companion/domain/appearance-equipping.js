'use strict';

// Putting an accessory on and taking it off — the write half of the wardrobe.
//
// `appearance-selection.js` answers "what is worn today"; this answers "wear
// this". They are split the same way `skin-projection` and `skin-selection` are,
// and for the same reason: a projection is recomputed on every read and must
// tolerate anything the store holds, while a transition happens once and is the
// only place allowed to refuse.
//
// So the two disagree about a locked item on purpose. Selection quietly ignores a
// choice it cannot honour, because a level rollback must not delete what the user
// picked. This layer rejects one outright with `item-locked`, because a request to
// wear something unearned is a request, not a leftover — ARCHITECTURE「换装与伙伴形态」 puts that judgment
// here rather than in a greyed-out button, so a surface that forgets to grey one
// out cannot smuggle it through.
//
// No clock. `src/capabilities/*/domain/` may not read one (the architecture check
// enforces it), and that constraint is doing real work here: `updatedAt` is only
// ever written from a `now` the caller supplies, so a test can pin it and the
// command layer stays the single place that decides what time it is.

const { appearanceGroups } = require('./appearance-selection');
const { isSkinAvailable } = require('./skin-availability');
const { resolvePetForm } = require('../form-registry.mjs');

function assertDraft(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('appearance equipping requires a state draft');
  }
}

// Spelled the way `normalizeTimestamp` in `core/companion-state.js` spells it, on
// purpose: a fractional or negative `now` is one that normalization would quietly
// turn back into `null` on the next read, so refusing it here is the difference
// between a caught bug and an `updatedAt` that mysteriously never sticks.
function assertNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('appearance equipping requires a timestamp the store can hold');
  }
}

// Normalization guarantees `companion.appearance.equipped` exists, so this is
// reached only by a hand-built draft in a test or by a store repaired mid-flight.
// Building the branch rather than throwing keeps a first-ever equip working on a
// state that has everything else but this.
function appearanceOf(state) {
  if (!state.companion || typeof state.companion !== 'object' || Array.isArray(state.companion)) {
    state.companion = {};
  }
  const companion = state.companion;
  if (!companion.appearance || typeof companion.appearance !== 'object' || Array.isArray(companion.appearance)) {
    companion.appearance = { equipped: {}, updatedAt: null };
  }
  const appearance = companion.appearance;
  if (!appearance.equipped || typeof appearance.equipped !== 'object' || Array.isArray(appearance.equipped)) {
    appearance.equipped = {};
  }
  return appearance;
}

// Ownership, not what is currently on — the same rule `appearance-selection.js`
// applies to `choices[].available`, deliberately duplicated as a guard rather
// than imported, because the two answer different questions: that one is deciding
// what to show, this one is deciding what to allow. `test/appearance-equipping`
// asserts they agree, which is what keeps the duplication honest.
function isUnlocked(item, level, unlockedSkins) {
  if (item.unlockKind === 'skin') {
    return isSkinAvailable(item.skin, unlockedSkins);
  }
  return level >= item.minLevel;
}

// `level` and `unlockedSkins` are read off the draft rather than passed in, the
// way `skin-selection.js` reads `state.unlockedSkins`: they are state, and a caller
// that could supply its own would be able to grant an unlock the store disagrees
// with. The catalog is the one thing that arrives as an argument, because it is
// content and the domain may not reach into `src/content/`.
function equipAppearance(state, { group, itemId, items, now } = {}) {
  assertDraft(state);
  assertNow(now);
  if (!Array.isArray(items)) throw new TypeError('appearance equipping requires an item catalog');

  if (typeof group !== 'string' || !appearanceGroups(items).includes(group)) {
    return { ok: false, reason: 'appearance-group-unknown' };
  }
  const form = resolvePetForm(state.currentSkin);
  if (!form.supportedSlots.includes(group)) return { ok: false, reason: 'appearance-group-unknown' };
  if (itemId !== null && typeof itemId !== 'string') {
    return { ok: false, reason: 'appearance-item-invalid' };
  }

  if (itemId !== null) {
    const item = items.find(candidate => candidate && candidate.id === itemId);
    // A member of another group is "not found" for this group rather than a
    // separate error: from the caller's side both mean "that id is not one of
    // this group's options", and inventing a second reason for it would have the
    // surface write two messages that say the same thing.
    if (!item || item.exclusiveGroup !== group || (item.formId || 'dango') !== form.id) {
      return { ok: false, reason: 'appearance-item-not-found' };
    }
    const petLevel = Math.max(1, Math.floor(Number(state.level) || 1));
    const owned = Array.isArray(state.unlockedSkins) ? state.unlockedSkins : [];
    if (!isUnlocked(item, petLevel, owned)) return { ok: false, reason: 'item-locked' };
  }

  const appearance = appearanceOf(state);
  const current = Object.prototype.hasOwnProperty.call(appearance.equipped, group)
    ? appearance.equipped[group]
    : undefined;
  // Re-picking what is already picked is a success that changes nothing, so the
  // unit of work sees no write and `updatedAt` keeps pointing at the last real
  // edit. Note that `undefined` (never chosen) and `null` (chosen to be bare) are
  // different here too: the first click on `[无]` is a genuine change even though
  // the pet does not move, because it turns a default into a decision.
  if (current === itemId) return { ok: true, changed: false, group, itemId };

  appearance.equipped[group] = itemId;
  appearance.updatedAt = now;
  return { ok: true, changed: true, group, itemId };
}

// Back to the automatic rule for every group at once. Emptying the map is not the
// same as writing `null` into each key: `null` means "the user wants this group
// bare", while an absent key means "no opinion", which is what restoring the
// default has to mean or the pet would come back naked instead of stock.
function resetAppearance(state, { now } = {}) {
  assertDraft(state);
  assertNow(now);
  const appearance = appearanceOf(state);
  const groups = resolvePetForm(state.currentSkin).supportedSlots;
  const remaining = Object.fromEntries(Object.entries(appearance.equipped)
    .filter(([group]) => !groups.includes(group)));
  if (Object.keys(remaining).length === Object.keys(appearance.equipped).length) {
    return { ok: true, changed: false };
  }
  appearance.equipped = remaining;
  appearance.updatedAt = now;
  return { ok: true, changed: true };
}

module.exports = { equipAppearance, resetAppearance };
