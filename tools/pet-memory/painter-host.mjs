// Thin diagnostic composition, derived from tools/usagi-gallery/runtime-harness.mjs.
// All body/face/rig/wardrobe/scene/effect painting stays in createPetRenderer.
// Unlike capture tooling, this host never keeps an array of evicted sprite canvases.
export async function loadProduction() {
  const files = {
    renderer: 'surfaces/pet/renderer.mjs', compositor: 'surfaces/pet/compositor.mjs',
    scene: 'surfaces/pet/scene.mjs', effects: 'surfaces/pet/effects.mjs', frame: 'surfaces/pet/frame-context.mjs',
    companion: 'capabilities/companion/index.mjs', art: 'core/pet-art.mjs', face: 'core/pet-face.mjs',
    sceneArt: 'core/pet-scene-art.mjs', motion: 'core/pet-motion.mjs', sprite: 'core/pet-sprite.mjs',
    expression: 'core/pet-expression.mjs', expressions: 'content/expressions.mjs', behaviors: 'content/behaviors.mjs',
    sessions: 'content/session-activities.mjs', scenes: 'content/scenes.mjs', wardrobe: 'content/appearance.mjs',
    outfits: 'content/companion/usagi-wardrobe.mjs', skins: 'skins.mjs',
    dango: 'capabilities/companion/presentation/dango-raster-production.mjs',
    usagi: 'capabilities/companion/presentation/usagi-art.mjs'
  };
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
    [key, await import(`../../src/${file}`)])));
}

