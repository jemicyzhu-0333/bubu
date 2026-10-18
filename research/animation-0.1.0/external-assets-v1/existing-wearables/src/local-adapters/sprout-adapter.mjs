import {SupportedWearable} from './support-motion.mjs';
export const SPROUT_SPEC = Object.freeze({id:'milestone.sprout', exclusiveGroup:'headwear', minLevel:3, effect:'sprout-sway', anchor:[0,1.62766,0], maxSway:.06, period:3.2});
export class SproutAdapter extends SupportedWearable {
  constructor(options) { super(options, 'sprout', {limit:.06, stiffness:52, damping:11, gravity:.16}); }
  deform(p, name, motion) {
    const u = Math.max(0, Math.min(1, (p.y - 1.635) / .45));
    // Zero at the stem/scalp contact; the free leaves bear their own small weight.
    p.x += motion.x * u * u;
    p.z += motion.y * u * u;
    p.y -= .006 * u * u;
  }
}
