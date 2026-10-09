'use strict';

import { EXPRESSION_PHRASES } from './expression-phrases.mjs';

const KEEP_EYES = new Set(['react.surprised', 'react.celebrate', 'system.restricted']);
const ease = t => t * t * (3 - 2 * t);

// Reuse the accepted drawings. Close the lids briefly while a standalone
// phrase changes eye type, and settle the mouth before reopening. Blending
// whole faces would leave two sets of pupils visible at once.
function sampleUsagiFaceTiming(face, base, { action, motion, expressionId, expressionElapsedMs = 0,
  progress = 0, calmVisual = false } = {}) {
  if (!face || calmVisual) return face;
  const expected = action?.baseExpression || action?.expression;
  if (expressionId && expected && expressionId !== expected) return face;
  if (action?.id === 'rest-nap' && motion === 'daydream') {
    // Wake gently with the existing balanced eyes. The curious glyph's
    // unequal pupils and brows made this quiet beat look strained.
    const waking = ease(Math.min(1, Math.max(0, progress) / .7));
    return Object.freeze({ ...face, eyes: 'waiting', openness: .4 + .6 * waking });
  }
  if ((action?.id === 'rest-tea' && ['carry', 'organize', 'breathe'].includes(motion))
    || (action?.id === 'rest-nap' && motion === 'organize')) {
    return Object.freeze({ ...face, eyes: 'content', mouth: 'smile' });
  }
  if (action || (motion && motion !== 'idle')) return face;
  const phrase = EXPRESSION_PHRASES[expressionId];
  if (!phrase) return face;
  const period = phrase[0], elapsed = Math.max(0, expressionElapsedMs) % period;
  const distance = Math.min(...[.28, .68].map(edge => Math.abs(elapsed - period * edge)));
  const phraseEyes = KEEP_EYES.has(expressionId) ? base.eyes : phrase[1];
  const close = phraseEyes !== base.eyes && distance < 85 ? 1 - ease(distance / 85) : 0;
  return Object.freeze({ ...face,
    eyes: KEEP_EYES.has(expressionId) ? base.eyes : face.eyes,
    openness: (face.openness ?? 1) * (1 - close),
    mouth: distance < 34 ? 'closed' : face.mouth
  });
}

export { sampleUsagiFaceTiming };
