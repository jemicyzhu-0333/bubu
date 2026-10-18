import {SupportedWearable} from './support-motion.mjs';
export const SUNHAT_SPEC = Object.freeze({id:'milestone.sunhat', exclusiveGroup:'headwear', minLevel:5, priority:50, effect:null, seatY:1.43, topY:2.05, outerCrownRadii:[.785,.615], shellThickness:.026});
export class SunhatAdapter extends SupportedWearable {
  constructor(options) { super(options, 'sunhat', {limit:.012, stiffness:100, damping:19, gravity:.025}); }
  deform(p, name, motion) {
    const radius = Math.hypot(p.x, p.z / .785);
    const edge = Math.max(0, Math.min(1, (radius - .78) / .48));
    // The crown stays seated. Only the unsupported brim flexes downward.
    p.y -= .009 * edge * edge;
    p.y += (motion.x * p.x + motion.y * p.z) * edge;
  }
}
