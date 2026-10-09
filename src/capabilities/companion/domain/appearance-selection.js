'use strict';

const { resolvePetForm } = require('../form-registry.mjs');

// Which accessories the pet is wearing, and which ones the wardrobe may offer.
//
// ARCHITECTURE「换装与伙伴形态」: explicit preferences override the automatic
// choice of the highest `exclusivePriority` unlocked item in each group.
// Unlocking a higher-priority accessory must not override a saved selection.
//
// Three states per group, and the gap between the first two is the whole design:
//
//   key absent    never expressed a preference -> keep the automatic rule
//   an item id    picked this one
//   null          took this group off, deliberately
//
// "Absent" must not collapse into "null". Someone who never opens the wardrobe
// must retain their automatic appearance, and reading a missing
// key as "wearing nothing" would strip every accessory they had earned — the
// upgrade-as-subtraction mistake `content/appearance.mjs` records in its own
// comments, arriving from the other direction.
//
// Two selection rules are pinned by the tests:
//
// **What may be chosen is governed by ownership; what happens by itself is
// governed by the skin being worn.** A skin accessory becomes selectable the
// moment its skin is unlocked, whatever skin is on — locking the crown to the
// crown skin is not the free mixing this feature exists to allow. The automatic
// fallback keeps the existing automatic rule, which only considers the current
// skin's items: widen *that* to ownership and a Lv.20 player who owns the crown
// skin finds a crown on their pink pet after an update they never asked for.
// Freedom in the choice, inertia in the default.
//
// **A combined bleed is the per-side maximum, not the sum.** `bleed` says how far
// past the 66x66 body an item reaches, so two items reaching up 16 and 32 reach up
// 32 together, not 48. The catalog already assumes this — the halo declares 32
// because the compositor lifts it by a hat crown, which is its author pre-adding
// the one case where two items genuinely stack.
//
// Nothing here writes. Selection reads a saved preference and a catalog and
// answers "what does this add up to today", which is why a stale id is discarded
// rather than raised: see the note on `normalizeEquipped` in
// `core/companion-state.js`, which deliberately leaves that judgment to this file.

const BLEED_SIDES = Object.freeze(['left', 'top', 'right', 'bottom']);
const { isSkinAvailable } = require('./skin-availability');

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Spelled the same way `projectAppearance` spells it, so the two cannot disagree
// about what level 0, NaN or -5 means.
function safeLevel(level) {
  return Math.max(1, Math.floor(Number(level) || 1));
}

// Why an item cannot be picked, or `null` when it can. Structured rather than
// prose: the domain owns the *judgment* — ARCHITECTURE「换装与伙伴形态」 requires the unlock test to live
// here and not in a greyed-out button — while the surface owns the wording, which
// needs the skin's display name and this layer has no business holding copy.
//
// An item claiming `unlockKind: 'skin'` with no skin named is locked forever.
// That combination cannot come out of the catalog builder, and refusing it is the
// safe direction for anything hand-built that gets here.
function lockReasonFor(item, level, ownedSkins) {
  if (item.unlockKind === 'skin') {
    const owned = isSkinAvailable(item.skin, ownedSkins);
    return owned ? null : Object.freeze({ kind: 'skin', skin: item.skin || null });
  }
  return level >= item.minLevel ? null : Object.freeze({ kind: 'level', minLevel: item.minLevel });
}

// The automatic rule is preserved: an item takes part only if the level reaches
// it and it belongs to no skin or to the one being worn. These are the same two
// filters `projectAppearance` applies, and `test/appearance-selection.test.js`
// asserts the results match item for item across every skin and level, so this
// copy cannot quietly drift from the original.
function autoEligible(item, level, currentSkin) {
  return item.minLevel <= level && (!item.skin || item.skin === currentSkin);
}

// `resolveExclusiveItems` in `core/pet-appearance.mjs` expresses this preference
// as a running comparison over a z-ascending list; the same order stated as a
// comparator, with `id` appended to make it total. Priority first, then the
// higher unlock, then the nearer-to-front z.
function byAutoPreference(left, right) {
  return right.exclusivePriority - left.exclusivePriority
    || right.minLevel - left.minLevel
    || right.z - left.z
    || left.id.localeCompare(right.id);
}

