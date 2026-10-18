import {SupportedWearable, clothPressure, tighten} from './support-motion.mjs';
export const SATCHEL_SPEC = Object.freeze({id:'milestone.satchel', exclusiveGroup:'sidebag', minLevel:8, priority:40, effect:null, side:'character-right', frontViewerSide:'left', strap:'continuous low waist sling', pouchCenter:[-.91,.32,.35]});
export class SatchelAdapter extends SupportedWearable {
  constructor(options) { super(options, 'satchel', {limit:.045, stiffness:74, damping:15, gravity:.13}); }
  deform(p, name, motion, contacts) {
    const strap = name.includes('strap');
    if (strap) {
      const angle = Math.atan2(p.z / .785, p.x);
      const difference = Math.atan2(Math.sin(angle - 2.68), Math.cos(angle - 2.68));
      const support = Math.exp(-Math.pow(difference / .52, 2));
      // Raise only the bag-side return to the upper stitched rim. The original
      // backwrap entered the pouch at mid-height, leaving an unsupported lip.
      const lift = .125 * support;
      const oldRadius = torsoRadius(p.y), newRadius = torsoRadius(p.y + lift);
      const ratio = (newRadius + .027) / (oldRadius + .027);
      p.x *= ratio; p.z *= ratio; p.y += lift;
      tighten(p, .009 + clothPressure(p, contacts, .018));
      // A continuous sling carries the bag. The same lower support field drives
      // its sewn side and pouch, so no rigid floating connector can open up.
      const side = Math.max(0, Math.min(1, (-p.x - .55) / .35));
      const low = Math.max(0, Math.min(1, (.57 - p.y) / .30));
      p.x += motion.x * .30 * side * low;
      p.z += motion.y * .25 * side * low;
      p.y -= .009 * side * low;
    } else {
      const u = Math.max(0, Math.min(1, (.55 - p.y) / .44));
      p.x += motion.x * .30 * u;
      p.z += motion.y * .25 * u;
      p.y -= .009 * u;
      // The pressure is shallow and local; preserve the accepted rigid flap.
      p.z -= clothPressure(p, contacts, .008) * u;
    }
  }
}

const PROFILE = [[.125,0],[.14,.32],[.17,.54],[.23,.69],[.32,.81],[.44,.90],[.60,.969],[.78,1],[.98,.985],[1.16,.935],[1.33,.82],[1.46,.71],[1.55,.60],[1.605,.46],[1.632,.28],[1.64,0]];
function torsoRadius(y) {
 const i = Math.max(0, PROFILE.findIndex((p, i) => i < PROFILE.length - 1 && y <= PROFILE[i + 1][0]));
 const [a, ra] = PROFILE[i], [b, rb] = PROFILE[i + 1];
 return ra + (rb - ra) * Math.max(0, Math.min(1, (y - a) / (b - a)));
}
