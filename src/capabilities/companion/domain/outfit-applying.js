'use strict';

const { resolvePetForm } = require('../form-registry.mjs');
const { isSkinAvailable } = require('./skin-availability');

// A preset is a recipe for existing slots, never an alternate persisted outfit.
// Validate the complete recipe before touching even the transaction's draft.
function applyOutfit(state, { look, expectedSkin, items, now } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('outfit requires a state draft');
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('outfit requires a valid timestamp');
  if (!Array.isArray(items)) throw new TypeError('outfit requires an item catalog');
  if (!look) return { ok: false, reason: 'appearance-outfit-unknown' };
  if (typeof expectedSkin !== 'string' || expectedSkin !== state.currentSkin) {
    return { ok: false, reason: 'appearance-target-changed' };
  }
  const form = resolvePetForm(state.currentSkin);
  if (look.formId !== form.id || !isSkinAvailable(state.currentSkin, state.unlockedSkins)) {
    return { ok: false, reason: 'appearance-target-changed' };
  }
  if (!Array.isArray(look.itemIds) || !look.itemIds.length) return { ok: false, reason: 'appearance-outfit-invalid' };
  const selected = new Map();
  const level = Math.max(1, Math.floor(Number(state.level) || 1));
  for (const id of look.itemIds) {
    const item = items.find(candidate => candidate?.id === id);
    if (!item || item.formId !== form.id || !form.supportedSlots.includes(item.exclusiveGroup)
        || selected.has(item.exclusiveGroup)) return { ok: false, reason: 'appearance-outfit-invalid' };
    if (item.unlockKind === 'skin' ? !isSkinAvailable(item.skin, state.unlockedSkins) : level < item.minLevel) {
      return { ok: false, reason: 'item-locked' };
    }
    selected.set(item.exclusiveGroup, id);
  }
  const slots = Object.fromEntries(form.supportedSlots.map(slot => [slot, selected.get(slot) ?? null]));
  const before = state.companion?.appearance?.equipped || {};
  if (Object.entries(slots).every(([slot, id]) => before[slot] === id)) {
    return { ok: true, changed: false, lookId: look.id };
  }
  state.companion = { ...state.companion, appearance: {
    ...state.companion?.appearance, equipped: { ...before, ...slots }, updatedAt: now
  } };
  return { ok: true, changed: true, lookId: look.id };
}

module.exports = { applyOutfit };
