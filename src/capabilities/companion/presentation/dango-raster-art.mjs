'use strict';

import { sampleGroundedMoonwalk } from './grounded-moonwalk.mjs';

import { createDangoRunSample } from './clips/dango-run-sample.mjs';
import { PALETTES } from '../../../core/pet-art.mjs';
import petActionArt from '../../../core/pet-action-art.mjs';
import { resolveDangoView } from '../../../core/dango-view-policy.mjs';
import { applyRunningTransform } from '../../../core/pet-running-pose.mjs';
import { validateRasterManifest, collectRasterSprites, rasterView, PART_NAMES } from './raster/schema.mjs';
import { createRasterSource } from './raster/source.mjs';
import { createRasterPainter } from './raster/paint.mjs';
import { sampleRasterPose } from './dango-raster-pose.mjs';
import { paintRasterPaws } from './dango-raster-paws.mjs';
import { drawRasterFace } from './dango-raster-face.mjs';
import { drawRasterActions, toolMatrix } from './dango-raster-actions.mjs';
import { createRasterWardrobe, isScarfHeadwearCombination } from './dango-raster-appearance.mjs';
import { createRasterParticlePainter } from './dango-raster-particles.mjs';
import { createRasterScenePainter } from './dango-raster-scenes.mjs';
import { requestedEyes } from './rig/face.mjs';
import { multiply, applyPoint } from './rig/pose.mjs';
import { pivotFor } from './dango-raster-pose.mjs';
import { hasRasterLookback, sampleRasterLookback } from './dango-raster-lookback.mjs';
import { withRasterGroundClip } from './dango-raster-ground.mjs';
import { createRasterRootPainter } from './dango-raster-roots.mjs';
import { createRasterTailRootPainter } from './dango-raster-tail-root.mjs';
import { sampleRasterMirror } from './dango-raster-mirror.mjs';

const SUPPORTED_PROPS = new Set(['none', 'headband', 'butterfly', 'cup', 'balls', 'energy', 'hole', 'mirror',
  'microphone', 'ellipsis', 'laser', 'treasure', 'sleep-cap', 'tissue', 'bubble-wand', 'cushion', 'high-five',
  'music-notes', 'binoculars', 'tail', 'book', 'document', 'keyboard', 'plane', 'broom', 'hat', 'telescope',
  'watering-can', 'yarn', 'drum', 'sparkle-shoes', 'box', 'blocks', 'star', 'umbrella', 'picnic', 'gloves',
  'pan', 'camera', 'laptop', 'ai-chat', 'notes', 'chart', 'pillow', 'plant']);

function essentials(data) {
  return [data.body, ...PART_NAMES.map(name => data.parts[name]),
    ...(data.rootJoins ? [data.rootJoins.outline, ...Object.values(data.rootJoins.fills)] : []),
    ...(data.face?.eyes?.neutral || []), ...(data.face?.eyes?.closed || []), data.face?.mouth?.neutral].filter(Boolean);
}

