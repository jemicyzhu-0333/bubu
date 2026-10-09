'use strict';

import { SCENES } from '../../../content/scenes.mjs';
import { pivotFor } from './dango-raster-pose.mjs';

const ROOM_COLORS = Object.freeze({
  focused: Object.freeze({ sky: ['#1d2a3b', '#18202e'], ground: '#2c3040' }),
  resting: Object.freeze({ sky: ['#29263d', '#1f2032'], ground: '#343044' })
});
const SCENE_PARTICLES = Object.freeze(['cloud', 'butterfly', 'star', 'firefly', 'plane', 'bird', 'petal',
  'dust', 'leaf', 'bubble', 'spark', 'dragonfly', 'bat', 'starDust', 'codeRain', 'note', 'rain', 'snow',
  'steam', 'mist', 'shootingStar', 'fish', 'light', 'pixel', 'sparkle', 'ember', 'flash', 'page']);
const particleTypes = new Set(SCENE_PARTICLES);

function sceneCoverage(manifest = {}) {
  const missingScenes = Object.keys(SCENES).filter(id => !manifest.scenes?.[id]?.layers?.length);
  const missingRooms = Object.keys(ROOM_COLORS).filter(id => !manifest.sessionScenes?.[id]?.layers?.length);
  const missingParticles = SCENE_PARTICLES.filter(id => !manifest.sceneParticles?.[id]);
  return Object.freeze({ complete: !missingScenes.length && !missingRooms.length && !missingParticles.length,
    missingScenes, missingRooms, missingParticles });
}

function createRasterScenePainter({ manifest, painter }) {
  function sceneParticle(context, value) {
    if (!particleTypes.has(value?.type)) return false;
    const sprite = manifest.sceneParticles?.[value.type];
    // A known raster scene never reintroduces the old block-shaped motif
    // while an asset is missing/loading. The coverage contract reports it.
    if (!sprite) return true;
    const life = Math.max(0, Math.min(1, value.life / (value.baseLife || value.life || 1)));
    if (!life) return true;
    const pivot = pivotFor(sprite), nominal = Math.max(sprite.rect[2], sprite.rect[3]);
    const sized = ['cloud', 'mist', 'bubble', 'flash', 'snow', 'dust', 'light', 'pixel', 'sparkle', 'ember'].includes(value.type);
    const diameter = (value.size || nominal) * (value.type === 'bubble' ? 2 : 1);
    const scale = sized ? Math.max(.1, diameter / nominal) : 1;
    painter.paint(context, sprite, {}, [scale, 0, 0, scale,
      value.x - pivot[0] * scale, value.y - pivot[1] * scale], life);
    return true;
  }

  function sceneBackdrop(context, { scene = null, mode = null, activity = null, calmVisual = false,
    elapsedMs = 0 } = {}) {
    const room = Object.hasOwn(ROOM_COLORS, mode) ? ROOM_COLORS[mode] : null;
    const registered = Object.hasOwn(SCENES, scene?.id) ? SCENES[scene.id] : null;
    if (!room && !registered) return false;
    const entry = room ? manifest.sessionScenes?.[mode] : manifest.scenes?.[registered.id];
    const colors = entry || room || registered;
    const skyColors = colors.sky || (room || registered).sky;
    context.save();
    context.globalAlpha *= room ? 1 : calmVisual ? .32 : .58;
    const gradient = context.createLinearGradient(0, 30, 0, 172);
    gradient.addColorStop(0, skyColors[0]); gradient.addColorStop(1, skyColors[1]);
    context.fillStyle = gradient; context.fillRect(20, 30, 180, 142);
    context.fillStyle = colors.ground || (room || registered).ground;
    context.fillRect(20, 140, 180, 32);
    for (const sprite of entry?.layers || []) painter.paint(context, sprite, {});
    if (mode === 'resting' && activity?.motion === 'daydream' && !calmVisual) {
      const drift = Math.sin(elapsedMs / 1800 * Math.PI * 2);
      for (const [x, y, size] of [[151, 60, 3], [160, 52, 5]]) {
        sceneParticle(context, { type: 'dust', x, y: y - drift, size, life: 1, baseLife: 1 });
      }
    }
    context.restore();
    return true;
  }
  return Object.freeze({ sceneBackdrop, sceneParticle, sceneCoverage: () => sceneCoverage(manifest) });
}

export { SCENE_PARTICLES, sceneCoverage, createRasterScenePainter };
