'use strict';

import { sampleDangoWalkEpisode, sampleDangoStepInPlaceEpisode } from './dango-walk.mjs';
import { DANGO_SOURCE_WALK as C, DANGO_WALK_WORKBENCH } from '../../../../content/companion/gait/dango-walk.mjs';

const FEET = Object.freeze(['foot-left', 'foot-right']);
const SIDES = Object.freeze(['near', 'far']);
const translation = (x, y) => Object.freeze([1, 0, 0, 1, x, y]);
const addTranslation = (matrix, x, y) => Object.freeze([...matrix.slice(0, 4), matrix[4] + x, matrix[5] + y]);
const fallback = (artwork, reason) => Object.freeze({ ...artwork, walk: null, walkStatus: reason });

// PET_VISUAL「舞台与坐标契约」: reuse the selected production view's own
// PNGs and rectangles. The source episode supplies motion, never a new body.
function mapDangoWalkToRaster(sample, data, direction = 1) {
  const bodyWorld = Object.freeze([direction * sample.bodyWorld[0], sample.bodyWorld[1]]);
  const feet = sample.feet.map((foot, i) => {
    const key = FEET[i], anchor = data.anchors[key];
    const dx = direction * (foot.rootWorld[0] - C.hips[SIDES[i]]);
    const dy = foot.rootWorld[1] - (C.groundY - 7);
    const groundY = data.parts[key].rect[1] + data.parts[key].rect[3];
    return Object.freeze({ key, source: data.parts[key].src, support: foot.support,
      phase: foot.phase, matrix: translation(dx, dy),
      rootWorld: Object.freeze([anchor.x + dx, anchor.y + dy]),
      soleWorld: Object.freeze([anchor.x + dx, groundY + dy]), groundY });
  });
  return Object.freeze({ sample, bodyWorld, feet: Object.freeze(feet), runtimeReady: false, host: null });
}

function eligible(options, artwork) {
  if (options.action || ![undefined, 'idle', 'walk'].includes(options.motion)
    || ![undefined, 'idle', 'walking'].includes(options.state)
    || !['three-quarter-right', 'three-quarter'].includes(options.view)
    || artwork.clip || (options.appearance?.items || []).length
    || options.transform || options.matrix || options.accent && options.accent !== 'none') return false;
  const data = artwork.data;
  return data.body.src === 'views/three-quarter-right/body.png'
    && FEET.every(key => data.parts[key].src === `views/three-quarter-right/${key}.png`
      && Math.abs(data.parts[key].rect[1] + data.parts[key].rect[3] - 64) < 1e-8);
}

function bodyLocalArtwork(artwork) {
  return artwork?.walk ? { ...artwork, matrices: artwork.walkBodyMatrices } : artwork;
}

function withBody(context, artwork, draw, scale = 1) {
  context.save();
  context.translate(artwork.walk.bodyWorld[0] * scale, artwork.walk.bodyWorld[1] * scale);
  try { return draw(); } finally { context.restore(); }
}