export function createPainterHost(source, dpr, seed) {
  const { forms } = source.companion, motion = source.motion.default;
  const surface = (width, height = width) => {
    const element = document.createElement('canvas'); element.width = width; element.height = height; return element;
  };
  let skin = 'pink', stage = forms.resolveFormStage(skin, dpr), current = null, dt = 0;
  const body = surface(stage.rasterWidth, stage.rasterHeight), scene = surface(220 * dpr), overlay = surface(220 * dpr);
  const face = surface(Math.ceil(stage.bodySize * stage.deviceScale));
  const back = surface(stage.rasterWidth, stage.rasterHeight), front = surface(stage.rasterWidth, stage.rasterHeight);
  const pctx = body.getContext('2d'), sctx = scene.getContext('2d'), octx = overlay.getContext('2d');
  body.id = 'pet'; scene.id = 'scene'; overlay.id = 'overlay';
  document.querySelector('#stage').append(scene, body, overlay);
  const registry = source.expression.createExpressionRegistry(source.expressions.EXPRESSIONS);
  if (registry.errors.length) throw new Error(registry.errors.join('\n'));
  const random = motion.createSeededRandom(seed), blinkRandom = motion.createSeededRandom(seed ^ 0x913a7);
  const rate = value => motion.createRateEmitter({ ratePerSecond: value });
  const petalEmitter = rate(6), sakuraRainEmitter = rate(3.6);
  const group = rates => Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, rate(value)]));
  const fallback = group({ morningCloud: 1.2, morningBird: .24, daylightButterfly: .9, afternoonPlane: .48,
    eveningDragonfly: .3, nightFirefly: 1.2, nightStar: 3, lateNightBat: .18 });
  const skinEmitters = group({ forest: 1.8, ocean: 3, flame: 4.8, moon: 6 });
  const actionEmitters = group({ generic: 4.5, calm: 1.8, workout: 7.5, dig: 15, bubble: 5, sing: 9 });
  const reset = emitters => Object.values(emitters).forEach(emitter => emitter.reset());
  const sprites = source.sprite.createPetSpriteCache({ createSurface: surface, capacity: 32 });
  const compositor = source.compositor.createPetCompositor({ context: pctx, faceSurface: face, spriteCache: sprites,
    getGeometry: () => stage, getBodyKey: (tone, view) => source.art.bodySpriteKey(skin, tone, view),
    paintBody: (target, palette, tone, geometry, view) => source.art.paintBodySprite(target, palette, tone, geometry, view),
    paintFace: (target, palette, pose, blinking, geometry) => source.art.paintFaceSprite(target, palette, pose, blinking,
      { stage: geometry, faceRig: source.face, view: geometry.view }) });
  const content = { ...source.scenes, ...source.behaviors, ...source.sessions, ...source.expressions, ...source.wardrobe,
    SCENE_SCHEDULE: { afternoon: ['cozy-room'] }, SCENE_MANUAL_SCHEDULE: { afternoon: ['cozy-room'] } };
  const state = {
    renderChannel: 'memory-baseline', currentSkin: skin, currentTheme: source.skins.SKINS[skin].theme,
    level: 25, appearanceItemIds: [], energyLevel: 70, workStart: 9, workEnd: 21,
    state: 'idle', sessionState: 'idle', sessionPaused: false, screenLocked: false,
    transientVisualState: null, satiation: 70, stimulationMode: 'high', motionMode: 'full', dnd: false,
    coffeeBonusUntil: 0, facing: 1, devPreview: null, devPreviewStartedAt: 0, currentEgg: null,
    dockedEdge: null, actionStartedAt: 0, visibleSessionActivityId: null,
    sceneParticles: [], overlayParticles: [], sceneOffset: 0, manualSceneSelection: false,
    selectedScene: { key: '', value: null }, petals: [], sceneSpawnedTotal: 0, petalsSpawnedTotal: 0,
    actionParticlesSpawnedTotal: 0, currentExprId: null, exprStartAnimNow: 0,
    currentRenderedEyeMask: 'neutral', currentActionProgress: 0,
    petGaze: { x: 0, y: 0, near: false, sameDisplay: true },
    commandMenuOpen: false, foodMenuOpen: false, devtoolsOpen: false,
    dragging: false, dragVx: 0, dragVy: 0, animNow: 0, animDt: 0
  };
  const sessions = { current: () => current?.kind === 'session' ? current.item : null,
    snapshot: () => current?.kind === 'session' ? { activity: current.item, startedAt: state.devPreviewStartedAt,
      progress: (state.animNow - state.devPreviewStartedAt) / (current.item.duration || current.item.durationMs || 6_400) } : null };
  const painter = source.renderer.createPetRenderer({
    readEngines: () => ({ expressionRegistry: registry, presentationDirector: null, sessionActivityController: sessions }),
    window, document, pctx, sctx, octx, petCanvas: body, petFaceSurface: face,
    petActionBackSurface: back, petActionFrontSurface: front, petSprites: sprites, petCompositor: compositor,
    petSceneLayer: source.scene.createPetScene({ context: sctx, art: source.sceneArt,
      resetEmitters: () => { reset(fallback); reset(skinEmitters); sakuraRainEmitter.reset(); } }),
    petEffects: source.effects.createPetEffects({ context: octx, motion }),
    gazeSpringX: motion.createSpring(), gazeSpringY: motion.createSpring(),
    squashSpring: motion.createSpring(), tiltSpring: motion.createSpring(),
    blinkScheduler: motion.createBlinkScheduler({ random: blinkRandom, minMs: 667, maxMs: 2333, blinkMs: 100 }),
    petalEmitter, sakuraRainEmitter, petFallbackSceneEmitters: fallback, petSkinSceneEmitters: skinEmitters,
    petActionEmitters: actionEmitters, celebrateStarColors: ['#e0af68', '#f7768e', '#bb9af7'], motionRandom: random,
    pick: items => items[Math.floor(random() * items.length)], rand: (a, b) => a + random() * (b - a),
    getTimePeriod: () => 'afternoon', reducedMotion: () => false,
    updatePresentation: () => current?.item.expression || current?.item.id || 'life.idle',
    updateSessionActivityUi() {}, resetPetRateEmitters: reset,
    emitPetRate: (emitter, callback) => { const n = emitter.update(dt); for (let i = 0; i < n; i++) callback(); return n; },
    resetPetActionEmitters: () => reset(actionEmitters), legacyFramesAt: time => time / motion.MS_PER_LEGACY_FRAME,
    legacyFrameMs: motion.MS_PER_LEGACY_FRAME, palettes: source.art.PALETTES
  });
  function select(entry, startedAt) {
    const item = entry.kind === 'action' ? content.PET_ACTIONS[entry.id]
      : entry.kind === 'session' ? content.SESSION_ACTIVITIES[entry.id]
      : content.EXPRESSIONS.find(value => value.id === entry.id);
    if (!item) throw new Error(`Unknown memory activity ${entry.kind}:${entry.id}`);
    current = { ...entry, item }; skin = entry.skin; stage = forms.resolveFormStage(skin, dpr);
    Object.assign(state, { currentSkin: skin, currentTheme: source.skins.SKINS[skin].theme,
      appearanceItemIds: entry.outfit, facing: entry.facing, state: entry.kind === 'session' ? item.state : 'idle',
      sessionState: entry.kind === 'session' ? item.state : 'idle',
      devPreview: { category: entry.kind, id: entry.id, skin, view: entry.view }, devPreviewStartedAt: startedAt,
      currentEgg: entry.kind === 'action' ? { id: entry.id, duration: item.duration } : null, actionStartedAt: startedAt });
    for (const canvas of [body, back, front]) {
      if (canvas.width !== stage.rasterWidth) canvas.width = stage.rasterWidth;
      if (canvas.height !== stage.rasterHeight) canvas.height = stage.rasterHeight;
    }
    body.style.width = `${stage.cssWidth}px`; body.style.height = `${stage.cssHeight}px`;
    pctx.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return {
    select,
    draw(at, delta) {
      dt = Math.min(250, delta); state.animNow = at; state.animDt = dt;
      const frame = source.frame.createPetFrameContext({ state, now: at, dt, wallNow: Date.UTC(2026, 9, 1, 14) + at,
        policy: { calmVisual: false }, stage, content });
      Object.assign(state, painter.executeFrame(frame).updates);
    },
    snapshot() {
      // Read back only at samples, never every frame; its cost is outside draw timing.
      const pixels = pctx.getImageData(0, 0, body.width, body.height).data;
      let opaqueBodyPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] >= 20) opaqueBodyPixels++;
      return { opaqueBodyPixels, stage, current: current && { skin, kind: current.kind, id: current.id, outfit: current.outfit },
        caches: { body: { entries: sprites.size, capacity: sprites.capacity }, dango: source.dango.default.cacheStats(),
          usagi: source.usagi.default.cacheStats() },
        particles: { scene: state.sceneParticles.length, overlay: state.overlayParticles.length, petals: state.petals.length } };
    },
    dispose() { sprites.clear(); for (const canvas of [body, scene, overlay, face, back, front]) {
      canvas.remove(); canvas.width = 1; canvas.height = 1;
    } }
  };
}
