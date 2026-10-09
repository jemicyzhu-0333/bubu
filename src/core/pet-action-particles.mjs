'use strict';
import { paintVectorShapes } from './pet-vector-paint.mjs';

// Existing particle timing and physics remain in the renderer. This module
// owns only appearance: the old artist is preserved for Usagi, while Dango's
// native materials get curved, softly fading marks instead of coarse blocks.
function drawLegacyParticle(octx, p) {
  if (p.type === 'heart') { octx.fillStyle = p.color; octx.font = '12px monospace'; octx.globalAlpha = p.life / 40; octx.fillText('❤', p.x, p.y); octx.globalAlpha = 1; }
  else if (p.type === 'sweat') { octx.fillStyle = p.color; octx.fillRect(p.x, p.y, 2, 3); }
  else if (p.type === 'flash') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillRect(p.x - 2, p.y - 2, 5, 5); octx.globalAlpha = 1; }
  else if (p.type === 'bubble') { octx.strokeStyle = p.color; octx.globalAlpha = p.life / p.baseLife; octx.strokeRect(p.x, p.y, p.size, p.size); octx.globalAlpha = 1; }
  else if (p.type === 'note') { octx.fillStyle = p.color; octx.font = '12px monospace'; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillText(p.glyph || '♪', p.x, p.y); octx.globalAlpha = 1; }
  else if (p.type === 'star') { octx.fillStyle = p.color; octx.font = '12px monospace'; octx.globalAlpha = p.life / p.baseLife; octx.fillText('✦', p.x, p.y); octx.globalAlpha = 1; }
  else if (p.type === 'sparkle') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); const s = 1 + Math.round((p.life / p.baseLife) * 2); octx.fillRect(p.x - s, p.y, s * 2 + 1, 1); octx.fillRect(p.x, p.y - s, 1, s * 2 + 1); octx.globalAlpha = 1; }
  else if (p.type === 'spark') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillRect(p.x, p.y, 2, 2); octx.fillRect(p.x - Math.sign(p.vx), p.y - Math.sign(p.vy), 1, 1); octx.globalAlpha = 1; }
  else if (p.type === 'ring') { const grow = (1 - p.life / p.baseLife) * 7 + 2; octx.strokeStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife) * 0.9; octx.strokeRect(p.x - grow, p.y - grow, grow * 2, grow * 2); octx.globalAlpha = 1; }
  else if (p.type === 'petal') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillRect(p.x, p.y, 3, 2); octx.fillRect(p.x + 1, p.y - 1, 2, 1); octx.globalAlpha = 1; }
  else if (p.type === 'leaf') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillRect(p.x, p.y, 3, 2); octx.fillRect(p.x + 2, p.y + 1, 1, 2); octx.globalAlpha = 1; }
  else if (p.type === 'rainbow') { octx.fillStyle = p.color; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillRect(p.x, p.y, 3, 3); octx.globalAlpha = 1; }
  else if (p.type === 'z') { octx.fillStyle = p.color; octx.font = 'bold 10px monospace'; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillText('z', p.x, p.y); octx.globalAlpha = 1; }
  else if (p.type === 'letter') { octx.fillStyle = p.color; octx.font = '11px monospace'; octx.globalAlpha = Math.max(0, p.life / p.baseLife); octx.fillText(p.glyph || '·', p.x, p.y); octx.globalAlpha = 1; }
  else if (p.type === 'puff' || p.type === 'crumb' || p.type === 'thread') { octx.fillStyle = p.color; octx.fillRect(p.x, p.y, p.size || 3, p.size || 3); }
  else if (p.type === 'trail') { octx.strokeStyle = p.color; octx.globalAlpha = p.life / p.baseLife; octx.strokeRect(p.x, p.y, 5, 2); octx.globalAlpha = 1; }
}

