'use strict';
// Accessory slot stacking. Each rule names the slot it adjusts and the
// occupant that triggers it; offsets compose in rule order. Pure data so the
// wardrobe workbench and tests can enumerate every combination.
const RULES = Object.freeze([
  // Headphone band crosses the ear root: ride the clip further up the ear,
  // slightly smaller, tipped outward so it reads past the band.
  Object.freeze({ slot: 'usagi.earwear', when: 'headphones', x: 1.5, y: -5, rotate: .22, scale: .86 }),
  // A brimmed hat crowds the clasp: nudge outward.
  Object.freeze({ slot: 'usagi.earwear', when: 'usagi.headwear', x: 1.5, y: -1.5, rotate: .08, scale: 1 })
]);
const IDENTITY = Object.freeze({ x: 0, y: 0, rotate: 0, scale: 1 });
function occupantsFor({ appearance, artwork } = {}) {
  const set = new Set();
  for (const item of appearance?.items || []) if (item?.exclusiveGroup) set.add(item.exclusiveGroup);
  if (artwork?.combinationAccessories?.headphones || artwork?.pose?.sample?.event?.category === 'music') set.add('headphones');
  return set;
}
function resolveAccessoryStack(slot, occupants) {
  let out = IDENTITY;
  for (const rule of RULES) if (rule.slot === slot && occupants.has(rule.when)) {
    out = { x: out.x + rule.x, y: out.y + rule.y, rotate: out.rotate + rule.rotate, scale: out.scale * rule.scale };
  }
  return out;
}
export { RULES as ACCESSORY_STACK_RULES, occupantsFor, resolveAccessoryStack };
