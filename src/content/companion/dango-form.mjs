'use strict';

import { DANGO_RASTER } from '../../../assets/companion/dango/raster/dango.raster.mjs';
const views = ['front', 'three-quarter', 'profile', 'back'];
const slots = ['headwear', 'head-accent', 'head-aura', 'neckwear', 'backwear', 'sidebag', 'footwear'];
const motions = ['idle', 'curious', 'wave', 'high-five', 'reach', 'trade', 'dance', 'sway', 'spin', 'hop',
  'float', 'dash', 'glide', 'moonwalk', 'carry', 'wag', 'stretch', 'pushup', 'breathe', 'doze', 'hide',
  'daydream', 'read', 'browse', 'organize', 'type', 'write', 'knit', 'sip', 'cook', 'picnic', 'dig', 'build',
  'sweep', 'water', 'telescope', 'look', 'juggle', 'magic', 'umbrella', 'drum', 'mirror', 'pose', 'box',
  'fall', 'hiccup', 'recoil', 'squish', 'sleep', 'chew'];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const dataFor = view => DANGO_RASTER.views[['profile', 'three-quarter'].includes(view) ? 'three-quarter-right' : view];

// Preserve identity and saved choices while upgrading the authored art path.
// Legacy profile selections are resolved to the approved two-eye turn before
// any body, face, wardrobe or action is sampled.
const DANGO_FORM = freeze({
  id: 'dango', name: '小步', renderer: 'raster', particleStyle: 'soft', bodySize: 66, bodyGridByView: null,
  artBounds: DANGO_RASTER.artBounds,
  faceRig: Object.fromEntries(views.map(view => [view, dataFor(view).face || {}])),
  anatomyRig: Object.fromEntries(views.map(view => [view, dataFor(view).anchors])),
  appearanceAnchors: Object.fromEntries(slots.map(slot => [slot, Object.fromEntries(views.map(view => [view, { x: 0, y: 0 }]))])),
  supportedSlots: slots,
  slotLabels: { headwear: '头饰', 'head-accent': '发饰', 'head-aura': '光环', neckwear: '颈饰', backwear: '背饰', sidebag: '随身', footwear: '鞋子' },
  bubblePlacement: 'above', hitbox: { x: -2, y: -2, width: 70, height: 70 }, bleed: 40,
  motionMap: Object.fromEntries(motions.map(motion => [motion, motion])),
  supportedMotions: motions, fallbackMotion: 'idle'
});
export { DANGO_FORM };