// Companion presentation owns no clock or world/window position here. The opt-in
// caller supplies one bounded episode progress, including frozen pause inputs.
// Travelling episodes remain opt-in. Production exposes only the explicitly
// selected, stage-bound workbench slice; it has no native world handoff.
function createDangoWalkArtistAdapter({ enabled = false, workbench = false, manifest, source } = {}) {
  enabled = enabled === true;
  const face = manifest?.views?.['three-quarter-right']?.face;
  const faceSprites = face ? [...Object.values(face.eyes).flat(), ...Object.values(face.mouth)] : [];
  const resourcesReady = () => faceSprites.length > 0 && faceSprites.every(sprite => source.state(sprite) === 'ready');
  const windows = new Map();
  const maxChannels = 16;
  let disposed = false;
  function wrap(artist) {
    function resolveArtwork(options = {}) {
      const original = artist.resolveArtwork(options);
      const stepInPlace = enabled && workbench === true && options.action?.id === DANGO_WALK_WORKBENCH.action.id
        && options.action.motion === 'idle' && options.action.prop === 'none' && options.action.motionCaps?.stepInPlace === true;
      if (workbench === true && (!stepInPlace || options.facing === -1)) return original;
      if (stepInPlace) {
        const playback = options.action.previewPlayback;
        options = { ...options, action: null, motion: 'idle',
          elapsedMs: playback?.elapsedMs ?? options.elapsedMs,
          expressionElapsedMs: playback?.elapsedMs ?? options.expressionElapsedMs,
          walkSettle: playback?.settle || 0, walkPaused: playback?.paused === true,
          walkEpisode: { id: playback?.id || options.actionInstanceKey || 'workbench', progress: options.progress } };
      }
      if (!enabled || disposed || !options.walkEpisode) return original;
      const episode = options.walkEpisode, channel = options.channel ?? 'default';
      if (typeof channel !== 'string' || channel.length > 128
        || typeof episode.id !== 'string' || !episode.id.length || episode.id.length > 128
        || !Number.isFinite(episode.progress) || episode.progress < 0 || episode.progress > 1)
        return fallback(original, 'invalid-episode');
      let window = windows.get(channel);
      if (!window || window.id !== episode.id) {
        if (!window && windows.size >= maxChannels) return fallback(original, 'channel-budget');
        window = { id: episode.id, enabled: eligible(options, original) && original.ready && resourcesReady(), staticProgress: null };
        windows.set(channel, window);
      }
      if (!eligible(options, original) || !original.ready || !resourcesReady()) window.enabled = false;
      if (!window.enabled) return fallback(original, 'incompatible-or-unready-episode');
      if (stepInPlace && options.walkPaused && window.pausedArtwork) return window.pausedArtwork;
      if (!options.walkPaused) window.pausedArtwork = null;
      const frozen = Boolean(options.calmVisual || options.reducedMotion);
      if (frozen && window.staticProgress === null) window.staticProgress = episode.progress;
      if (!frozen) window.staticProgress = null;
      const p = frozen ? window.staticProgress : episode.progress;
      const sampler = stepInPlace ? sampleDangoStepInPlaceEpisode : sampleDangoWalkEpisode;
      const active = sampler(p, { settle: options.walkSettle || 0 });
      // Reduced motion settles both feet at the latched body position; no
      // independent clock or subsequent progress can move this static pose.
      const sample = frozen ? { ...sampler(0),
        bodyWorld: [active.bodyWorld[0], 0], feet: sampler(0).feet.map(foot => ({ ...foot,
          rootWorld: [foot.rootWorld[0] + active.bodyWorld[0], foot.rootWorld[1]],
          soleWorld: [foot.soleWorld[0] + active.bodyWorld[0], foot.soleWorld[1]],
          contactTarget: [foot.contactTarget[0] + active.bodyWorld[0], foot.contactTarget[1]] })) } : active;
      // The same progress is also the existing idle ear/face sampler's clock.
      // The baseline pose is a true idle in this exact view, not a reflected view.
      const base = artist.resolveArtwork({ ...options, walkEpisode: undefined, state: 'idle',
        motion: 'idle', progress: 0, elapsedMs: frozen ? 0 : stepInPlace ? options.elapsedMs : p * 7200,
        expressionElapsedMs: frozen ? 0 : stepInPlace ? options.expressionElapsedMs : p * 7200, calmVisual: frozen });
      if (!base.ready) { window.enabled = false; return fallback(original, 'base-art-not-ready'); }
      const walk = mapDangoWalkToRaster(sample, base.data);
      const matrices = { ...base.matrices };
      for (const foot of walk.feet) matrices[foot.key] = foot.matrix;
      const walkBodyMatrices = { ...base.matrices };
      for (const foot of walk.feet) walkBodyMatrices[foot.key] = addTranslation(foot.matrix, -walk.bodyWorld[0], -walk.bodyWorld[1]);
      const resolvedArtwork = Object.freeze({ ...base, walk, walkStatus: 'preview-ready', walkMode: stepInPlace ? 'step-in-place' : 'forward', walkPaused: options.walkPaused, matrices: Object.freeze(matrices),
        walkBodyMatrices: Object.freeze(walkBodyMatrices),
        footwearTransforms: Object.freeze(Object.fromEntries(walk.feet.map(foot => [foot.key, foot.matrix]))) });
      if (stepInPlace && options.walkPaused) window.pausedArtwork = resolvedArtwork;
      return resolvedArtwork;
    }
    return Object.freeze({ ...artist, resolveArtwork,
      ready(options) { return enabled ? Promise.all([artist.ready(options), source.ready(faceSprites)]) : artist.ready(options); },
      body(context, colors, view, artwork, options = {}) {
        if (!artwork?.walk || options.cache) return artist.body(context, colors, view, artwork, options);
        return withBody(context, artwork, () => artist.body(context, colors, view, bodyLocalArtwork(artwork), options));
      },
      action(context, options) {
        const art = options.artwork;
        if (!art?.walk || options.layer !== 'back') return artist.action(context, options);
        const ears = { ...art, hiddenParts: [...art.hiddenParts, ...FEET] };
        const feet = { ...art, hiddenParts: [...art.hiddenParts, 'ear-left', 'ear-right'] };
        // Preserve the idle ear transform's order, including fractional DPR;
        // planted feet retain their absolute world matrices without a body bob.
        const back = withBody(context, art, () => artist.action(context, { ...options, artwork: ears }));
        return artist.action(context, { ...options, artwork: feet }) || back;
      },
      bodyForeground(context, colors, artwork) {
        // drawBodySprite already entered clipBody's body-space transform.
        // Foot root fills need world-foot minus body, never a second body shift.
        return artist.bodyForeground(context, colors, bodyLocalArtwork(artwork));
      },
      face(context, colors, expression, blinking, view, faceRig, artwork) {
        const draw = () => artist.face(context, colors, expression, artwork?.walkPaused ? false : blinking, view, faceRig, artwork);
        return artwork?.walk ? withBody(context, artwork, draw) : draw();
      },
      clipBody(context, artwork, draw, scale = 1) {
        return artwork?.walk ? withBody(context, artwork, draw, scale) : artist.clipBody(context, artwork, draw, scale);
      },
      applyMotionTransform(context, motion, progress, options = {}) {
        if (!options.artwork?.walk) return artist.applyMotionTransform(context, motion, progress, options);
      },
      cacheStats() { return Object.freeze({ ...artist.cacheStats(), walk: Object.freeze({ channels: windows.size,
        maxChannels, runtimeReady: false, host: null, disposed }) }); },
      dispose() { disposed = true; windows.clear(); artist.dispose(); }
    });
  }
  return Object.freeze({ wrap });
}

export { mapDangoWalkToRaster, createDangoWalkArtistAdapter };
