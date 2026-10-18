import {SupportedWearable} from './support-motion.mjs';
export const SCARF_SPEC = Object.freeze({id:'milestone.scarf', exclusiveGroup:'neckwear', minLevel:10, priority:50, effect:'scarf-flutter', period:2.8, maxTailX:.025, maxTailZ:.018, tailTop:.88, tailBottom:.32});
export class ScarfAdapter extends SupportedWearable {
  constructor(options) { super(options, 'scarf', {limit:.038, stiffness:42, damping:10, gravity:.18}); }
  deform(p, name, motion, contacts) {
    if (name.includes('collar')) {
      // Keep the approved collar surface: experimental inward palm pressure
      // increased measured tea seam intersections and has been removed.
      return;
    } else {
      const u = Math.max(0, Math.min(1, (.88 - p.y) / .56));
      // Quadratic hanging field leaves the entire root strip fixed. A little
      // inward drape removes the weightless flare while preserving the design.
      p.x += (-.030 + motion.x) * u * u;
      p.y -= .008 * u * u;
      p.z += motion.y * .65 * u * u;
    }
  }
}
