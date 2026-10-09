'use strict';

// Expressions ask for more eye and mouth states than any hand-drawn rig will
// supply. Each request walks a short fallback chain to the nearest drawn
// state; `neutral` is the last resort. When a rig draws no face for a view at
// all, the caller falls back to the form's vector face.
const EYE_FALLBACKS = Object.freeze({
  neutral: ['neutral'],
  closed: ['closed', 'sleepy', 'half', 'smile'],
  sleepy: ['sleepy', 'closed', 'half', 'neutral'],
  droopy: ['droopy', 'half', 'sleepy', 'neutral'],
  half: ['half', 'sleepy', 'neutral'],
  smile: ['smile', 'content', 'closed', 'neutral'],
  content: ['content', 'smile', 'closed', 'neutral'],
  sparkle: ['sparkle', 'wide', 'neutral'],
  wide: ['wide', 'surprised', 'sparkle', 'neutral'],
  surprised: ['surprised', 'wide', 'neutral'],
  curious: ['curious', 'wide', 'neutral'],
  focused: ['focused', 'determined', 'half', 'neutral'],
  determined: ['determined', 'focused', 'neutral'],
  pleading: ['pleading', 'wide', 'neutral'],
  shy: ['shy', 'smile', 'half', 'neutral'],
  waiting: ['waiting', 'neutral']
});

const MOUTH_FALLBACKS = Object.freeze({
  neutral: ['neutral', 'closed', 'smile'],
  closed: ['closed', 'neutral'],
  smile: ['smile', 'neutral'],
  grin: ['grin', 'smile', 'open', 'neutral'],
  open: ['open', 'talk', 'surprised', 'neutral'],
  talk: ['talk', 'open', 'neutral'],
  surprised: ['surprised', 'open', 'neutral'],
  chew: ['chew', 'talk', 'open', 'neutral'],
  wavy: ['wavy', 'neutral']
});

const GAZE_LIMIT = 2;

function pick(states, requested, table) {
  if (!states) return null;
  const chain = table[requested] || [requested, 'neutral'];
  for (const state of chain) {
    if (states[state]) return Object.freeze({ requested, state, entry: states[state], exact: state === requested });
  }
  return states.neutral ? Object.freeze({ requested, state: 'neutral', entry: states.neutral, exact: false }) : null;
}

function requestedEyes(expression = {}, blinking = false) {
  if (blinking || Number(expression.openness) <= 0.15) return 'closed';
  return typeof expression.eyes === 'string' ? expression.eyes : 'neutral';
}

function resolveRigFace(face, expression = {}, blinking = false) {
  if (!face) return null;
  const wanted = requestedEyes(expression, blinking);
  const eyes = pick(face.eyes, wanted, EYE_FALLBACKS);
  const mouth = pick(face.mouth, typeof expression.mouth === 'string' ? expression.mouth : 'neutral',
    MOUTH_FALLBACKS);
  if (!eyes && !mouth) return null;
  const clamp = value => Math.max(-GAZE_LIMIT, Math.min(GAZE_LIMIT, Number(value) || 0));
  return Object.freeze({
    eyes, mouth,
    gaze: Object.freeze({ x: clamp(expression.eyeOffsetX), y: clamp(expression.eyeOffsetY) }),
    openness: Math.max(0.15, Math.min(1, Number.isFinite(expression.openness) ? expression.openness : 1)),
    eyeInsetX: Math.max(0, Math.min(4, Number(expression.eyeInsetX) || 0)),
    // Same contract as the vector face: report the requested eye state, so
    // blink and sleep checks do not depend on which states a rig drew.
    mask: wanted
  });
}

// Authored eye-local transforms identify the eye without baking runtime
// metadata into SVG paths. Older rigs remain compatible with ordinary gaze.
function rigEyeMatrix(shape, resolved, layout, pupil = false) {
  const eyes = layout?.eyes || [];
  const localEye = eyes.findIndex(([x, y]) => Math.abs(shape.m[4] - x) < .01 && Math.abs(shape.m[5] - y) < .01);
  const closed = ['closed', 'sleepy', 'smile', 'content'].includes(resolved.eyes?.state);
  const sy = pupil && !closed && localEye >= 0 ? resolved.openness : 1;
  const inset = localEye >= 0 && eyes.length > 1 ? (localEye === 0 ? 1 : -1) * resolved.eyeInsetX : 0;
  const x = inset + (pupil ? resolved.gaze.x : 0);
  const y = (localEye >= 0 ? eyes[localEye][1] * (1 - sy) : 0) + (pupil ? resolved.gaze.y : 0);
  return [1, 0, 0, sy, x, y];
}

export { EYE_FALLBACKS, MOUTH_FALLBACKS, GAZE_LIMIT, requestedEyes, resolveRigFace, rigEyeMatrix };
export default Object.freeze({ EYE_FALLBACKS, MOUTH_FALLBACKS, GAZE_LIMIT, requestedEyes, resolveRigFace, rigEyeMatrix });
