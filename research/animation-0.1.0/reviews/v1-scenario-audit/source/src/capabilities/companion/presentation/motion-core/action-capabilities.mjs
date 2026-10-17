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
//   overlayForms   – forms that paint this action as a full overlay layer.
//   particles      – named renderer particle emitter ('sing-notes').
//   attachedBubbles– bubbles emit from a prop origin: 'wand' | 'origin'.
//   gentleEffect   – sparse, upward-floating effect emission.
//   cancelOn       – presentation event that cancels the running action.
//   yieldPropToHeadwear – prop hidden when a headwear item owns the head.
//   carryWalk      – carries a prop while walking (feet use the walk cycle).
//   groundShiftScale – dango vertical body offset scale for grounded actions.
//   effectTool     – dango tool whose anchor is the effect origin.
//   runFootTiming  – dango run-clip foot timing for this chase.
//   restFeetWhenUnready – dango keeps feet at rest while art is loading.
//   gesture        – usagi free-arm gesture ('yawn'|'high-five'|'wave'|'stretch').
//   dangoContact   – dango contact refinement ('dig-shift'|'laser-dot'|'single-paw'|'nap-stretch'|'tail-wag').
//   dangoFace      – dango face override ('steady'|'carry'|'corner-nap').
//   wear           – accessory declarations for the fit resolver:
//                    { stow: [{slot|region, window?, why}], layers?: {slot: pass}, holds?: bool, follow?: false }.
//   viewLock       – { allow, fallback }: views the action may be drawn in.
//   mirrorEvent    – 'music'|'ai' quiet mirror presentation.
//   screenBrowse   – props that use the reverse-view laptop lid contact.
//   faceBeats      – usagi face per motion beat ('wake'|'content').
//   dangoPawTool   – dango small-paw refinement ('cup'|'energy'|'support').
//   dangoArms      – dango arm shaping { tuck, palm }.
const C = value => Object.freeze(value);
const REGISTRY = Object.freeze({
  'paper-return': C({ viewLock: C({ allow: C(['front', 'three-quarter']), fallback: 'three-quarter' }), ownsGround: true, body: 'paper-return', story: 'paper-return',
    interruptExit: C({ durationMs: 420, completeAt: .96 }) }),
  moonwalk: C({ ownsGround: true, body: 'grounded-moonwalk' }),
  'magic-trick': C({ story: 'hat-star' }),
  'sip-tea': C({ handoffRecovery: C({ window: .14 }), resumeIdleView: true }),
  'mirror-meet': C({ overlayForms: C(['dango', 'dango-raster', 'usagi']) }),
  'mirror-music': C({ mirrorEvent: 'music', viewLock: C({ allow: C(['front', 'three-quarter']), fallback: 'front' }) }),
  'mirror-ai': C({ mirrorEvent: 'ai', viewLock: C({ allow: C(['front', 'three-quarter']), fallback: 'front' }), screenBrowse: C(['ai-chat']) }),
  'focus-browse': C({ screenBrowse: C(['laptop', 'notes']) }),
  'rest-tea': C({ faceBeats: C({ carry: 'content', organize: 'content', breathe: 'content' }) }),
  hiccup: C({ dangoPawTool: 'cup',  overlayForms: C(['dango-raster']), attachedBubbles: 'origin', gentleEffect: true, groundShiftScale: .35,
    effectTool: 'cup', dangoFace: 'steady', dangoArms: C({ tuck: true, palm: true }) }),
  sing: C({ particles: 'sing-notes' }),
  'bubble-blow': C({ attachedBubbles: 'wand', effectTool: 'bubble-wand' }),
  'take-note': C({ cancelOn: 'notebook-closed' }),
  yawn: C({ yieldPropToHeadwear: 'sleep-cap', gesture: 'yawn' }),
  'high-five': C({ gesture: 'high-five' }),
  wave: C({ gesture: 'wave' }), 'rest-window': C({ gesture: 'wave' }), 'rest-plant': C({ gesture: 'wave' }),
  stretch: C({ gesture: 'stretch' }), 'rest-stretch': C({ gesture: 'stretch' }), 'rest-daydream': C({ gesture: 'stretch' }),
  'carry-energy': C({ dangoPawTool: 'energy',  carryWalk: true, dangoFace: 'carry', dangoArms: C({ tuck: true, palm: true }) }),
  workout: C({ dangoPawTool: 'support',  wear: C({ stow: C([C({ region: 'crown', why: 'prop-headband' })]), holds: false }), groundShiftScale: .45, restFeetWhenUnready: true, dangoArms: C({ tuck: true, palm: false }) }),
  'chase-laser': C({ runFootTiming: true, dangoContact: 'laser-dot' }),
  'dig-treasure': C({ dangoContact: 'dig-shift', dangoArms: C({ tuck: true, palm: true }) }),
  sneeze: C({ dangoArms: C({ tuck: true, palm: true }) }),
  sweep: C({ dangoContact: 'single-paw' }),
  'rest-nap': C({ faceBeats: C({ daydream: 'wake', organize: 'content' }),  dangoContact: 'nap-stretch', napPillow: true }),
  'tail-wiggle': C({ dangoContact: 'tail-wag' }),
  'stuck-corner': C({ dangoFace: 'corner-nap' })
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

