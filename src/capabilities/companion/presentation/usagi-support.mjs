// Body and face stay exclusively in the rig; presentation additions are focused painters.
import { appearance } from './usagi-appearance.mjs';
import { expressionAccent, statusEffect } from './usagi-accents.mjs';

import { motionOffset, applyMotionTransform } from './usagi-body-motion.mjs';
import { prepareUsagiSample, usagiPropMatrix, paintUsagiProp } from './usagi-contact.mjs';
import { usagiPartLayer } from './usagi-garment-depth.mjs';
import { paintLimbsBefore, paintLimbPart, solveUsagiLegs } from './usagi-limbs.mjs';
import { prepareUsagiEventSample } from './usagi-event-actions.mjs';
import { paintUsagiEventProp } from './usagi-event-equipment.mjs';

// All arms come from the unified limb module (usagi-limbs.mjs): one socket,
// one IK chain and one closed silhouette per arm. `connectors` is the
// before-parts hook (behind-body gesture arms and support limbs under the
// authored paw); `paintPart` replaces an authored paw with the integrated limb.
function connectors(ctx, { layer, data, artwork }) {
  return paintLimbsBefore(ctx, { artwork, data, layer });
}

const support = Object.freeze({
  appearance, connectors, solvePartWorld: solveUsagiLegs,
  paintPart: paintLimbPart,
  prepareSample: (sample, options) => prepareUsagiEventSample(sample, options) || prepareUsagiSample(sample, options),
  propMatrix: usagiPropMatrix,
  paintProp: (ctx, options, paint) => paintUsagiEventProp(ctx, options, paint) || paintUsagiProp(ctx, options, paint),
  motionOffset,
  applyMotionTransform,
  expressionAccent,
  statusEffect,
  body: () => false,
  face: () => null,
  action: () => false
});
export default support;
