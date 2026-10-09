'use strict';

function createPetScene({
  context,
  art,
  resetEmitters = () => {},
  maxParticles = 240
} = {}) {
  if (!context || !art) throw new TypeError('pet scene drawing dependencies are required');

  function drawBackdrop(scene, calmVisual = false, paint = null) {
    if (scene && !paint?.(context)) art.drawBackdrop(context, scene, { calmVisual });
  }

  function drawSessionBackdrop(mode, activity, calmVisual = false, paint = null) {
    if (!paint?.(context)) art.drawSessionBackdrop(context, mode, activity, { calmVisual });
  }

  function resetParticles() {
    resetEmitters();
  }

  function limitParticles(particles) {
    const next = Array.isArray(particles) ? particles.filter(particle => particle && particle.life > 0) : [];
    return next.slice(-Math.max(0, Math.floor(maxParticles)));
  }

  return Object.freeze({ drawBackdrop, drawSessionBackdrop, resetParticles, limitParticles });
}

export { createPetScene };
export default Object.freeze({ createPetScene });
