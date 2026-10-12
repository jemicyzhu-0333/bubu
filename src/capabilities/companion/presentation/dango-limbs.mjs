'use strict';
// Dango limb adapter over the unified limb core. Every contact hand gets the
// same chain record as usagi (socket -> IK -> wrist). With a limbs.json
// manifest the painter picks segment / paw frames by IK angle (no rotation);
// without one (current state) the existing paw sprites keep drawing, and the
// chain is still exposed for detectors and future frame selection.
import { solveTwoBone, nearestFrame, segmentAngle } from './motion-core/limbs.mjs';
import { DANGO_LIMB_RIG } from '../../../content/companion/dango-limbs.mjs';

function socketPoint(anchors, side, kind = 'shoulder') {
  const a = anchors?.[DANGO_LIMB_RIG.sockets[kind][side]];
  return a ? [a.x, a.y] : null;
}

function validLimbManifest(manifest) {
  return manifest && manifest.schema === DANGO_LIMB_RIG.schema && manifest.segments && manifest.paws ? manifest : null;
}

// Attach `hand.limb` = { socket, chain, frames } to each contact hand.
function attachDangoLimbs(contact, anchors, { view = 'front', limbs = null, pose = 'grip' } = {}) {
  if (!contact?.hands) return contact;
  const manifest = validLimbManifest(limbs), spec = manifest?.bones?.arm || DANGO_LIMB_RIG.arm;
  for (const hand of contact.hands) {
    const socket = socketPoint(anchors, hand.side) || hand.points?.[0];
    const target = hand.gripPoint || hand.points?.at(-1);
    if (!socket || !target) continue;
    const chain = solveTwoBone(socket, target, { upper: spec.upper, lower: spec.fore ?? spec.lower,
      bend: hand.side === 'left' ? -1 : 1, maxBend: DANGO_LIMB_RIG.arm.maxBend });
    let frames = null;
    if (manifest) {
      const s = hand.side === 'left' ? 'l' : 'r';
      frames = {
        upper: nearestFrame(manifest.segments[`arm-upper-${s}`]?.frames, segmentAngle(chain.root, chain.elbow)),
        fore: nearestFrame(manifest.segments[`arm-fore-${s}`]?.frames, segmentAngle(chain.elbow, chain.wrist)),
        paw: nearestFrame(manifest.paws[pose]?.views?.[view], segmentAngle(chain.elbow, chain.wrist))
      };
    }
    hand.limb = Object.freeze({ socket, chain, frames, source: manifest ? 'limbs.json' : 'legacy-sprite' });
  }
  return contact;
}

function traceDangoLimbs(artwork) {
  return (artwork?.contact?.hands || []).map(h => ({ side: h.side, sprite: h.pawSprite || (h.attachedArm ? 'arm' : 'none'),
    len: h.limb ? Math.hypot(h.limb.chain.wrist[0] - h.limb.socket[0], h.limb.chain.wrist[1] - h.limb.socket[1]) : 0,
    wrist: h.limb?.chain.wrist || h.points?.at(-1) }));
}

export { attachDangoLimbs, traceDangoLimbs, validLimbManifest, socketPoint };
