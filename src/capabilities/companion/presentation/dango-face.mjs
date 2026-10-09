'use strict';
import { FACE_LAYOUTS, EYE_SHAPES, MOUTH_SHAPES } from '../../../content/companion/dango-vector.mjs';
import { sampleFaceChoreography } from './face-choreography.mjs';
import { paintVectorShapes, mixVectorColor } from '../../../core/pet-vector-paint.mjs';
import { sampleRunningPose } from '../../../core/pet-running-pose.mjs';
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function drawDangoFace(context, palette, face = {}, blinking = false, view = 'front') {
  const layout = FACE_LAYOUTS[view] || FACE_LAYOUTS.front;
  if (!layout.eyes.length) return 'back';
  const closed = blinking || (face.openness ?? 1) <= .15;
  const eyes = closed ? 'closed' : (EYE_SHAPES[face.eyes] ? face.eyes : 'neutral');
  const eyeShapes = EYE_SHAPES[eyes];
  const eyePalette = { ...palette, 1: palette[4] || palette[1] };
  const gazeX = clamp(face.eyeOffsetX, -2.5, 2.5), gazeY = clamp(face.eyeOffsetY, -2, 2);
  const inset = clamp(face.eyeInsetX, -1, 2);
  for (const anchor of layout.eyes) {
    const openness = closed || ['closed', 'smile', 'content', 'sleepy'].includes(eyes) ? 1 : clamp(face.openness ?? 1, .2, 1.2);
    context.save();
    context.translate(anchor.x + gazeX + inset * (anchor.side === 'left' ? 1 : -1), anchor.y + gazeY);
    context.scale(anchor.scaleX, anchor.scaleY * openness);
    paintVectorShapes(context, eyeShapes, eyePalette);
    context.restore();
  }
  const mouth = MOUTH_SHAPES[face.mouth] ? face.mouth : 'neutral';
  context.save(); context.translate(layout.mouth.x, layout.mouth.y); context.scale(layout.mouth.scaleX, 1);
  paintVectorShapes(context, MOUTH_SHAPES[mouth], palette); context.restore();
  if (['smile', 'open', 'chew', 'grin'].includes(mouth) || ['shy', 'content'].includes(eyes)) {
    context.save(); context.globalAlpha *= .24;
    const cheekFill = palette.cheek || mixVectorColor(palette[2], '#e45c74', .5);
    for (const cheek of layout.cheeks) {
      context.save(); context.translate(cheek.x, cheek.y); context.scale(cheek.scaleX, 1);
      paintVectorShapes(context, [{ d: 'M-3.2 0A3.2 1.6 0 1 0 3.2 0A3.2 1.6 0 1 0 -3.2 0Z', fill: cheekFill }], palette);
      context.restore();
    }
    context.restore();
  }
  return eyes;
}
export { drawDangoFace };


function sampleDangoFace(expression, options = {}) {
  let sampled = sampleFaceChoreography(expression, options);
  const { action, expressionId, calmVisual } = options;
  const expected = action?.baseExpression || action?.expression;
  // The winning petting expression is contentment. The shared shy glyph
  // angles down at the inner corners and reads as distress on Dango.
  // Keep this form-local: input identity and higher-priority winning IDs stay intact.
  if (sampled && expressionId === 'react.petted') return Object.freeze({ ...sampled,
    eyes: 'content', mouth: 'smile', openness: 1,
    eyeOffsetX: 0, eyeOffsetY: 0, eyeInsetX: 0 });
  if (!sampled || expressionId && expected && expressionId !== expected) return sampled;
  // Idle keeps the approved canonical eye proportions. The generic curious
  // glyph narrows the far eye in both axes, turning 3/4 perspective into a dot.
  // Gaze, eyelid openness and mouth still follow the existing idle phrase.
  if (!calmVisual && expressionId === 'life.idle' && sampled?.eyes === 'curious') {
    sampled = Object.freeze({ ...sampled, eyes: 'neutral' });
  }
  if (action?.motion === 'dash') {
    const p = calmVisual ? .5 : clamp(options.progress, 0, 1);
    const { stride } = sampleRunningPose(p, { calmVisual });
    return Object.freeze({ ...sampled, eyes: 'neutral', mouth: 'neutral',
      openness: 1 - stride * stride * .035, eyeOffsetX: .55 + stride * .12,
      eyeOffsetY: .1, eyeInsetX: 0 });
  }
  if (action?.id !== 'carry-energy') return sampled;
  const p = calmVisual ? .5 : clamp(options.progress, 0, 1), effort = Math.sin(Math.PI * p) ** 2;
  // V3 reference: a small determined lift, not an unhappy narrowed stare.
  // Effort stays in the supporting paws/body; the glossy eyes watch the object.
  return Object.freeze({ ...sampled, eyes: p > .86 ? 'content' : 'curious',
    mouth: p < .18 ? 'neutral' : p < .75 ? 'closed' : 'smile',
    openness: .97 - effort * .06, eyeOffsetX: 0, eyeOffsetY: effort * .65,
    eyeInsetX: effort * .18 });
}
export { sampleDangoFace };
