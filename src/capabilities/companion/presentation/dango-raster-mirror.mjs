'use strict';

import { combinationAccessory } from './combination-accessories.mjs';
import { applyPoint, IDENTITY } from './rig/pose.mjs';
import { footMatrix } from './dango-performance.mjs';
import { anchoredPawMatrix } from './dango-raster-paws.mjs';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const windowPulse = (phase, start, end, edge) => ease((phase - start) / edge) * ease((end - phase) / edge);
const isRasterMirror = action => ['mirror-music', 'mirror-ai'].includes(action?.id);

// These are quiet authored gestures on the activity clock. They do not claim
// access to the music's beat or to an AI request/response stage.
function sampleRasterMirror(action, progress = 0, frozen = false) {
  if (!isRasterMirror(action)) return null;
  const still = frozen || action.mirrorPresentation?.static === true;
  const p = still ? .5 : clamp(action.mirrorPresentation?.loopProgress ?? progress);
  const gain = still ? 0 : clamp(action.propOpacity ?? 1);
  const music = action.id === 'mirror-music';
  const phase = (p * (music ? 6 : 5)) % 1;
  const pulse = Math.sin(p * TAU * (music ? 6 : 5));
  const typing = music ? 0 : windowPulse(phase, .02, .5, .09);
  const attentive = music ? 0 : windowPulse(phase, .64, .98, .1);
  const lifecycle = action.mirrorPresentation?.phase;
  const settle = still ? 0 : (1 - gain) * (lifecycle === 'enter' ? -2 : lifecycle === 'exit' ? 3 : 0);
  return Object.freeze({ music, still, progress: p, gain,
    settle,
    nod: gain * (music ? pulse * .45 : attentive * Math.sin(phase * TAU) * .32),
    tilt: gain * (music ? Math.sin(p * TAU * 3) * .009 : pulse * .003),
    toe: music ? gain * Math.max(0, pulse) * .55 : 0,
    paw: music ? gain * (1 - Math.cos(p * TAU * 3)) * .22 : 0,
    tapLeft: gain * typing * Math.sin(p * TAU * 45) * .48,
    tapRight: gain * typing * Math.sin(p * TAU * 45 + Math.PI) * .48,
    buddyTilt: music ? 0 : gain * Math.sin(p * TAU * 5) * .018,
    eyeY: music ? 0 : gain * typing * .28 });
}

function refineMirrorContact(contact, action, view, toolSprites, mirror) {
  if (!contact || !mirror) return contact;
  // The AI's viewer-facing exterior lid has already been resolved by browse.
  // Remove the old synthetic thinking dots: only observed app category is known.
  contact.details = [];
  if (!mirror.music) {
    for (const tool of contact.tools) tool.y += mirror.settle;
    // A fictional collaborator, not a claim about an AI service's current phase.
    // Its notebook, visor, antenna and limbs remain one saved RGBA layer, under
    // the same loading/lifecycle decision as the laptop and the pet's tiny fins.
    const buddy = toolSprites?.['ai-robot-buddy'];
    const buddyHeight = buddy?.height || 0;
    contact.tools.push({ key: 'ai-robot-buddy', x: 78, y: 64 - buddyHeight + mirror.settle,
      layer: 'front', pivot: [(buddy?.width || 0) / 2, buddyHeight], rotate: mirror.buddyTilt });
    for (const hand of contact.hands) {
      const tap = (hand.side === 'left' ? mirror.tapLeft : mirror.tapRight) + mirror.settle;
      if (!hand.pawMatrix) continue;
      hand.pawMatrix = Object.freeze([...hand.pawMatrix.slice(0, 5), hand.pawMatrix[5] + tap]);
      hand.gripPoint = [hand.gripPoint[0], hand.gripPoint[1] + tap];
      hand.points = hand.points.map(point => [point[0], point[1] + tap]);
    }
    return contact;
  }
  const angled = view !== 'front', variant = angled ? 'three-quarter' : 'front';
  contact.tools = [
    { key: `headphones-${variant}-band`, x: angled ? -2 : -3.2, y: -8 + mirror.settle,
      layer: 'back', behindAnatomy: true },
    ...(angled ? [
      { key: 'headphones-three-quarter-near', x: -9, y: 17.5 + mirror.settle, layer: 'front' },
      { key: 'headphones-three-quarter-far', x: 62, y: 19 + mirror.settle, layer: 'front' }
    ] : [{ key: 'headphones-front-cups', x: -7.5, y: 18 + mirror.settle, layer: 'front' }])
  ];
  const fin = toolSprites?.['small-fin'];
  const target = [angled ? 1.5 : 64, (angled ? 32 : 31.5) + mirror.paw + mirror.settle];
  const matrix = anchoredPawMatrix(fin?.anchors?.grip || [7.4, 3.6], target, { rotation: angled ? -2.2 : -.68 });
  const root = applyPoint(matrix, ...(fin?.anchors?.root || [0, 2.85]));
  contact.hands = [{ side: angled ? 'left' : 'right', pawSprite: 'small-fin', connector: false, attachedArm: false,
    integrated: false, gripPoint: target, pawMatrix: matrix,
    points: [root, root, target], opacity: clamp(action.propOpacity ?? 1) }];
  return contact;
}


