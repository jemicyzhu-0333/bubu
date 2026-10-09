'use strict';

function createPetEffects({ context, motion, maxParticles = 160 } = {}) {
  if (!context) throw new TypeError('effect context is required');
  if (!motion || typeof motion.advanceDiscretePosition !== 'function') {
    throw new TypeError('effect motion adapter is required');
  }

  function limitParticles(particles) {
    if (!Array.isArray(particles)) return [];
    return particles.filter(particle => particle && particle.life > 0).slice(-Math.max(0, Math.floor(maxParticles)));
  }

  function advanceParticle(particle, step) {
    if (!particle || !Number.isFinite(step)) return particle;
    particle.x += (Number(particle.vx) || 0) * step;
    const gravity = Number(particle.gravity) || 0;
    particle.y = motion.advanceDiscretePosition(particle.y, particle.vy, gravity, step);
    particle.vy = (Number(particle.vy) || 0) + gravity * step;
    particle.life -= step;
    return particle;
  }

  function drawParticle(particle) {
    if (!particle || particle.life <= 0) return;
    const alpha = Number.isFinite(particle.baseLife) && particle.baseLife > 0
      ? Math.max(0, Math.min(1, particle.life / particle.baseLife))
      : 1;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = particle.color || '#c0caf5';
    if (particle.type === 'bubble') {
      context.strokeStyle = particle.color || '#c0caf5';
      context.strokeRect(particle.x, particle.y, particle.size || 4, particle.size || 4);
    } else if (particle.type === 'note' || particle.type === 'heart' || particle.type === 'star') {
      context.font = '12px monospace';
      context.fillText(particle.glyph || (particle.type === 'heart' ? '❤' : particle.type === 'star' ? '✦' : '♪'), particle.x, particle.y);
    } else {
      context.fillRect(particle.x, particle.y, particle.size || 3, particle.size || 3);
    }
    context.restore();
  }

  function drawOverlay(particles, { calmVisual = false, step = 0 } = {}) {
    context.clearRect(0, 0, context.canvas?.width || 220, context.canvas?.height || 220);
    if (calmVisual) return [];
    const next = limitParticles(particles);
    for (const particle of next) {
      advanceParticle(particle, step);
      drawParticle(particle);
    }
    return limitParticles(next);
  }

  return Object.freeze({ limitParticles, advanceParticle, drawParticle, drawOverlay });
}

export { createPetEffects };
export default Object.freeze({ createPetEffects });
