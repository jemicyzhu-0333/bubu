'use strict';
import { applyPoint, localMatrix, multiply } from './rig/pose.mjs';
import { usagiPropMatrix } from './usagi-contact.mjs';

// Match the authored ring and the exact blended bone/prop transform used by
// rig-art. The renderer projects this art-space point through its final pose.
function withUsagiEffectOrigins(artwork) {
  const data = artwork?.rig?.views?.[artwork.drawnView];
  const prop = data?.props?.['bubble-wand'];
  const origins = {};
  if (prop && artwork.pose.sample.props.includes('bubble-wand')) {
    const pose = artwork.pose.sample.propPoses?.['bubble-wand'];
    const bone = artwork.pose.world[prop.bone];
    const matrix = pose ? multiply(bone, localMatrix(data.bones[prop.bone].pivot, pose)) : bone;
    const ring = applyPoint(prop.shapes[1].m, 0, -7);
    origins.bubbles = Object.freeze(applyPoint(usagiPropMatrix(matrix, {id:'bubble-wand', artwork, data}), ...ring));
  }
  return Object.freeze({...artwork, effectOrigins:Object.freeze(origins)});
}
export { withUsagiEffectOrigins };