// Secondary layers reuse the exact approved prop sprites. The primary contact,
// hands, face, feet and body sample are deliberately left intact.
function appendCombinationAccessories(contact, action, view, toolSprites) {
  const headphones = combinationAccessory(action, 'headphones');
  const robot = combinationAccessory(action, 'robot');
  if (!headphones && !robot) return contact;
  const result = contact || { tools: [], hands: [], details: [], layer: 'front', phase: .5 };
  const existing = new Set(result.tools.map(item => item.key));
  if (headphones && ![...existing].some(key => key.startsWith('headphones-'))) {
    const angled = view !== 'front', variant = angled ? 'three-quarter' : 'front';
    result.tools.push({ key: `headphones-${variant}-band`, x: angled ? -2 : -3.2, y: -8,
      layer: 'back', behindAnatomy: true },
    ...(angled ? [
      { key: 'headphones-three-quarter-near', x: -9, y: 17.5, layer: 'front' },
      { key: 'headphones-three-quarter-far', x: 62, y: 19, layer: 'front' }
    ] : [{ key: 'headphones-front-cups', x: -7.5, y: 18, layer: 'front' }]));
  }
  if (robot && !existing.has('ai-robot-buddy')) {
    const sprite = toolSprites?.['ai-robot-buddy'];
    result.tools.push({ key: 'ai-robot-buddy', x: 78, y: 64 - (sprite?.height || 0), layer: 'front' });
  }
  for (const item of result.tools) {
    if (!existing.has(item.key)) {
      item.contextAccessory = true;
      if (!isRasterMirror(action)) item.persistent = true;
    }
  }
  return result;
}

function mirrorFeet(anchors, mirror) {
  if (!mirror) return null;
  return Object.freeze({ 'foot-left': IDENTITY,
    'foot-right': footMatrix(anchors['foot-right'], { x: 0, y: -mirror.toe, r: mirror.toe * .035 }) });
}

function paintMirrorRearProps(context, artwork, action, palette, { manifest, painter, toolMatrix }) {
  if (!artwork.actionReady) return false;
  let painted = false;
  for (const item of artwork.contact?.tools || []) {
    if (!item.behindAnatomy) continue;
    const sprite = manifest.tools[item.key];
    if (sprite) painted = painter.paint(context, sprite, palette, toolMatrix(item, sprite),
      (item.opacity ?? 1) * (item.persistent ? 1 : action?.propOpacity ?? 1)) || painted;
  }
  return painted;
}

export { isRasterMirror, sampleRasterMirror, refineMirrorContact, mirrorFeet, paintMirrorRearProps, appendCombinationAccessories };
