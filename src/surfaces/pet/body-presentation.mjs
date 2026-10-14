'use strict';
import { resolveMirrorBodyPose } from './mirror-playback.mjs';
import { motionCaps } from '../../capabilities/companion/index.mjs';

// An authored grounded action owns the floor only while the presentation that
// won this frame is that action's own: the base presentation playing the
// action's expression (preview/base), or the transient event the action
// started (cue/interaction egg) -- matched by eventId, never by source alone.
// Any other winning event (essential, input-safe, another interaction) keeps
// its higher-priority body offset.
function ownsGround(action, expressionId, source = 'base', eventId = null, actionEventId = null) {
  if (!action || !motionCaps(action).ownsGround) return false;
  // An explicitly selected workbench gait retains its floor while the session
  // pause source changes. Higher-priority input/essential feedback still wins.
  if (motionCaps(action).stepInPlace && action.previewPlayback && source === 'session'
    && expressionId === action.expression) return true;
  if (source === 'base') return expressionId === (action.baseExpression || action.expression);
  return typeof eventId === 'string' && eventId.length > 0 && eventId === actionEventId;
}

// The same state offsets as the previous renderer branch. Only an authored
// grounded action replaces the unrelated idle bob; explicit states win first.
function bodyStateOffset({ state, formId, action, calmVisual, legacyFrames, bob, expressionId, source, eventId, actionEventId }) {
  if (state === 'sleeping') return 4;
  if (state === 'resting') return 6;
  if (state === 'celebrating' && !calmVisual) return -Math.abs(Math.sin(legacyFrames * .4)) * 8;
  if (state === 'walking' && !calmVisual) return Math.abs(Math.sin(legacyFrames * .3)) * 2;
  if (state === 'dragged' || (formId === 'dango' && action?.motion === 'pushup')) return 0;
  return ownsGround(action, expressionId, source, eventId, actionEventId) ? 0 : bob;
}

function resolveActionBodyPose(body, options = {}) {
  if (!ownsGround(options.action, options.expressionId, options.source, options.eventId, options.actionEventId)) return resolveMirrorBodyPose(body, options);
  // Preserve the winning expression and its tone/face. The action's feet and
// body are already coordinated, so its base happy beat must not lift the floor.
  return Object.freeze({ tone: body?.tone || 'normal', x: 0, y: 0, scaleX: 1, scaleY: 1, rotateDeg: 0 });
}

// An admitted preview may request native-facing art, but restored outfits/views
// can still reject that art at close. Resolve against this frame's projection.
function resolveGaitFacing({ facing, facingHint, formId, state, view, appearance }) {
  const native = facingHint === 1 && formId === 'dango'
    && [undefined, 'idle', 'walking'].includes(state)
    && ['three-quarter', 'three-quarter-right'].includes(view)
    && Array.isArray(appearance?.items) && appearance.items.length === 0;
  return native ? 1 : facing;
}
export { ownsGround, bodyStateOffset, resolveActionBodyPose, resolveGaitFacing };
