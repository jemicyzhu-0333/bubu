'use strict';
// Compatibility view of the unified limb module (usagi-limbs.mjs). Shoulders
// are the shared limb sockets; gesture arms are the 'gesture' limb intent.
import { sockets, intentFor, limbGeometry, paintLimb, paintLimbPart, paintLimbsBefore,
  paintLimbsUnderCloth } from './usagi-limbs.mjs';

function usagiGesture(artwork) {
  return intentFor(artwork, 'r')?.kind === 'gesture' ? artwork.pose.sample.gesture : null;
}
const gestureShoulder = sockets;
const gesturePawGeometry = (artwork, data, side) => limbGeometry(artwork, data, side);
function paintUsagiGesturePart(ctx, options) { return usagiGesture(options.artwork) ? paintLimbPart(ctx, options) : false; }
function paintUsagiGestureBack(ctx, options) { return usagiGesture(options.artwork) && options.layer === 'back' ? paintLimbsBefore(ctx, options) : false; }
function paintUsagiGestureUnderCloth(ctx, options) { return usagiGesture(options.artwork) ? paintLimbsUnderCloth(ctx, options) : false; }
export { usagiGesture, gestureShoulder, gesturePawGeometry, paintLimb,
  paintUsagiGesturePart, paintUsagiGestureBack, paintUsagiGestureUnderCloth };
