'use strict';
// Dango limb rig (data). Same contract as usagi-limbs.mjs: sockets come from
// the raster view anchors (shoulder-*/foot-*), bones are fixed lengths, and
// arms are solved by motion-core's two-bone IK. Raster output selects angle
// frames from assets/companion/dango/raster/limbs/limbs.json ("dango-limbs/1",
// see docs/ADDING_ACTIONS.md) once those assets exist; until then the current
// paw sprites are drawn through the same chain (adapter in dango-limbs.mjs).
const DANGO_LIMB_RIG = Object.freeze({
  schema: 'dango-limbs/1',
  manifestPath: 'limbs/limbs.json',
  sockets: Object.freeze({ shoulder: Object.freeze({ left: 'shoulder-left', right: 'shoulder-right' }),
    hip: Object.freeze({ left: 'foot-left', right: 'foot-right' }) }),
  arm: Object.freeze({ upper: 4, lower: 4, maxBend: .3 }),
  leg: Object.freeze({ length: 3 }),
  angleStep: Object.freeze({ segment: 22.5, paw: 45, foot: 45 })
});
export { DANGO_LIMB_RIG };