function createDangoRasterArtist({ manifest, loadImage, createSurface, sourceOptions = {}, painterOptions = {}, runClip = null, runFootTiming = null } = {}) {
  validateRasterManifest(manifest);
  if (![null, 'forward-recovery'].includes(runFootTiming)) throw new TypeError('unknown run foot timing');
  const source = createRasterSource({ ...sourceOptions, baseUrl: manifest.baseUrl, versionKey: `${manifest.id}@${manifest.version}`, loadImage });
  const painter = createRasterPainter({ ...painterOptions, source, createSurface });
  const roots = createRasterRootPainter({ painter });
  const tailRoot = createRasterTailRootPainter({ manifest, painter });
  const runSample = runClip ? createDangoRunSample({ bundle: runClip, source, createSurface }) : null;
  const wardrobe = createRasterWardrobe({ manifest, painter, source });
  const palette = skinId => PALETTES[skinId] || PALETTES.pink;
  const key = `dango-raster:${manifest.id}@${manifest.version}`;
  const toolSprites = Object.fromEntries(Object.entries(manifest.tools || {}).map(([id, sprite]) =>
    [id, { width: sprite.rect[2], height: sprite.rect[3], anchors: sprite.anchors }]));
  const defaultSprites = Object.values(manifest.views).flatMap(data => [data.neutral, ...essentials(data)]);

  function resolveView(requested, options = {}) {
    // Explicit approved left/right views are useful for static previews.
    // Runtime actions keep the semantic canonical view and renderer facing.
    if (!options.action && ['three-quarter-left', 'three-quarter-right'].includes(requested) && manifest.views[requested]) return requested;
    return resolveDangoView(requested, options);
  }
  function resolveArtwork(options = {}) {
    const view = resolveView(options.view || 'front', options);
    const resolved = rasterView(manifest, view), original = resolved.data;
    const running = options.motion === 'dash' && !options.calmVisual && options.state !== 'dragged';
    const variant = running && original.variants?.running;
    const data = variant ? { ...original, ...variant, parts: { ...original.parts, ...variant.parts },
      anchors: { ...original.anchors, ...variant.anchors } } : original;
    const lookback = sampleRasterLookback(manifest, data, options);
    const outfitItems = options.appearance?.items || [];
    const reviewedRunOutfit = !outfitItems.length || outfitItems.length === 1
      && outfitItems[0].id === 'milestone.scarf' && outfitItems[0].renderKey === 'scarf'
      && (outfitItems[0].formId || 'dango') === 'dango' || isScarfHeadwearCombination(outfitItems);
    const footTiming = runFootTiming && !runClip && options.action?.id === 'chase-laser'
      && options.motion === 'dash' && !options.calmVisual && !options.reducedMotion && options.state !== 'dragged'
      && view === 'three-quarter' && [undefined, 'three-quarter', 'profile'].includes(options.view)
      && reviewedRunOutfit ? runFootTiming : null;
    let pose = sampleRasterPose(data, { ...options, view, toolSprites, lookback, runFootTiming: footTiming });
    // Optional concurrent layers must not take the selected focus tool or hands
    // away while loading/failing. Only the small accessory group waits together.
    const accessoryTools = pose.contact?.tools.filter(item => item.contextAccessory) || [];
    const missingAccessories = accessoryTools.filter(item => !manifest.tools?.[item.key]).map(item => item.key);
    const accessoryStates = accessoryTools.filter(item => manifest.tools?.[item.key])
      .map(item => source.state(manifest.tools[item.key]));
    const accessoriesReady = !missingAccessories.length && accessoryStates.every(state => state === 'ready');
    if (!accessoriesReady) pose = { ...pose, contact: { ...pose.contact,
      tools: pose.contact.tools.filter(item => !item.contextAccessory) } };
    const attachmentMatrices = { ...pose.matrices };
    for (const foot of ['foot-left', 'foot-right']) {
      const current = data.anchors[foot], rest = original.anchors[foot];
      const currentRect = data.parts[foot].rect, restRect = original.parts[foot].rect;
      const soleShift = currentRect[1] + currentRect[3] - restRect[1] - restRect[3];
      attachmentMatrices[foot] = multiply(pose.matrices[foot], [1, 0, 0, 1, current.x - rest.x, soleShift]);
    }
    let footwearTransforms = Object.freeze(Object.fromEntries(['foot-left', 'foot-right'].map(foot => [foot, Object.freeze(attachmentMatrices[foot])])));
    const coreSprites = essentials(data);
    const required = [];
    const eyeName = requestedEyes(pose.face, false), mouthName = pose.face?.mouth || 'neutral';
    required.push(...(data.face?.eyes?.[eyeName] || []));
    if (data.face?.mouth?.[mouthName]) required.push(data.face.mouth[mouthName]);
    source.get(original.neutral);
    const coreStates = coreSprites.map(sprite => source.state(sprite));
    const layeredReady = coreStates.every(state => state === 'ready');
    const states = required.map(sprite => source.state(sprite));
    const requestedTools = pose.contact?.tools.map(item => manifest.tools?.[item.key]).filter(Boolean) || [];
    const toolStates = requestedTools.map(sprite => source.state(sprite));
    const requestedPaws = [...new Set(pose.contact?.hands.map(hand => hand.pawSprite).filter(Boolean) || [])];
    const pawStates = requestedPaws.filter(key => manifest.tools?.[key]).map(key => source.state(manifest.tools[key]));
    const missingPaws = requestedPaws.filter(key => !manifest.tools?.[key]).map(key => `paw:${key}`);
    const needsConnector = Boolean(pose.contact?.hands.some(hand => !hand.pawSprite && !hand.integrated && hand.connector !== false));
    const connectorStates = needsConnector && data.parts.arm ? [source.state(data.parts.arm)] : [];
    const missingConnectors = needsConnector && !data.parts.arm ? ['parts:arm'] : [];
    const missingTools = pose.contact?.tools.filter(item => !manifest.tools?.[item.key]).map(item => item.key) || [];
    if (options.action?.prop && !SUPPORTED_PROPS.has(options.action.prop)) missingTools.push(`unsupported-prop:${options.action.prop}`);
    const requestedDetails = pose.contact?.details.map(detail => manifest.effects?.[detail.type]).filter(Boolean) || [];
    const extras = [options.accent && options.accent !== 'none' ? options.accent : null,
      options.action?.prop === 'sparkle-shoes' ? 'glint' : null].filter(Boolean);
    const extraStates = extras.filter(id => manifest.effects?.[id]).map(id => source.state(manifest.effects[id]));
    const missingExtras = extras.filter(id => !manifest.effects?.[id]);
    const detailStates = requestedDetails.map(sprite => source.state(sprite));
    const missingDetails = pose.contact?.details.filter(detail => !manifest.effects?.[detail.type]).map(detail => detail.type) || [];
    const actionReady = !missingTools.length && !missingConnectors.length && !missingPaws.length
      && [...toolStates, ...connectorStates, ...pawStates].every(state => state === 'ready');
    if (!actionReady && options.action?.id === 'workout') {
      const matrices = { ...pose.matrices };
      for (const foot of ['foot-left', 'foot-right']) {
        matrices[foot] = Object.freeze([1, 0, 0, 1, 0, 0]); attachmentMatrices[foot] = matrices[foot];
      }
      pose = { ...pose, matrices: Object.freeze(matrices) };
      footwearTransforms = Object.freeze(Object.fromEntries(['foot-left', 'foot-right'].map(foot => [foot, matrices[foot]])));
    }
    const actionHeadwear = layeredReady && ['headband', 'sleep-cap'].includes(options.action?.prop)
      && actionReady && !missingDetails.length && detailStates.every(state => state === 'ready');
    const suppressedAppearanceSlots = Object.freeze(actionHeadwear ? ['headwear'] : []);
    const wardrobeState = wardrobe.resolveOutfit(options.appearance, view, suppressedAppearanceSlots);
    const outfitStates = wardrobeState.states, missingOutfit = wardrobeState.missing;
    const hiddenParts = wardrobeState.hiddenParts;
    const ready = layeredReady && states.every(state => state === 'ready') && actionReady
      && !missingDetails.length && detailStates.every(state => state === 'ready') && wardrobeState.ready
      && !missingExtras.length && extraStates.every(state => state === 'ready') && accessoriesReady;
    // The inspected 13x26 wand has its ring centre at (6.5, 6), independent
    // of its lower grip anchor. The renderer projects this through the body.
    const wand = options.action?.id === 'bubble-blow' && actionReady
      ? pose.contact?.tools.find(item => item.key === 'bubble-wand') : null;
    const hiccupCup = options.action?.id === 'hiccup' && actionReady
      ? pose.contact?.tools.find(item => item.key === 'cup') : null;
    const effectOrigins = Object.freeze(wand ? { bubbles: Object.freeze(applyPoint(
      toolMatrix(wand, manifest.tools['bubble-wand']), 6.5, 6)) } : hiccupCup ? { bubbles: Object.freeze(applyPoint(
      toolMatrix(hiccupCup, manifest.tools.cup), ...(manifest.tools.cup.anchors?.rim || [10, 3]))) } : {});
    const clipSelection = runSample?.resolve(options, view, ready);
    const clip = clipSelection?.clip || null;
    const revision = source.stats().revision;
    // The body bitmap depends only on physical layers, never expressive
    // eyes, tools, wardrobe requests or their unrelated async completion.
    const bodyReadiness = [...coreStates, source.state(original.neutral)].map(state => state[0]).join('');
    return Object.freeze({ kind: 'dango-raster', key: `${key}|${clip ? `clip:${clip.clipId}@${clip.contentVersion}:${clip.poseId}` : variant ? 'running' : 'rest'}|load:${bodyReadiness}|hide:${[...hiddenParts].join(',')}`,
      clip, clipStatus: clipSelection?.status || 'disabled', runFootTiming: footTiming, view, drawnView: resolved.key,
      expressionId: options.expressionId, data, neutral: original.neutral, ...pose, lookback, footwearTransforms, attachmentMatrices: Object.freeze(attachmentMatrices),
      hiddenParts, ready, layeredReady, wardrobe: wardrobeState, effectOrigins,
      pawRootsCovered: outfitItems.some(item => ['scarf', 'cape', 'satchel'].includes(item.renderKey)),
      suppressedAppearanceSlots,
      pending: [...coreStates, ...states, ...toolStates, ...connectorStates, ...pawStates, ...detailStates, ...outfitStates, ...extraStates, ...accessoryStates].includes('loading'), running,
      actionReady, accessoriesReady, missingAssets: Object.freeze([...missingTools, ...missingConnectors, ...missingPaws, ...missingDetails, ...missingOutfit, ...missingExtras, ...missingAccessories]),
      sourceRevision: revision });
  }
  function artworkFor(artwork, view) {
    return artwork?.kind === 'dango-raster' ? artwork : resolveArtwork({ view });
  }
  function body(context, colors, view, artwork, { fit = false, cache = false } = {}) {
    const resolved = artworkFor(artwork, view);
    if (resolved.clip) return runSample.paint(context, resolved.clip, colors);
    if (!resolved.layeredReady) return painter.paint(context, resolved.neutral, colors);
    if (fit) for (const name of ['ear-left', 'ear-right', 'foot-left', 'foot-right']) {
      if (!resolved.hiddenParts.includes(name)) painter.paint(context, resolved.data.parts[name], colors);
    }
    const draw = () => painter.paint(context, resolved.data.body, colors);
    const painted = cache ? draw() : withRasterGroundClip(context, resolved, () => {
      const painted = draw(); roots.paint(context, resolved, colors); tailRoot.paint(context, resolved, colors);
      paintRasterPaws(context, resolved, colors, { manifest, painter }, 'underlay'); return painted;
    });
    return painted;
  }
  function face(context, colors, expression, blinking, view, _faceRig, artwork) {
    const resolved = artworkFor(artwork, view);
    context.save();
    if (resolved.clip) context.transform(...resolved.clip.faceTransform);
    try { return withRasterGroundClip(context, resolved, () => drawRasterFace(context, resolved, expression, blinking, colors, { painter, source })); }
    finally { context.restore(); }
  }
  function action(context, options) {
    const artwork = artworkFor(options.artwork, options.view);
    const actionArtwork = artwork.clip ? { ...artwork, hiddenParts: ['ear-left', 'ear-right', 'foot-left', 'foot-right'],
      contact: artwork.contact ? { ...artwork.contact, hands: [] } : null } : artwork;
    const painted = drawRasterActions(context, { ...options, artwork: actionArtwork }, { manifest, painter });
    if (options.layer !== 'front' || options.action?.prop !== 'sparkle-shoes' || !artwork.layeredReady) return painted;
    const sprite = manifest.effects?.glint;
    if (!sprite) return painted;
    const pivot = pivotFor(sprite);
    for (const side of ['foot-left', 'foot-right']) {
      const anchor = artwork.anchors[side];
      const at = [1, 0, 0, 1, anchor.x - pivot[0], anchor.y + 3 - pivot[1]];
      painter.paint(context, sprite, options.palette, multiply(artwork.matrices[side], at),
        artwork.calmVisual ? .7 : .55 + .35 * Math.sin(artwork.progress * Math.PI * 6) ** 2);
    }
    return true;
  }
  function motionOffset(motion, progress, calmVisual, options = {}) {
    if (options.action?.id === 'paper-return') return { x: 0, y: 0 };
    if (motion === 'moonwalk') return { x: sampleGroundedMoonwalk(progress, calmVisual).x, y: 0 };
    const mirror = sampleRasterMirror(options.action, progress, calmVisual || options.reducedMotion || options.state === 'dragged');
    if (mirror) return Object.freeze({ x: 0, y: mirror.nod });
    if (motion === 'dash' && options.state === 'dragged') return Object.freeze({ x: 0, y: 0 });
    const offset = petActionArt.bodyOffset(options.action, progress, { ...options, calmVisual, bodySize: 66 });
    const amount = options.action?.id === 'workout' ? .45 : options.action?.id === 'hiccup' ? .35 : 1;
    return Object.freeze({ ...offset, y: offset.y * amount });
  }
  function applyMotionTransform(context, motion, progress, options = {}) {
    const mirror = options.artwork?.mirror || sampleRasterMirror(options.action, progress, options.calmVisual || options.reducedMotion || options.state === 'dragged');
    if (mirror) { context.rotate(mirror.tilt); return; }
    if (options.action?.id === 'paper-return') return;
    if (options.artwork?.clip || hasRasterLookback(options.action) || ['pushup', 'moonwalk'].includes(motion)) return;
    if (motion === 'dash') return applyRunningTransform(context, progress,
      { ...options, calmVisual: options.calmVisual || options.state === 'dragged' });
    return petActionArt.applyBodyTransform(context, options.action, progress, options);
  }
  function expressionAccent(context, accent, { elapsedMs = 0, calmVisual = false } = {}) {
    const sprite = manifest.effects?.[accent]; if (!sprite) return 0;
    const drift = calmVisual ? 0 : Math.sin(elapsedMs / 1500 * Math.PI * 2) * 1.2;
    return painter.paint(context, sprite, PALETTES.pink, [1, 0, 0, 1, 0, -drift]) ? 1 : 0;
  }
  function statusEffect(context, status, { elapsedMs = 0, calmVisual = false } = {}) {
    if (!['hungry', 'coffee'].includes(status)) return false;
    const sprite = manifest.effects?.[status];
    if (sprite) painter.paint(context, sprite, PALETTES.pink,
      [1, 0, 0, 1, 0, calmVisual ? 0 : Math.sin(elapsedMs / 2200 * Math.PI * 2) * .8]);
    return true;
  }
  return Object.freeze({ resolveArtwork, resolveView, palette, body, face, action, clipBody: withRasterGroundClip,
    bodyForeground: (context, colors, artwork) => {
      if (artwork?.clip) return false;
      const tail = tailRoot.paint(context, artwork, colors);
      const root = roots.paint(context, artwork, colors);
      const paw = paintRasterPaws(context, artwork, colors, { manifest, painter }, 'underlay');
      return paw || root || tail;
    },
    faceForView: face => face, subscribeArtwork: source.subscribe,
    appearance: (context, options) => withRasterGroundClip(context, options.artwork, () => wardrobe.appearance(context, options)),
    appearanceLayers: wardrobe.appearanceLayers, portraitBounds: wardrobe.portraitBounds, motionOffset, applyMotionTransform,
    particle: createRasterParticlePainter({ manifest, painter }),
    ...createRasterScenePainter({ manifest, painter }),
    expressionAccent, statusEffect, actionOverlay: (_context, action) => ['mirror-meet', 'hiccup'].includes(action?.id),
    ready({ all = false } = {}) { return Promise.all([source.ready(all ? collectRasterSprites(manifest) : defaultSprites), runSample?.ready()]); },
    cacheStats() { return Object.freeze({ source: source.stats(), palette: painter.stats(), roots: roots.stats(), tailRoot: tailRoot.stats(), runSample: runSample?.stats() || null }); },
    dispose() { source.dispose(); painter.dispose(); roots.dispose(); tailRoot.dispose(); runSample?.dispose(); }
  });
}

export { createDangoRasterArtist };