// The order the compositor expects, matching the sort inside `projectAppearance`.
function byCompositionOrder(left, right) {
  return left.z - right.z || left.id.localeCompare(right.id);
}

function resolveGroup(group, members, preferences, level, currentSkin, ownedSkins) {
  if (Object.prototype.hasOwnProperty.call(preferences, group)) {
    const chosenId = preferences[group];
    // An explicit `null` is an answer, not a missing one.
    if (chosenId === null) return null;
    const chosen = members.find(item => item.id === chosenId);
    // An id that names a deleted item, belongs to another group, or is not
    // unlocked falls through to the automatic pick rather than emptying the
    // group. The preference itself is untouched — it lives in persistence, and a
    // level rollback or a data repair must not delete a choice the user made. It
    // comes back on its own once the item is available again.
    if (chosen && lockReasonFor(chosen, level, ownedSkins) === null) return chosen;
  }
  return members.find(item => autoEligible(item, level, currentSkin)) || null;
}

function unionBleed(items) {
  const bleed = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const item of items) {
    for (const side of BLEED_SIDES) {
      const reach = Number(item.bleed && item.bleed[side]) || 0;
      if (reach > bleed[side]) bleed[side] = reach;
    }
  }
  return Object.freeze(bleed);
}

// The exclusive groups a catalog actually defines, in a stable order. Exported so
// that the payload validator for `appearance:equip` and the wardrobe both read
// the group set off the catalog instead of repeating it as a second list.
function appearanceGroups(items) {
  if (!Array.isArray(items)) return Object.freeze([]);
  const groups = new Set();
  for (const item of items) {
    if (item && typeof item.exclusiveGroup === 'string' && item.exclusiveGroup) groups.add(item.exclusiveGroup);
  }
  return Object.freeze([...groups].sort((left, right) => left.localeCompare(right)));
}

// `choices` is listed by group name rather than by any visual order. Presentation
// order belongs to the wardrobe, which already holds the section headings; what
// this layer owes it is stability.
function selectAppearance({ items, level, unlockedSkins, currentSkin, equipped } = {}) {
  if (!Array.isArray(items)) throw new TypeError('appearance selection requires an item catalog');
  const petLevel = safeLevel(level);
  const ownedSkins = Array.isArray(unlockedSkins)
    ? unlockedSkins.filter(skin => typeof skin === 'string' && skin)
    : [];
  const skin = typeof currentSkin === 'string' && currentSkin.trim() ? currentSkin : 'pink';
  const form = resolvePetForm(skin);
  const preferences = isPlainObject(equipped) ? equipped : {};

  const grouped = new Map();
  const worn = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || (item.formId || 'dango') !== form.id) continue;
    const group = typeof item.exclusiveGroup === 'string' && item.exclusiveGroup ? item.exclusiveGroup : null;
    // An item in no exclusive group shares its space with nothing, so there is
    // no choice to offer: it is worn whenever the automatic rule reaches it. The
    // shipping catalog has none, and `resolveExclusiveItems` treats them the same
    // way; this keeps that path alive rather than silently dropping such an item.
    if (!group) {
      if (autoEligible(item, petLevel, skin)) worn.push(item);
      continue;
    }
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(item);
  }

  const choices = [];
  // The catalog holds all pets; an empty option group from another form must
  // never turn into a selectable (or resettable) slot on the current one.
  for (const group of [...grouped.keys()].sort((left, right) => left.localeCompare(right))) {
    const members = [...(grouped.get(group) || [])].sort(byAutoPreference);
    const options = members.map(item => {
      const lockReason = lockReasonFor(item, petLevel, ownedSkins);
      return Object.freeze({
        id: item.id,
        label: typeof item.label === 'string' ? item.label : item.id,
        available: lockReason === null,
        lockReason
      });
    });
    const selected = resolveGroup(group, members, preferences, petLevel, skin, ownedSkins);
    if (selected) worn.push(selected);
    choices.push(Object.freeze({
      group,
      options: Object.freeze(options),
      selected: selected ? selected.id : null
    }));
  }

  worn.sort(byCompositionOrder);
  return Object.freeze({
    worn: Object.freeze(worn),
    choices: Object.freeze(choices),
    bleed: unionBleed(worn)
  });
}

module.exports = { appearanceGroups, selectAppearance };
