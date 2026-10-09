const moduleCache = new Map();
let serial = 0;
export async function loadSource(root, options = {}) {
  if (!moduleCache.has(root)) moduleCache.set(root, (async () => {
    const paths = {
      renderer: 'surfaces/pet/renderer.mjs', compositor: 'surfaces/pet/compositor.mjs',
      scene: 'surfaces/pet/scene.mjs', effects: 'surfaces/pet/effects.mjs', frame: 'surfaces/pet/frame-context.mjs',
      forms: 'capabilities/companion/form-registry.mjs', formArt: 'capabilities/companion/presentation/form-art.mjs',
      art: 'core/pet-art.mjs', face: 'core/pet-face.mjs', sceneArt: 'core/pet-scene-art.mjs',
      motion: 'core/pet-motion.mjs', sprite: 'core/pet-sprite.mjs', expression: 'core/pet-expression.mjs',
      appearance: 'core/pet-appearance.mjs', expressions: 'content/expressions.mjs',
      behaviors: 'content/behaviors.mjs', sessions: 'content/session-activities.mjs',
      scenes: 'content/scenes.mjs', wardrobe: 'content/appearance.mjs', skins: 'skins.mjs'
    };
    const source = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, file]) =>
      [key, await import(`${root}/src/${file}`)])));
    if (source.formArt.prepareArtwork) await Promise.all(Object.values(source.forms.PET_FORMS)
      .map(form => source.formArt.prepareArtwork(form, { all: true })));
    return source;
  })());
  const source = await moduleCache.get(root);
  // Explicit content/helper injection keeps historical snapshots independent.
  if (options.interactions) source.interactions = options.interactions;
  if (options.interactionPlayback) source.interactionPlayback = options.interactionPlayback;
  return source;
}

export function canvas(width, height = width) {
  const element = document.createElement('canvas'); element.width = width; element.height = height; return element;
}

