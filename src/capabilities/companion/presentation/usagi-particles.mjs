'use strict';

import { drawActionParticle } from '../../../core/pet-action-particles.mjs';

// Same emitter timing and physics, with the curved marks used by the native
// character. Cup/pan steam is already attached to the actual utensil rim.
function drawUsagiParticle(context, particle) {
  if (particle.effect === 'steam' && ['sip-tea', 'rest-tea', 'tiny-chef'].includes(particle.actionId)) return true;
  return drawActionParticle(context, { ...particle, actionId: undefined }, { soft: true });
}

export { drawUsagiParticle };
