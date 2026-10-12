'use strict';
// Declarative presentation capabilities. Surface/body/art layers ask "what
// can this action do?" instead of comparing action ids. Content may override
// or extend an entry with `action.motionCaps` (plain data).
//   ownsGround     – the action's own feet/body are coordinated; outer idle
//                    bob/expression body pose must not lift the floor.
//   body           – named body-pose sampler (see body-poses.mjs).
//   story          – named prop/paw choreography sampler.
//   interruptExit  – when replaced mid-story, play a bounded presentation-only
//                    exit { durationMs, completeAt } instead of cutting.
//   handoffRecovery– when this action is resumed right after another
//                    action's interrupt exit, settle its prop/paw home in the
//                    last `window` of progress { window }.
//   resumeIdleView – after it finishes on that handoff, idle keeps the exit view.
const NONE = Object.freeze({});
const REGISTRY = Object.freeze({
  'paper-return': Object.freeze({ ownsGround: true, body: 'paper-return', story: 'paper-return',
    interruptExit: Object.freeze({ durationMs: 420, completeAt: .96 }) }),
  moonwalk: Object.freeze({ ownsGround: true, body: 'grounded-moonwalk' }),
  'magic-trick': Object.freeze({ story: 'hat-star' }),
  'sip-tea': Object.freeze({ handoffRecovery: Object.freeze({ window: .14 }), resumeIdleView: true })
});
const merged = new WeakMap();
function motionCaps(action) {
  if (!action) return NONE;
  const base = REGISTRY[action.id] || NONE;
  if (!action.motionCaps || typeof action !== 'object') return base;
  let value = merged.get(action);
  if (!value) { value = Object.freeze({ ...base, ...action.motionCaps }); merged.set(action, value); }
  return value;
}
const motionCapsById = id => REGISTRY[id] || NONE;
const hasCap = (action, name) => Boolean(motionCaps(action)[name]);
export { motionCaps, motionCapsById, hasCap, REGISTRY as MOTION_CAPABILITIES };
