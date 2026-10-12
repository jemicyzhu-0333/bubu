'use strict';

// Accessory fit resolver.
//
// One deterministic, pure decision per (form, view, action, phase, outfit):
// which equipped items are visible, in which renderer pass they paint, how far
// they are nudged, and which regions they must leave uncovered. Art modules
// only *apply* the plan; they never compare action ids themselves.
//
//   manifest  – per slot: anchor, per-view layer, area budget, follow params
//   action    – motionCaps(action).wear: { stow, hide, holds, follow }
//   fallback  – order of preference is tuck (re-layer) → cut (clip region) →
//               stow (hide for the phase window); never let it clip visibly.

import { motionCaps } from './action-capabilities.mjs';
import { springFollow } from './secondary.mjs';
import { clamp01 } from './easing.mjs';
import { accentSignal, accentSpec } from './accents.mjs';

const freeze = Object.freeze;
const SLOT = (spec) => freeze({ budget: .45, layers: freeze({}), follow: null, torso: false, ...spec });

// anchor: rig bone (usagi) or semantic anchor (dango raster); budget: max
// fraction of the body silhouette area the slot may cover in a frame (the
// matrix tool checks it); layers: per-view override of the authored pass,
// 'hide' = slot has no honest drawing in that view.
const ACCESSORY_MANIFEST = freeze({
  'usagi.headwear': SLOT({ anchor: 'root', region: 'crown', budget: .35,
    follow: freeze({ stiffness: 170, damping: 15, gain: 2.4, max: 1.6 }) }),
  'usagi.earwear': SLOT({ anchor: 'ear_r', region: 'ear', budget: .08, stacksUnder: freeze(['usagi.headwear']) }),
  // Neckwear has an authored rear outline that clears the tail (pinned by
  // pet-form-art tests), so no per-view override is needed.
  'usagi.neckwear': SLOT({ anchor: 'root', region: 'torso', torso: true, budget: .3 }),
  'usagi.backwear': SLOT({ anchor: 'root', region: 'torso', torso: true, budget: .6 }),
  'usagi.sidebag': SLOT({ anchor: 'root', region: 'hip', torso: true, budget: .2 }),
  'usagi.footwear': SLOT({ anchor: 'leg', region: 'feet', budget: .2 }),
  'usagi.aura': SLOT({ anchor: 'root', region: 'halo', budget: .25, floats: true }),
  // Dango raster hats are pinned to authored per-pose anchors (wardrobe
  // combination tests require an exact root match), so no follow spring.
  headwear: SLOT({ anchor: 'crown', region: 'crown', budget: .4 }),
  'head-accent': SLOT({ anchor: 'crown', region: 'crown', budget: .12, floats: true }),
  'head-aura': SLOT({ anchor: 'crown', region: 'halo', budget: .25, floats: true }),
  neckwear: SLOT({ anchor: 'body', region: 'torso', torso: true, budget: .3 }),
  sidebag: SLOT({ anchor: 'body', region: 'hip', torso: true, budget: .2 }),
  backwear: SLOT({ anchor: 'body', region: 'torso', budget: .6 }),
  footwear: SLOT({ anchor: 'feet', region: 'feet', budget: .2 })
});

const slotOf = item => item?.exclusiveGroup || item?.slot || null;
const manifestFor = (item, manifest = ACCESSORY_MANIFEST) => manifest[slotOf(item)] || null;
const regionSlots = (region, manifest = ACCESSORY_MANIFEST) => Object.keys(manifest).filter(id => manifest[id].region === region);

const inWindow = (window, phase) => !window || (phase >= window[0] && phase <= window[1]);

// Does the action keep a held prop near the torso this phase?
function holdsProp(action, caps) {
  if (caps.wear?.holds === false) return false;
  if (caps.wear?.holds) return true;
  const prop = action?.prop;
  return Boolean(prop && prop !== 'none');
}

function headFollowOffset(action, phase, spec, reduced) {
  if (!spec || reduced || !action || !accentSpec(action.id)) return 0;
  const caps = motionCaps(action);
  if (caps.body || caps.wear?.follow === false) return 0;
  const duration = action.duration || action.durationMs || 8000;
  // The head rides the shared squash/stretch accent; headwear trails it on a
  // spring, so it settles a beat late (bounce) instead of being glued on.
  const sample = accentSignal(action, duration);
  const signal = ms => Number(sample(ms)) || 0;
  // springFollow returns follower − signal. The crown sits ~gain·20 form units
  // above the floor pivot, so a stretch lag of s moves it by s·that distance.
  const lag = springFollow(signal, clamp01(phase) * duration, spec);
  const offset = -lag * spec.gain * 20;
  return Math.abs(offset) < .05 ? 0 : Math.max(-spec.max, Math.min(spec.max, offset));
}

/**
 * @returns {Map<itemId, {visible, layer, offsetY, cut, reason}>} plus .list
 */
function resolveAccessories({ manifest = ACCESSORY_MANIFEST, items = [], formId, view = 'front', layer, action = null, phase = 0, reduced = false } = {}) {
  const caps = motionCaps(action);
  const wear = caps.wear || {};
  const p = clamp01(Number(phase) || 0);
  const plan = [];
  const worn = new Set(items.filter(i => (i.formId || 'dango') === formId).map(slotOf));
  for (const item of items) {
    if ((item.formId || 'dango') !== formId) continue;
    const slot = slotOf(item), spec = manifestFor(item, manifest);
    let visible = true, reason = null, passLayer = null, cut = null;
    const viewRule = spec?.layers?.[view];
    if (viewRule === 'hide') { visible = false; reason = `view:${view}`; }
    else if (viewRule) passLayer = viewRule;
    // Action stows a slot (e.g. a worn prop owns the head) for its window.
    for (const rule of wear.stow || []) {
      const slots = rule.region ? regionSlots(rule.region, manifest) : [rule.slot];
      if (slots.includes(slot) && inWindow(rule.window, p)) { visible = false; reason = rule.why || 'stow'; }
    }
    if (visible && spec?.torso && holdsProp(action, caps)) cut = 'hands';
    const offsetY = visible && spec?.follow ? headFollowOffset(action, p, spec.follow, reduced) : 0;
    plan.push(freeze({ id: item.id, slot, visible, layer: passLayer, offsetY, cut, reason,
      stackedUnder: (spec?.stacksUnder || []).filter(s => worn.has(s)) }));
  }
  const byId = new Map(plan.map(entry => [entry.id, entry]));
  const result = freeze({ list: freeze(plan), get: id => byId.get(id) || null,
    // Items to paint in a given pass after remaps and stows.
    itemsFor(pass, authoredLayers) {
      return items.filter(item => {
        const entry = byId.get(item.id);
        if (!entry) return false;
        if (!entry.visible) return false;
        if (entry.layer) return entry.layer === pass;
        return authoredLayers(item).includes(pass);
      });
    } });
  return result;
}

export { ACCESSORY_MANIFEST, manifestFor, resolveAccessories, slotOf };
