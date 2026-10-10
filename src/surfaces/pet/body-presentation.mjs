'use strict';
import { resolveMirrorBodyPose } from './mirror-playback.mjs';

const GROUNDED = new Set(['moonwalk', 'paper-return']);
function ownsGround(action, expressionId, source = 'base') {
  return GROUNDED.has(action?.id) && source === 'base'
    && expressionId === (action.baseExpression || action.expression);
}

// The same state offsets as the previous renderer branch. Only an authored
// grounded action replaces the unrelated idle bob; explicit states win first.
function bodyStateOffset({ state, formId, action, calmVisual, legacyFrames, bob, expressionId, source }) {
  if (state === 'sleeping') return 4;
  if (state === 'resting') return 6;
  if (state === 'celebrating' && !calmVisual) return -Math.abs(Math.sin(legacyFrames * .4)) * 8;
  if (state === 'walking' && !calmVisual) return Math.abs(Math.sin(legacyFrames * .3)) * 2;
  if (state === 'dragged' || (formId === 'dango' && action?.motion === 'pushup')) return 0;
  return ownsGround(action, expressionId, source) ? 0 : bob;
}

function resolveActionBodyPose(body, options = {}) {
  if (!ownsGround(options.action, options.expressionId, options.source)) return resolveMirrorBodyPose(body, options);
  // Preserve the winning expression and its tone/face. The action's feet and
// body are already coordinated, so its base happy beat must not lift the floor.
  return Object.freeze({ tone: body?.tone || 'normal', x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });
}
export { ownsGround, bodyStateOffset, resolveActionBodyPose };
