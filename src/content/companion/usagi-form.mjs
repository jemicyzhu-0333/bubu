'use strict';

// The bundled layered rig supplies the body, limbs and independent face; the
// rig is its only visual identity. Art pixels
// and source geometry stay out of the business state and this descriptor.
// Coordinates are relative to the existing 66-unit body origin.
export const USAGI_FORM = Object.freeze({
  id: 'usagi',
  name: '乌沙奇 2.0',
  renderer: 'vector',
  bodySize: 66,
  bodyGridByView: null,
  // Includes the ears at y=-28, hop/tilt, and the separate back cape.
  // The verified worst-case ink still leaves 12px in the docked window when
  // this slightly tighter top bound gives a visible (4px) top-edge peek.
  artBounds: Object.freeze({ x: -15, y: -31, width: 96, height: 113 }),
  faceRig: Object.freeze({
    front: Object.freeze({ eyes: Object.freeze([[23, 25], [43, 25]]), mouth: Object.freeze([33, 33]) }),
    'three-quarter': Object.freeze({ eyes: Object.freeze([[36, 25], [53, 25]]), mouth: Object.freeze([46, 33]) }),
    profile: Object.freeze({ eyes: Object.freeze([[50, 25]]), mouth: Object.freeze([58, 30]) }),
    back: Object.freeze({ eyes: Object.freeze([]), mouth: null })
  }),
  anatomyRig: Object.freeze({
    front: Object.freeze({ left: Object.freeze([11, 44]), right: Object.freeze([55, 44]) }),
    'three-quarter': Object.freeze({ left: Object.freeze([17, 44]), right: Object.freeze([48, 44]) }),
    profile: Object.freeze({ left: Object.freeze([19, 44]), right: Object.freeze([45, 44]) }),
    back: Object.freeze({ left: Object.freeze([11, 44]), right: Object.freeze([55, 44]) })
  }),
  appearanceAnchors: Object.freeze({
    'usagi.earwear': Object.freeze({
      front: Object.freeze({ x: 40, y: -3 }),
      'three-quarter': Object.freeze({ x: 39, y: -3 }),
      profile: Object.freeze({ x: 40, y: -3 }),
      back: Object.freeze({ x: 40, y: -3 })
    }),
    'usagi.neckwear': Object.freeze({
      front: Object.freeze({ x: 33, y: 44 }),
      'three-quarter': Object.freeze({ x: 33, y: 44 }),
      profile: Object.freeze({ x: 33, y: 44 }),
      back: Object.freeze({ x: 33, y: 44 })
    }),
    'usagi.backwear': Object.freeze({
      front: Object.freeze({ x: 33, y: 44 }),
      'three-quarter': Object.freeze({ x: 33, y: 44 }),
      profile: Object.freeze({ x: 33, y: 44 }),
      back: Object.freeze({ x: 33, y: 44 })
    }),
    'usagi.headwear': Object.freeze({
      front: Object.freeze({ x: 33, y: -1 }),
      'three-quarter': Object.freeze({ x: 33, y: -1 }),
      profile: Object.freeze({ x: 33, y: -1 }),
      back: Object.freeze({ x: 33, y: -1 })
    }),
    'usagi.sidebag': Object.freeze({
      front: Object.freeze({ x: 5, y: 49 }),
      'three-quarter': Object.freeze({ x: 10, y: 49 }),
      profile: Object.freeze({ x: 14, y: 49 }),
      back: Object.freeze({ x: 5, y: 49 })
    }),
    'usagi.footwear': Object.freeze({
      front: Object.freeze({ x: 21, y: 63 }),
      'three-quarter': Object.freeze({ x: 27, y: 63 }),
      profile: Object.freeze({ x: 31, y: 63 }),
      back: Object.freeze({ x: 21, y: 63 })
    }),
    'usagi.aura': Object.freeze({
      front: Object.freeze({ x: 33, y: -29 }),
      'three-quarter': Object.freeze({ x: 33, y: -29 }),
      profile: Object.freeze({ x: 33, y: -29 }),
      back: Object.freeze({ x: 33, y: -29 })
    })
  }),
  supportedSlots: Object.freeze([
    'usagi.headwear', 'usagi.earwear', 'usagi.aura', 'usagi.neckwear',
    'usagi.backwear', 'usagi.sidebag', 'usagi.footwear'
  ]),
  slotLabels: Object.freeze({
    'usagi.headwear': '长耳帽饰', 'usagi.earwear': '长耳装饰', 'usagi.aura': '长耳光环',
    'usagi.neckwear': '长耳颈饰', 'usagi.backwear': '长耳披风',
    'usagi.sidebag': '长耳挎包', 'usagi.footwear': '长耳鞋子'
  }),
  bubblePlacement: 'side-start',
  hitbox: Object.freeze({ x: -2, y: -33, width: 70, height: 100 }),
  bleed: 40,
  // Preserve the semantic vocabulary; rig choreography and props own its presentation.
  motionMap: Object.freeze({
    idle: 'idle', curious: 'curious', wave: 'wave', 'high-five': 'high-five', reach: 'reach',
    trade: 'trade', dance: 'dance', sway: 'sway', spin: 'spin', hop: 'hop',
    float: 'float', dash: 'dash', glide: 'glide', moonwalk: 'moonwalk', carry: 'carry',
    wag: 'wag', stretch: 'stretch', pushup: 'pushup', breathe: 'breathe', doze: 'doze',
    hide: 'hide', daydream: 'daydream', read: 'read', browse: 'browse', organize: 'organize',
    type: 'type', write: 'write', knit: 'knit', sip: 'sip', cook: 'cook',
    picnic: 'picnic', dig: 'dig', build: 'build', sweep: 'sweep', water: 'water',
    telescope: 'telescope', look: 'look', juggle: 'juggle', magic: 'magic', umbrella: 'umbrella',
    drum: 'drum', mirror: 'mirror', pose: 'pose', box: 'box', fall: 'fall',
    hiccup: 'hiccup', recoil: 'recoil', squish: 'squish', sleep: 'sleep', chew: 'chew'
  }),
  supportedMotions: Object.freeze([
    'idle', 'curious', 'wave', 'high-five', 'reach', 'trade', 'dance', 'sway',
    'spin', 'hop', 'float', 'dash', 'glide', 'moonwalk', 'carry', 'wag',
    'stretch', 'pushup', 'breathe', 'doze', 'hide', 'daydream', 'read', 'browse',
    'organize', 'type', 'write', 'knit', 'sip', 'cook', 'picnic', 'dig',
    'build', 'sweep', 'water', 'telescope', 'look', 'juggle', 'magic', 'umbrella',
    'drum', 'mirror', 'pose', 'box', 'fall', 'hiccup', 'recoil', 'squish',
    'sleep', 'chew'
  ]),
  fallbackMotion: 'curious',
  skinEffect: null
});

export default USAGI_FORM;
