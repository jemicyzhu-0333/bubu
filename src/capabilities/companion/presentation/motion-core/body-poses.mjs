'use strict';
import { motionCaps } from './action-capabilities.mjs';
import { samplePaperReturnBody } from '../paper-return-story.mjs';
import { sampleMoonwalkBody } from '../grounded-moonwalk.mjs';
// Named, story-owned body samplers. Pose: { x, y, r, sx, sy, shear, ground }.
// `ground: true` means scale/shear pivot on the floor line, so soles stay put.
const BODY_POSES = Object.freeze({ 'paper-return': samplePaperReturnBody, 'grounded-moonwalk': sampleMoonwalkBody });
function actionBodyPose(action, progress, calmVisual = false) {
  const name = motionCaps(action).body;
  return name && BODY_POSES[name] ? BODY_POSES[name](progress, calmVisual) : null;
}
export { BODY_POSES, actionBodyPose };