// The production renderer receives deterministic immutable frame inputs. All actual
// body/face/action/wardrobe/scene/particle drawing remains in the application's modules.
export function createRenderHarness(source, options = {}) {
  const skin = options.skin || 'usagi', dpr = options.dpr || 2;
  const form = source.forms.resolvePetForm(skin);
  const stage = source.forms.resolveFormStage(skin, dpr);
  const motion = source.motion.default;
  const owned = [];
  const surface = (...dimensions) => { const result = canvas(...dimensions); owned.push(result); return result; };
  const body = surface(stage.rasterWidth, stage.rasterHeight), scene = surface(220 * dpr), overlay = surface(220 * dpr);
  const faceSurface = surface(Math.ceil(stage.bodySize * stage.deviceScale));
  const backSurface = surface(stage.rasterWidth, stage.rasterHeight), frontSurface = surface(stage.rasterWidth, stage.rasterHeight);
  const pctx = body.getContext('2d', { willReadFrequently: true });
  const sctx = scene.getContext('2d'), octx = overlay.getContext('2d');
  pctx.setTransform(stage.deviceScale, 0, 0, stage.deviceScale, 0, 0);
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const registry = source.expression.createExpressionRegistry(source.expressions.EXPRESSIONS);
  if (registry.errors.length) throw new Error(registry.errors.join('\n'));
  const random = motion.createSeededRandom(0x55a61), blinkRandom = motion.createSeededRandom(0x913a7);
  const rate = value => motion.createRateEmitter({ ratePerSecond: value });
  const petalEmitter = rate(6), sakuraRainEmitter = rate(3.6);
  const petFallbackSceneEmitters = Object.fromEntries(Object.entries({ morningCloud: 1.2, morningBird: .24,
    daylightButterfly: .9, afternoonPlane: .48, eveningDragonfly: .3, nightFirefly: 1.2,
    nightStar: 3, lateNightBat: .18 }).map(([key, value]) => [key, rate(value)]));
  const petSkinSceneEmitters = Object.fromEntries(Object.entries({ forest: 1.8, ocean: 3, flame: 4.8, moon: 6 })
    .map(([key, value]) => [key, rate(value)]));
  const petActionEmitters = Object.fromEntries(Object.entries({ generic: 4.5, calm: 1.8, workout: 7.5,
    dig: 15, bubble: 5, sing: 9 }).map(([key, value]) => [key, rate(value)]));
  const reset = group => Object.values(group).forEach(emitter => emitter.reset());
  const sprites = source.sprite.createPetSpriteCache({ createSurface: surface, capacity: 32 });
  const compositor = source.compositor.createPetCompositor({ context: pctx, faceSurface, spriteCache: sprites,
    getGeometry: () => stage, getBodyKey: (tone, view) => source.art.bodySpriteKey(skin, tone, view),
    paintBody: (surface, palette, tone, geometry, view) => source.art.paintBodySprite(surface, palette, tone, geometry, view),
    paintFace: (surface, palette, face, blinking, geometry) => source.art.paintFaceSprite(surface, palette, face, blinking,
      { stage: geometry, faceRig: source.face, view: geometry.view }) });
  let elapsed = -1, current = null, state = null, dt = 0;
  // The production default stays 'pet'; diagnostic renderers have independent
  // pose-transition channels without changing any persistent/application state.
  const renderChannel = `gallery:${++serial}`, epoch = 0;
  const sessionController = options.sessionActivityController || { current: () => current?.kind === 'session' ? current.item : null,
    snapshot: () => current?.kind === 'session' ? { activity: current.item, startedAt: epoch,
      progress: Math.max(0, elapsed) / current.duration } : null };
  const painter = source.renderer.createPetRenderer({
    readEngines: () => ({ expressionRegistry: registry, presentationDirector: null, sessionActivityController: sessionController }),
    window, document, pctx, sctx, octx, petCanvas: body, petFaceSurface: faceSurface,
    petActionBackSurface: backSurface, petActionFrontSurface: frontSurface, petSprites: sprites, petCompositor: compositor,
    petSceneLayer: source.scene.createPetScene({ context: sctx, art: source.sceneArt,
      resetEmitters: () => { reset(petFallbackSceneEmitters); reset(petSkinSceneEmitters); sakuraRainEmitter.reset(); } }),
    petEffects: source.effects.createPetEffects({ context: octx, motion }),
    gazeSpringX: motion.createSpring(), gazeSpringY: motion.createSpring(),
    squashSpring: motion.createSpring(), tiltSpring: motion.createSpring(),
    blinkScheduler: options.blink === false ? { update: () => ({ blinking: false }), retune() {} }
      : motion.createBlinkScheduler({ random: blinkRandom, minMs: 667, maxMs: 2333, blinkMs: 100 }),
    petalEmitter, sakuraRainEmitter, petFallbackSceneEmitters, petSkinSceneEmitters, petActionEmitters,
    celebrateStarColors: ['#e0af68', '#f7768e', '#bb9af7'], motionRandom: random,
    pick: items => items[Math.floor(random() * items.length)], rand: (a, b) => a + random() * (b - a),
    getTimePeriod: () => 'afternoon', reducedMotion: () => Boolean(options.calm),
    updatePresentation: () => options.expressionFor?.(state) || current?.item.expression || current?.item.id || 'life.idle',
    updateSessionActivityUi() {}, activityUi: options.activityUi || null, resetPetRateEmitters: reset,
    emitPetRate: (emitter, callback) => { const n = emitter.update(dt); for (let i = 0; i < n; i++) callback(); return n; },
    resetPetActionEmitters: () => reset(petActionEmitters),
    legacyFramesAt: time => (time - epoch) / motion.MS_PER_LEGACY_FRAME,
    legacyFrameMs: motion.MS_PER_LEGACY_FRAME, palettes: source.art.PALETTES
  });
  const content = { ...source.scenes, ...source.behaviors, ...source.sessions, ...source.expressions, ...source.wardrobe,
    INTERACTIONS: source.interactions?.INTERACTIONS || source.interactions };
  function interactionEntry(id) {
    const match = /^click-(\d+)$/.exec(id);
    return match ? content.INTERACTIONS?.clickCount?.[Number(match[1])]
      : ['longPress', 'fling'].includes(id) ? content.INTERACTIONS?.[id] : null;
  }
  // Compatibility adapter copied from the frozen controller/pointer behaviour.
  // No contextual current-version semantics are applied to historical sources.
  function legacyInteractionParticles(effect) {
    if (!['explode', 'purr'].includes(effect) || (effect === 'purr' && options.calm)) return [];
    const rand = (a, b) => a + random() * (b - a);
    const pick = values => values[Math.floor(random() * values.length)];
    return Array.from({ length: effect === 'explode' ? 30 : 5 }, () => effect === 'explode'
      ? { type: 'flash', x: 110, y: 110, vx: rand(-4, 4), vy: rand(-4, 4), gravity: .15,
        life: 40, color: pick(['#f7768e', '#e0af68', '#7dcfff']) }
      : { type: 'heart', x: 110 + rand(-14, 14), y: 98, vx: rand(-.25, .25), vy: rand(-.9, -.5),
        life: 40, color: pick(['#ffd5e0', '#f7768e', '#c8b3f5']) });
  }
  function select(kind, id, sceneId = options.scene || 'cozy-room') {
    const interaction = kind === 'interaction' ? interactionEntry(id) : null;
    const action = interaction ? content.PET_ACTIONS[interaction.action] : null;
    const plan = action ? source.interactionPlayback?.createManualActionPlayback(content, action.id,
      { interactionId: id, formId: form.id }) || { id: action.id, duration: action.duration, manual: true,
        expression: id === 'longPress' && options.interactionHeld !== false ? 'react.petted' : action.expression } : null;
    const item = plan ? { ...action, expression: id === 'longPress' && options.interactionHeld !== false ? 'react.petted' : plan.expression, duration: plan.duration } : kind === 'action' ? content.PET_ACTIONS[id] : kind === 'session' ? content.SESSION_ACTIVITIES[id]
      : kind === 'scene' ? content.SCENES[id]
      : kind === 'appearance' ? content.PET_APPEARANCE_ITEMS.find(value => value.id === id)
      : kind === 'status' ? { id, expression: id === 'hungry' ? 'react.hungry' : 'life.idle', label: id }
      : content.EXPRESSIONS.find(value => value.id === id);
    if (!item) throw new Error(`Unknown ${kind}:${id}`);
    current = { kind, item, duration: item.duration || item.durationMs || 6400,
      ...(interaction ? { interactionId: id, interactionHeld: id === 'longPress' && options.interactionHeld !== false, viewPolicy: 'production-input-auto', interactionAdapter: source.interactionPlayback ? 'production-helper' : 'historical-controller-compatibility' } : {}) };
    elapsed = -1; dt = 0;
    content.SCENE_SCHEDULE = { afternoon: [kind === 'scene' ? id : sceneId] };
    content.SCENE_MANUAL_SCHEDULE = content.SCENE_SCHEDULE;
    state = {
      renderChannel, currentSkin: skin, currentTheme: source.skins.SKINS[skin].theme, level: options.level ?? 25,
      appearanceItemIds: Array.isArray(options.outfit) ? options.outfit : options.outfit === false ? [] : null,
      energyLevel: 70, workStart: 9, workEnd: 21,
      state: kind === 'status' && id === 'hungry' ? 'hungry' : kind === 'session' ? item.state : 'idle',
      sessionState: kind === 'session' && options.sceneMode !== 'selected' ? item.state : 'idle',
      sessionPaused: false, screenLocked: false, transientVisualState: null, satiation: 70,
      stimulationMode: options.calm ? 'low' : 'high', motionMode: options.calm ? 'reduced' : 'full', dnd: false,
      coffeeBonusUntil: kind === 'status' && id === 'coffee' ? Date.UTC(2030, 0, 1) : 0, facing: options.facing || 1,
      // Manual input is not a devtools action preview: previewConfig.expression would override the held/input expression.
      devPreview: kind === 'interaction' ? null : { category: kind === 'status' ? 'expression' : kind, id: kind === 'status' ? item.expression : id, skin, ...(options.view && options.view !== 'auto' ? { view: options.view } : {}) },
      devPreviewStartedAt: epoch, currentEgg: plan || (kind === 'action' ? { id, duration: current.duration } : null),
      dockedEdge: null, actionStartedAt: epoch, visibleSessionActivityId: null,
      sceneParticles: [], overlayParticles: [], sceneOffset: 0, manualSceneSelection: false,
      selectedScene: { key: '', value: null }, petals: [], sceneSpawnedTotal: 0, petalsSpawnedTotal: 0,
      actionParticlesSpawnedTotal: 0, currentExprId: null, exprStartAnimNow: epoch,
      currentRenderedEyeMask: 'neutral', currentActionProgress: 0,
      petGaze: { x: 0, y: 0, near: false, sameDisplay: true },
      commandMenuOpen: false, foodMenuOpen: false, devtoolsOpen: false, dragging: false, dragVx: 0, dragVy: 0,
      animNow: epoch, animDt: 0
    };
    if (interaction) state.overlayParticles.push(...(source.interactionPlayback
      ? source.interactionPlayback.createInteractionParticles(interaction.effect, { calmVisual: Boolean(options.calm), random, formId: form.id })
      : legacyInteractionParticles(interaction.effect)));
    return current;
  }
  function draw(at) {
    if (!state) throw new Error('select a gallery entry first');
    dt = elapsed < 0 || at < elapsed ? 0 : Math.min(250, at - elapsed); elapsed = at;
    state.animNow = epoch + at; state.animDt = dt;
    const frame = source.frame.createPetFrameContext({ state, now: epoch + at, dt,
      wallNow: Date.UTC(2026, 9, 1, 14) + at, policy: { calmVisual: Boolean(options.calm) }, stage, content });
    Object.assign(state, painter.executeFrame(frame).updates);
    const mirrorPlayback = options.sessionActivityController
      ? painter.executeFrame(frame, 'mirrorPlaybackSnapshot').value : null;
    return { body, scene, overlay, state, stage, current, mirrorPlayback };
  }
  function composite(target = canvas(220 * dpr)) {
    const context = target.getContext('2d'); context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, 220, 220);
    context.globalAlpha = .56; context.drawImage(scene, 0, 0, 220, 220); context.globalAlpha = 1;
    context.drawImage(body, (220 - stage.cssWidth) / 2, (220 - stage.cssHeight) / 2 + 2, stage.cssWidth, stage.cssHeight);
    context.drawImage(overlay, 0, 0, 220, 220); return target;
  }
  return { select, draw, composite, body, scene, overlay, stage, form, source, skin,
    updateState(patch) { if (!state) throw new Error('select a gallery entry first'); Object.assign(state, patch); },
    dispose() { sprites.clear(); for (const item of owned) { item.width = 1; item.height = 1; } },
    get current() { return current; }, get elapsed() { return elapsed; } };
}
