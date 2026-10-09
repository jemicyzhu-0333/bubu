'use strict';
import { EXPRESSIONS } from '../../../content/expressions.mjs';
import { sampleExpressionFace } from './expression-phrases.mjs';
import { sampleInteractionFace } from './interaction-presentation.mjs';
const FACES = Object.freeze(Object.fromEntries(EXPRESSIONS.map(expression => [expression.id, expression.face])));
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = t => t * t * (3 - 2 * t);
// Each recipe describes attention, effort/contact, and recovery. Geometry is
// still supplied by the independent SVG eye/mouth layers, never a baked frame.
const RECIPES = Object.freeze({
  read: ['focused', 'neutral', 'curious', 'closed'],
  write: ['focused', 'closed', 'determined', 'talk'],
  type: ['focused', 'closed', 'half', 'closed'],
  browse: ['curious', 'neutral', 'wide', 'talk'],
  trade: ['focused', 'neutral', 'curious', 'talk'],
  organize: ['focused', 'closed', 'content', 'smile'],
  sip: ['content', 'smile', 'half', 'open'],
  chew: ['content', 'smile', 'smile', 'chew'],
  picnic: ['content', 'smile', 'smile', 'chew'],
  cook: ['focused', 'neutral', 'curious', 'talk'],
  knit: ['focused', 'closed', 'content', 'smile'],
  dig: ['determined', 'closed', 'wide', 'open'],
  build: ['focused', 'neutral', 'wide', 'smile'],
  water: ['curious', 'neutral', 'content', 'smile'],
  sweep: ['focused', 'closed', 'content', 'smile'],
  telescope: ['curious', 'closed', 'sparkle', 'open'],
  look: ['curious', 'neutral', 'wide', 'talk'],
  magic: ['focused', 'closed', 'surprised', 'open'],
  juggle: ['determined', 'closed', 'wide', 'grin'],
  drum: ['focused', 'closed', 'smile', 'open'],
  mirror: ['curious', 'neutral', 'surprised', 'talk'],
  pose: ['wide', 'neutral', 'shy', 'smile'],
  box: ['determined', 'closed', 'wide', 'open'],
  high_five: ['wide', 'smile', 'smile', 'grin'],
  wave: ['curious', 'smile', 'smile', 'grin'],
  reach: ['wide', 'open', 'sparkle', 'grin'],
  stretch: ['half', 'closed', 'closed', 'open'],
  pushup: ['determined', 'closed', 'focused', 'open'],
  daydream: ['half', 'neutral', 'curious', 'talk'],
  breathe: ['content', 'closed', 'half', 'talk'],
  doze: ['sleepy', 'closed', 'closed', 'closed'],
  sleep: ['sleepy', 'closed', 'closed', 'closed'],
  hide: ['curious', 'closed', 'wide', 'talk'],
  hiccup: ['neutral', 'closed', 'surprised', 'surprised'],
  recoil: ['half', 'wavy', 'closed', 'open'],
  squish: ['pleading', 'wavy', 'shy', 'neutral'],
  fall: ['wide', 'open', 'surprised', 'wavy'],
  carry: ['determined', 'closed', 'focused', 'talk'],
  sway: ['content', 'talk', 'smile', 'open'],
  dance: ['smile', 'smile', 'sparkle', 'grin'],
  hop: ['content', 'smile', 'smile', 'open'],
  spin: ['wide', 'smile', 'smile', 'grin'],
  dash: ['determined', 'closed', 'wide', 'open'],
  glide: ['curious', 'smile', 'wide', 'grin'],
  moonwalk: ['half', 'smile', 'shy', 'grin'],
  wag: ['content', 'smile', 'smile', 'grin'],
  float: ['content', 'talk', 'wide', 'open'],
  umbrella: ['curious', 'smile', 'smile', 'open']
});

function sampleFaceChoreography(expression, { action, motion, progress = 0, elapsedMs = 0,
  calmVisual = false, expressionId, expressionElapsedMs } = {}) {
  if (!expression) return expression;
  // Feedback and input-safety expressions outrank the current activity. The
  // renderer supplies the winning ID; gallery callers may omit it.
  const expected = action?.baseExpression || action?.expression;
  if (expressionId && expected && expressionId !== expected) return expression;
  const interaction = sampleInteractionFace(expression, action, progress, calmVisual);
  if (interaction) return interaction;
  if (calmVisual) return expression;
  const base = FACES[action?.faceCue] || expression;
  const p = clamp(progress), phase = Math.sin(Math.PI * p) ** 2;
  const recipe = RECIPES[(motion || action?.motion || '').replace('-', '_')];
  if (!recipe) return sampleExpressionFace(base, expressionId, expressionElapsedMs ?? elapsedMs);
  const contact = p >= .28 && p < .70;
  let eyes = contact ? recipe[2] : recipe[0];
  let mouth = contact ? recipe[3] : recipe[1];
  // Keypresses stay concentrated. A brief release belongs to the recovery
  // beat after the hands have worked, not to an arbitrary mid-typing smile.
  if (motion === 'type') {
    eyes = p >= .84 && p < .94 ? 'content' : (contact ? 'half' : 'focused');
    mouth = p >= .84 && p < .94 ? 'neutral' : 'closed';
  }
  const working = ['read', 'write', 'type', 'browse', 'trade', 'organize', 'knit', 'cook'].includes(motion);
  const sipping = motion === 'sip';
  const sleeping = ['sleep', 'doze'].includes(motion);
  const asleep = sleeping && (action?.faceCue || expressionId || action?.expression) === 'life.sleep';
  if (asleep) eyes = 'closed';
  const scan = working ? Math.sin(TAU * p) * .9 : Math.sin(TAU * p) * .4;
  const observingPlant = action?.prop === 'plant' && ['look', 'breathe'].includes(motion);
  const observingMirror = action?.prop === 'mirror';
  return Object.freeze({ ...base, eyes, mouth,
    eyeOffsetX: (base.eyeOffsetX || 0) + (observingPlant || observingMirror ? 1 + scan * .25 : scan),
    eyeOffsetY: (base.eyeOffsetY || 0) + (observingPlant ? .9 : observingMirror ? .35 : working ? .5 * phase : -.25 * phase),
    eyeInsetX: (base.eyeInsetX || 0) + (sipping ? .25 * phase : 0),
    openness: asleep ? 0 : sleeping ? (contact ? 0 : .4) : Math.max(.18, (base.openness ?? 1) * (1 - .2 * smooth(phase)))
  });
}
export { RECIPES, sampleFaceChoreography };
