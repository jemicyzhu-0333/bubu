'use strict';
import { EXPRESSION_PHRASES } from './expression-phrases.mjs';

const VARIANTS = Object.freeze({
  'life.idle': Object.freeze([
    Object.freeze({ x: -.42, y: .08, lid: .02, mouth: 'neutral' }),
    Object.freeze({ x: .28, y: -.12, lid: -.015, mouth: 'closed' })
  ]),
  'work.focus': Object.freeze([
    Object.freeze({ x: -.28, y: .12, lid: .02, mouth: 'neutral' }),
    Object.freeze({ x: .24, y: .06, lid: -.015, mouth: 'closed' })
  ]),
  'work.rest': Object.freeze([
    Object.freeze({ x: -.32, y: -.08, lid: .015, mouth: 'neutral' }),
    Object.freeze({ x: .22, y: .12, lid: -.015, mouth: 'smile' })
  ])
});

// Vary an existing quiet phrase, not the semantic expression or cue scheduler.
// Action/contact faces remain theirs; gaze and lid offsets return to zero at
// every cycle boundary. No new eye glyph, body motion, event, or timer.
function sampleDangoQuietFace(face, { expressionId, expressionElapsedMs, elapsedMs = 0,
  action, motion = 'idle', calmVisual = false, reducedMotion = false, dnd = false } = {}) {
  const variants = VARIANTS[expressionId];
  if (!face || !variants || action || motion !== 'idle' || calmVisual || reducedMotion || dnd) return face;
  const time = Math.max(0, Number(expressionElapsedMs ?? elapsedMs) || 0);
  const period = EXPRESSION_PHRASES[expressionId][0], cycle = Math.floor(time / period) % 3;
  if (!cycle) return face;
  const p = (time % period) / period, weight = Math.sin(Math.PI * p) ** 2;
  const variant = variants[cycle - 1];
  return Object.freeze({ ...face,
    eyeOffsetX: (face.eyeOffsetX || 0) + variant.x * weight,
    eyeOffsetY: (face.eyeOffsetY || 0) + variant.y * weight,
    openness: Math.max(.25, Math.min(1, (face.openness ?? 1) + variant.lid * weight)),
    mouth: p > .4 && p < .58 ? variant.mouth : face.mouth
  });
}
export { sampleDangoQuietFace };