const CIRCLE = 'M-1 0A1 1 0 1 0 1 0A1 1 0 1 0 -1 0Z';
const LOCAL_EFFECTS = Object.freeze({
  'sip-tea': 'steam', 'rest-tea': 'steam', 'tiny-chef': 'steam',
  'dig-treasure': 'dust', sweep: 'dust', 'pit-fall': 'dust',
  'paper-plane': 'trail', moonwalk: 'trail', 'chase-laser': 'trail'
});
function drawSoftParticle(context, particle) {
  if (LOCAL_EFFECTS[particle.actionId] === particle.effect && particle.effect) return true;
  const p = particle, life = Math.max(0, Math.min(1, p.life / (p.baseLife || 40)));
  if (!life) return true;
  const color = p.color || '#e4c48a', size = Math.max(1.2, Math.min(6, p.size || 3));
  context.save(); context.translate(p.x, p.y); context.globalAlpha *= life;
  const shape = (d, fill = color, stroke = 'none', width = .8) => paintVectorShapes(context, [{ d, fill, stroke, width }], {});
  const oval = (rx, ry, fill = color, stroke = 'none', width = .8) => {
    context.save(); context.scale(rx, ry); shape(CIRCLE, fill, stroke, width / Math.max(rx, ry)); context.restore();
  };
  switch (p.type) {
    case 'puff':
      context.globalAlpha *= .58;
      shape('M-4 1C-6-2-2-5 0-3C3-5 6-2 4 1C4 4-2 4-4 1Z'); break;
    case 'crumb': oval(size * .55, size * .38); break;
    case 'sweat': shape('M0-3C-1-1-2.7 1-1.3 2.5C0 4 2.5 2.6 2 1C1.6-.3.6-1.8 0-3Z'); break;
    case 'bubble': oval(size * .65, size * .65, 'none', color, .75); break;
    case 'ring': {
      const radius = 2 + (1 - life) * 5; context.globalAlpha *= .7; oval(radius, radius * .55, 'none', color, .8); break;
    }
    case 'sparkle': case 'flash':
      context.scale(1 + life, 1 + life); shape('M-2.2 0H2.2M0-2.2V2.2', 'none', color, .7); break;
    case 'star': shape('M0-4L1.2-1.4L4-1L2 1L2.5 4L0 2.6L-2.5 4L-2 1L-4-1L-1.2-1.4Z'); break;
    case 'spark': shape(`M0 0L${-Math.sign(p.vx) * 2.5} ${-Math.sign(p.vy) * 2.5}`, 'none', color, 1); break;
    case 'heart': shape('M0 3.8C-2.7 1.9-5-1.1-2.8-2.8C-1.6-3.7-.5-2.9 0-1.8C1-4 4-3.6 4-.8C4 1.2 1.8 2.5 0 3.8Z'); break;
    case 'petal': case 'leaf':
      shape('M-3 1Q-2-3 3-2Q3 3-3 1Z'); shape('M-2.5 1L2-1.5', 'none', '#ffffff88', .35); break;
    case 'rainbow': shape('M-2 1Q0-2 2 1', 'none', color, 1.4); break;
    case 'thread': shape('M-3 1Q-1-2 1 0Q3 2 4-1', 'none', color, .85); break;
    case 'trail': shape('M-3 1Q0 2 3 0', 'none', color, .7); break;
    case 'note':
      oval(1.8, 1.2); shape('M1.5 0V-6Q4-6 4.5-3', 'none', color, 1.1); break;
    case 'z': shape('M-2-2H2L-2 2H2', 'none', color, .9); break;
    case 'letter':
      context.fillStyle = color; context.font = '10px sans-serif'; context.fillText(p.glyph || '·', -2, 2); break;
    default: context.restore(); return false;
  }
  context.restore(); return true;
}
function drawActionParticle(context, particle, { soft = false } = {}) {
  return soft ? drawSoftParticle(context, particle) : drawLegacyParticle(context, particle);
}
export { drawActionParticle, LOCAL_EFFECTS };
