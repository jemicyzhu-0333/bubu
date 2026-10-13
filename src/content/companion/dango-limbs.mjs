'use strict';
// Dango limb rig (data). Contract: assets/companion/dango/raster/limbs/
// COMPOSITION.md ("dango-limbs/1", manifest version 2). Shoulders are fixed
// per view/side (manifest sockets.worldRoot), bones are 6 + 6 art units, frames
// are pre-baked directions (no runtime rotation/stretch).
const DANGO_LIMB_RIG = Object.freeze({
  schema: 'dango-limbs/1',
  // Manifest versions this runtime implements the composition contract for.
  contractVersions: Object.freeze([2]),
  manifestPath: 'limbs/limbs.json',
  sockets: Object.freeze({ shoulder: Object.freeze({ left: 'shoulder-left', right: 'shoulder-right' }),
    hip: Object.freeze({ left: 'foot-left', right: 'foot-right' }) }),
  arm: Object.freeze({ upper: 6, lower: 6, maxBend: .3 }),
  leg: Object.freeze({ length: 3 }),
  angleStep: Object.freeze({ segment: 22.5, paw: 45, foot: 45 }),
  // Runtime view key -> asset view (+ horizontal reflection x' = axis - x).
  views: Object.freeze({
    front: Object.freeze({ asset: 'front' }),
    back: Object.freeze({ asset: 'back' }),
    'three-quarter-left': Object.freeze({ asset: 'three-quarter-left' }),
    // Measured on the canonical anchors: shoulder-left(L) + shoulder-right(R) = 66.
    'three-quarter-right': Object.freeze({ asset: 'three-quarter-left', reflectAxis: 66 }),
    'three-quarter': Object.freeze({ asset: 'three-quarter-left', reflectAxis: 66 })
  }),
  // A composed limb replaces the legacy hand only when its discrete contact
  // lands within this many art units of the action's contact point; otherwise
  // that hand keeps the legacy drawing (no prop or surface is moved to hide it).
  maxContactError: 1.25,
  // Contract version the production host opts into (null: inactive, since the
  // package declares runtimeReady=false). Previews/tests pass acceptContract.
  hostAcceptsContract: null,
  // Paw pose per action prop / motion (data; never per action id).
  poseByProp: Object.freeze({
    cup: 'hold', 'teacup': 'hold', picnic: 'hold', pan: 'grip', broom: 'grip', umbrella: 'grip', microphone: 'grip',
    'bubble-wand': 'grip', 'watering-can': 'grip', telescope: 'grip', binoculars: 'grip', camera: 'grip', hat: 'grip',
    keyboard: 'press', drum: 'press', document: 'press', book: 'hold', yarn: 'grip', blocks: 'grip', balls: 'reach',
    star: 'reach', gloves: 'fist', headband: 'support', 'high-five': 'wave', tissue: 'grip', treasure: 'grip', energy: 'hold'
  }),
  poseByMotion: Object.freeze({ wave: 'wave', pose: 'wave', 'high-five': 'wave', reach: 'reach', pushup: 'support', box: 'fist' }),
  defaultPose: 'rest'
});
export { DANGO_LIMB_RIG };
