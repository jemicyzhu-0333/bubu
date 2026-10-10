import { bodyStateOffset, resolveActionBodyPose } from './body-presentation.mjs';
'use strict';

import petExpression from '../../core/pet-expression.mjs';
import petStage from '../../core/pet-stage.mjs';
import petArt from '../../core/pet-art.mjs';
import petSceneArt from '../../core/pet-scene-art.mjs';
import petAppearance from '../../core/pet-appearance.mjs';
import petMotion from '../../core/pet-motion.mjs';
import { resolveActionEffectVisual } from '../../core/pet-effect-visuals.mjs';
import { forms, formArt } from '../../capabilities/companion/index.mjs';
import { copyFrameData, freezeFrameData } from './frame-context.mjs';
import { createActionPlayback, resolvePlaybackAccent } from './action-playback.mjs';
import { createSleepTransition } from './sleep-transition.mjs';
import { contextMirrorBlocked } from './context-emphasis.mjs';
import { projectEffectOrigins } from './effect-origin.mjs';

export function createPetRenderer({
  readEngines = () => ({}),
  window,
  document,
  date: Date = globalThis.Date,
  math: Math = globalThis.Math,
  pctx,
  sctx,
  octx,
  petCanvas,
  petFaceSurface,
  petActionBackSurface,
  petActionFrontSurface,
  petSprites,
  petCompositor,
  petSceneLayer,
  petEffects,
  gazeSpringX,
  gazeSpringY,
  squashSpring,
  tiltSpring,
  blinkScheduler,
  petalEmitter,
  sakuraRainEmitter,
  petFallbackSceneEmitters,
  petSkinSceneEmitters,
  petActionEmitters,
  celebrateStarColors,
  motionRandom,
  pick,
  rand,
  getTimePeriod,
  reducedMotion,
  updatePresentation,
  updateSessionActivityUi = () => {},
  activityUi = null,
  resetPetRateEmitters,
  emitPetRate,
  resetPetActionEmitters,
  legacyFramesAt,
  legacyFrameMs,
  currentTheme,
  palettes
} = {}) {
  if (!pctx || !sctx || !octx) throw new TypeError('pet renderer contexts are required');
  let runtimeState = null;
  let currentFrame = null;
  let sceneEmitterRates = null;
  let actionEffectOrigins = Object.freeze({});
  let hasAttachedEffectOrigins = false;
  const sleepTransition = createSleepTransition();
  const actionPlayback = createActionPlayback();
  const PALETTES = palettes;
  const LEGACY_FRAME_MS = legacyFrameMs;
  const CELEBRATE_STAR_COLORS = celebrateStarColors;
  const appendActionParticle = particle => {
    runtimeState.overlayParticles.push(particle);
    runtimeState.actionParticlesSpawnedTotal += 1;
  };

// 位移类变换必须落在整数设备像素上。半像素位移会把身体位图的边缘反锯齿化，
// 在透明置顶窗口上就是一条能看见桌面的裂缝，而且裂缝随正弦相位游走。
// 旋转与缩放不量化（运动本身需要连续），但身体现在是一次整图 drawImage，
// 反锯齿只发生在轮廓上，不会在格子之间裂开。
function petTranslate(x, y) {
  const scale = runtimeState.petStageGeo.deviceScale;
  pctx.translate(
    petStage.snapToPetDevicePixel(x, scale),
    petStage.snapToPetDevicePixel(y, scale)
  );
}

// ---------- Live face ----------
// 眼睛与嘴不烘焙进身体缓存；当前原生矢量画笔按同一身体变换实时绘制。
// 保留历史像素画笔的独立face surface接口，避免各像素格单独变换时产生裂缝。
function drawLiveFace(form, palette, face, isBlinking, offX, offY, view, artwork) {
  return formArt.drawFace(pctx, {
    form, palette, face, blinking: isBlinking, offX, offY, view, artwork,
    stage: runtimeState.petStageGeo,
    drawPixelFace: (colors, pose, blink, x, y, angle) =>
      petCompositor.drawFace(colors, pose, blink, x, y, angle)
  });
}

// 表情身体位姿（进入序列 + 常驻循环的缩放/倾斜/位移）叠加在动作变换之上。
// 平移走 petTranslate 量化到整数设备像素；缩放/旋转绕身体中心。静止策略下
// 直接返回（静态位姿），不产生装饰性形变。
function applyExpressionBodyTransform(poseBody, size) {
  petArt.applyBodyPose(pctx, poseBody, size, petTranslate);
}

// 直接交互的连续反馈：按压/单击的压缩回弹、拖动速度带来的身体倾斜。
// 全部走弹簧，幅度有界（压缩 ≤10%、倾斜 ≤0.28 rad ≈ 16°），并绕身体中心。
function applyInteractionTransform(size) {
  const squash = squashSpring.value;
  const tilt = tiltSpring.value;
  if (Math.abs(squash) < 0.002 && Math.abs(tilt) < 0.002) return;
  const center = size / 2;
  petTranslate(center, center);
  if (tilt !== 0) pctx.rotate(tilt);
  if (squash > 0) pctx.scale(1 + 0.06 * squash, 1 - 0.10 * squash);
  petTranslate(-center, -center);
}

function applyPetViewTransform(view, size) {
  const transform = petAppearance.getPetViewTransform(view);
  if (transform.scaleX === 1 && transform.offsetX === 0) return;
  const center = size / 2;
  petTranslate(center + transform.offsetX, center);
  pctx.scale(transform.scaleX, 1);
  petTranslate(-center, -center);
}

// ---------- Body sprite ----------
// 身体位图只含轮廓、皮肤与离散身体色调：眼区按身体底色填充，嘴不再烘焙。
// 因此缓存键收敛为 皮肤|色调|版型，与眨眼、表情、连续位姿无关，缓存有界。
// 一次 drawImage 贴出整个身体：位图内部不可能出现接缝，旋转时也只有轮廓抗锯齿。
// 不同形态按自己的美术边界和原稿版本缓存，不把动画时间加入缓存键。
function drawPetBody(form, skinId, palette, bodyTone, offX, offY, view, artwork) {
  const geo = runtimeState.petStageGeo;
  const bounds = formArt.spriteBounds(form, geo);
  const sprite = petSprites.acquire(formArt.bodySpriteKey(form, skinId, bodyTone, view, false, artwork), {
    width: Math.round(bounds.width * geo.deviceScale),
    height: Math.round(bounds.height * geo.deviceScale),
    paint: surface => formArt.paintBodySprite(surface, {
      form, palette, tone: bodyTone, stage: geo, view, artwork
    })
  });
  formArt.drawBodySprite(pctx, sprite, { form, stage: geo, bounds, offX, offY, artwork, palette });
}

// ---------- Draw pet ----------
function drawPet() {
  const geo = runtimeState.petStageGeo;
  const size = geo.artWidth;
  const snap = (value) => petStage.snapToPetDevicePixel(value, geo.deviceScale);
  let offX = geo.bodyOrigin.x;
  let offY = geo.bodyOrigin.y;
  const calmVisual = currentFrame.policy.calmVisual;
  // 策略收紧（减少动效/低刺激）必须立刻归静态：把注视与交互弹簧直接归零，
  // 避免“按压进行中切到静态”后压缩/倾斜残留在身上。
  if (calmVisual) {
    squashSpring.snap(0);
    tiltSpring.snap(0);
    gazeSpringX.snap(0);
    gazeSpringY.snap(0);
  }
  // 常驻浮动以前是 sin(frame * 0.15) 逐帧推进；现在按累计的真实时间采样，
  // 60 FPS 下相位不变，30/6 FPS 下周期与 60 FPS 一致。
  const legacyFrames = legacyFramesAt(runtimeState.animNow);
  const bob = calmVisual ? 0 : Math.round(Math.sin(legacyFrames * 0.15) * 2);
  const sessionSnapshot = runtimeState.sessionActivityController && runtimeState.sessionActivityController.snapshot(runtimeState.animNow);
  const sessionAction = sessionSnapshot && sessionSnapshot.activity;
  if (activityUi) activityUi.syncActivity(sessionAction);
  else updateSessionActivityUi(sessionAction);
  const previewSkin = runtimeState.devPreview && runtimeState.devPreview.skin;
  const skinId = previewSkin || runtimeState.currentSkin;
  const form = forms.resolvePetForm(skinId);
  const selectedExpression = runtimeState.devPreview ? null : updatePresentation();
  const presentationSource = runtimeState.presentationDirector?.current(runtimeState.animNow)?.source;
  const contextInput = { state: runtimeState, activity: sessionAction, source: presentationSource, expressionId: selectedExpression };
  const { previewConfig, actionConfig, actionT } = actionPlayback.resolve({
    content: runtimeState.petContent, preview: runtimeState.devPreview,
    egg: runtimeState.currentEgg, sessionSnapshot, now: runtimeState.animNow,
    previewStartedAt: runtimeState.devPreviewStartedAt,
    actionStartedAt: runtimeState.actionStartedAt, calmVisual, form,
    combinationContext: { ...contextInput, mirror: runtimeState.activityMirror, concurrent: runtimeState.activityMirrorConcurrent },
    mirrorBlocked: activityUi ? activityUi.blocked(contextInput) : contextMirrorBlocked(contextInput)
  });
  activityUi?.update({ ...contextInput, activity: sessionAction, action: actionConfig, formId: form.id, calmVisual });
  runtimeState.currentActionProgress = actionT;
  runtimeState.currentRenderedAction = actionConfig;

  offY += bodyStateOffset({ state: runtimeState.state, formId: form.id, action: actionConfig,
    calmVisual, legacyFrames, bob, expressionId: selectedExpression ?? previewConfig?.expression, source: presentationSource });

  // Every behavior owns a body motion; overlays are supporting details rather
  // than the whole animation, so the companion itself stays expressive.
  const motion = forms.resolveFormMotion(form, actionConfig);
  const actionOffset = formArt.motionOffset(form, actionConfig, motion, actionT, {
    calmVisual,
    bodySize: geo.bodySize,
    facing: runtimeState.facing,
    state: runtimeState.state
  });
  offX += actionOffset.x;
  offY += actionOffset.y;

  pctx.clearRect(0, 0, size, size);
  // 眨眼由绝对时间调度器推进：下次眨眼 = 当前 + [667, 2333)ms，
  // 闭合 100ms。调度只依赖动画时钟，与帧数无关。
  const scheduledBlink = blinkScheduler.update(runtimeState.animNow).blinking;
  // 是否闭眼只由当前 expression pose 决定；不能让旧 runtimeState.state 绕过 Director，
  // 否则睡眠 base 上的用户互动仍会被强制画成闭眼。
  const isBlinking = !calmVisual && scheduledBlink;

  const palette = form.renderer === 'pixel'
    ? PALETTES[skinId] || PALETTES.pink
    : formArt.paletteForSkin(skinId, form);
  const requestedView = runtimeState.devPreview && (runtimeState.devPreview.category === 'view'
    ? runtimeState.devPreview.id : runtimeState.devPreview.view)
    || 'auto';
  const view = formArt.resolveView(form, requestedView, { action: actionConfig, state: runtimeState.state });
  // 三种口径,优先级从高到低:
  //   devtools 单件预览 —— 只画那一件,这是它存在的意义;
  //   devtools 等级预览 —— 问的就是“Lv.N 自动会戴什么”,所以要绕开橱窗回到自动规则;
  //   橱窗选择 —— 用户的真实状态,主进程已经把显式选择与自动兜底合成好了。
  // 其余预览(皮肤、表情、朝向、动作)照常保留橱窗:那些问的是身体和行为,不是穿搭。
  const devAppearanceId = runtimeState.devPreview && runtimeState.devPreview.category === 'appearance'
    ? runtimeState.devPreview.id : null;
  const devLevel = Number.isInteger(runtimeState.devPreview && runtimeState.devPreview.level)
    ? runtimeState.devPreview.level : null;
  const wardrobeIds = devAppearanceId === null && devLevel === null
    && (!previewSkin || previewSkin === runtimeState.currentSkin)
    && Array.isArray(runtimeState.appearanceItemIds)
    ? runtimeState.appearanceItemIds : null;
  const appearance = petAppearance.projectAppearance({
    skin: skinId,
    formId: form.id,
    level: devLevel === null ? runtimeState.level : devLevel,
    view,
    items: runtimeState.petContent && runtimeState.petContent.PET_APPEARANCE_ITEMS,
    itemIds: devAppearanceId !== null ? [devAppearanceId] : wardrobeIds,
    // 解锁与归属已经在能力层判过了(devtools 预览本就要越过它)。这里再按 minLevel 和
    // 当前皮肤筛一遍,等于让渲染层否决上游的决定——自由混搭的配饰会被皮肤筛掉。
    includeLocked: devAppearanceId !== null || wardrobeIds !== null
  });

  // 由导演选出当前表情并采样位姿（脸 + 身体）。表情切换时重置起始时间，
  // 驱动进入序列；常驻循环按绝对 elapsed 周期推进。
  const exprId = runtimeState.devPreview && runtimeState.devPreview.category === 'expression'
    ? runtimeState.devPreview.id : runtimeState.devPreview
    ? (previewConfig?.expression || 'life.idle') : selectedExpression;
  if (exprId !== runtimeState.currentExprId) {
    runtimeState.currentExprId = exprId;
    runtimeState.exprStartAnimNow = runtimeState.animNow;
    // 眨眼节奏跟随当前表情（各表情有自己的 minMs/maxMs）；只影响下一次眨眼。
    if (runtimeState.expressionRegistry) {
      const config = runtimeState.expressionRegistry.get(exprId);
      if (config && config.blink) blinkScheduler.retune(config.blink);
    }
  }
  let pose = null;
  if (runtimeState.expressionRegistry) {
    const startedAt = runtimeState.devPreview ? runtimeState.devPreviewStartedAt : runtimeState.exprStartAnimNow;
    pose = petExpression.sampleExpressionPose(runtimeState.expressionRegistry, exprId, runtimeState.animNow - startedAt);
  }
  let facePose;
  let bodyPose;
  if (calmVisual && runtimeState.expressionRegistry) {
    // 减少动效 / 低刺激：直接取静态位姿。循环与进入序列不再产生装饰性
    // 位移或注视漂移，保证“静态可辨识”。
    const config = runtimeState.expressionRegistry.get(exprId) || runtimeState.expressionRegistry.get('life.idle');
    const staticFace = config && config.static && config.static.face;
    facePose = {
      eyes: staticFace ? staticFace.eyes : 'neutral',
      mouth: staticFace ? staticFace.mouth : 'neutral',
      eyeOffsetX: config ? config.face.eyeOffsetX : 0,
      eyeOffsetY: config ? config.face.eyeOffsetY : 0,
      eyeInsetX: config ? config.face.eyeInsetX : 0,
      openness: config ? config.face.openness : 1
    };
    bodyPose = config && config.static ? config.static.body : null;
  } else if (pose) {
    facePose = pose.face;
    bodyPose = pose.body;
  } else {
    facePose = { eyes: 'neutral', mouth: 'neutral', eyeOffsetX: 0, eyeOffsetY: 0, eyeInsetX: 0, openness: 1 };
    bodyPose = null;
  }
  bodyPose = resolveActionBodyPose(bodyPose, { action: actionConfig, expressionId: exprId, source: presentationSource });
  facePose = formArt.faceForView(form, facePose, view);

  // 注视与交互反馈：用真实步长推进弹簧，再作用到脸/身体。
  {
    // 注视门禁：减少动效关闭、表情支持注视、非睡眠、菜单关闭、光标同屏。
    // 门禁清单以 ARCHITECTURE「表达呈现」为准：隐藏、锁屏、拖动、菜单、跨屏才回中。
    // 不要把 runtimeState.petGaze.near 加进来当距离门禁 —— 它是主进程吸附探头用的 120px
    // 阈值，比注视归一化半径（200px）还小，会让光标稍微离开宠物就完全不跟随，
    // 表现出来就是“宠物不再看鼠标了”。眼球最大偏移只有 2 美术像素，同屏跟随
    // 既不喧闹也不产生轨迹。
    let gazeTargetX = 0, gazeTargetY = 0;
    const gazeEnabled = !calmVisual && pose && pose.gaze && pose.gaze.enabled
      && !runtimeState.commandMenuOpen && !runtimeState.foodMenuOpen && !runtimeState.devtoolsOpen
      && (runtimeState.dragging || runtimeState.petGaze.sameDisplay);
    if (gazeEnabled) {
      if (runtimeState.dragging) {
        // 拖动中主进程推送的是中性注视，这里改用有界的拖动速度决定注视方向。
        gazeTargetX = Math.max(-1, Math.min(1, runtimeState.dragVx * 3));
        gazeTargetY = Math.max(-1, Math.min(1, runtimeState.dragVy * 3));
      } else {
        gazeTargetX = runtimeState.petGaze.x;
        gazeTargetY = runtimeState.petGaze.y;
      }
    }
    // 吸附时只朝桌面内侧探头，不朝外看（拖动中不受吸附钳制）。
    if (runtimeState.dockedEdge && !runtimeState.dragging) {
      if (runtimeState.dockedEdge === 'left') gazeTargetX = Math.max(0, gazeTargetX);
      else if (runtimeState.dockedEdge === 'right') gazeTargetX = Math.min(0, gazeTargetX);
      else if (runtimeState.dockedEdge === 'top') gazeTargetY = Math.max(0, gazeTargetY);
      else if (runtimeState.dockedEdge === 'bottom') gazeTargetY = Math.min(0, gazeTargetY);
    }
    gazeSpringX.setTarget(gazeTargetX);
    gazeSpringY.setTarget(gazeTargetY);
    gazeSpringX.step(runtimeState.animDt);
    gazeSpringY.step(runtimeState.animDt);
    if (gazeEnabled) {
      const gaze = pose.gaze;
      facePose = {
        eyes: facePose.eyes,
        mouth: facePose.mouth,
        openness: facePose.openness,
        eyeInsetX: facePose.eyeInsetX,
        eyeOffsetX: Math.max(-3, Math.min(3, facePose.eyeOffsetX
          + gazeSpringX.value * (gaze.maxX || 0) * runtimeState.facing)),
        eyeOffsetY: Math.max(-3, Math.min(3, facePose.eyeOffsetY + gazeSpringY.value * (gaze.maxY || 0)))
      };
    }
    // 交互弹簧（压缩/倾斜）：不在拖动时让倾斜目标归零，随时间衰减。
    if (!runtimeState.dragging) tiltSpring.setTarget(0);
    squashSpring.step(runtimeState.animDt);
    tiltSpring.step(runtimeState.animDt);
  }

  ({ offX, offY, bodyPose } = sleepTransition.step({
    formId: form.id, skinId, view, state: runtimeState.state, expressionId: exprId,
    action: actionConfig, now: runtimeState.animNow, calmVisual, offX, offY, bodyPose
  }));
  // 身体位图按整数设备像素贴出；四肢与道具跟随同一个已量化的原点，
  // 否则它们会相对身体漂半像素。
  offX = snap(offX);
  offY = snap(offY);
  const expressionAccent = resolvePlaybackAccent(runtimeState.expressionRegistry, exprId, actionConfig);
  const artwork = formArt.resolveArtwork(form, {
    channel: runtimeState.renderChannel || 'pet', state: runtimeState.state,
    view, motion: actionConfig ? motion : 'idle', face: facePose, calmVisual, appearance,
    progress: actionT, elapsedMs: runtimeState.animNow, action: actionConfig, expressionId: exprId,
    expressionElapsedMs: runtimeState.animNow - runtimeState.exprStartAnimNow, accent: expressionAccent
  });

  // Smooth the single cached bitmap at the final transform. The source pixel
  // grid stays crisp; nearest-neighbour rotation made contour rows pop in/out.
  pctx.imageSmoothingEnabled = true;
  pctx.save();
  formArt.applyMotionTransform(pctx, form, actionConfig, motion, actionT, {
    artwork, calmVisual,
    facing: runtimeState.facing,
    state: runtimeState.state,
    size,
    bodySize: geo.bodySize,
    translate: petTranslate
  });
  applyExpressionBodyTransform(bodyPose, size);
  applyInteractionTransform(size);
  if (runtimeState.facing === -1) { pctx.translate(size, 0); pctx.scale(-1, 1); }
  applyPetViewTransform(view, size);
  hasAttachedEffectOrigins = Boolean(artwork && Object.hasOwn(artwork, 'effectOrigins'));
  actionEffectOrigins = projectEffectOrigins(artwork?.effectOrigins, pctx.getTransform?.(), {
    stage: geo, offX, offY, formScale: geo.bodySize / form.bodySize
  });

  formArt.drawActionLayer(pctx, {
    form, action: actionConfig, motion, progress: actionT, palette, layer: 'back',
    offX, offY, view, stage: geo, theme: runtimeState.currentTheme, calmVisual,
    backSurface: petActionBackSurface, frontSurface: petActionFrontSurface, artwork, sprites: petSprites
  });
  formArt.drawAppearanceLayer(pctx, appearance, palette, {
    form, stage: geo, layer: 'back', offX, offY, view, artwork,
    theme: runtimeState.currentTheme, elapsedMs: runtimeState.animNow, calmVisual
  });
  drawPetBody(form, skinId, palette, bodyPose ? bodyPose.tone : 'normal', offX, offY, view, artwork);
  if (view === 'back') {
    formArt.drawBackDetails(pctx, form, palette, { cell: geo.cell, offX, offY });
    runtimeState.currentRenderedEyeMask = 'back';
  } else {
    runtimeState.currentRenderedEyeMask = drawLiveFace(form, palette, facePose, isBlinking,
      offX, offY, view, artwork);
  }
  formArt.drawAppearanceLayer(pctx, appearance, palette, {
    form, stage: geo, layer: 'front', offX, offY, view, artwork,
    theme: runtimeState.currentTheme, elapsedMs: runtimeState.animNow, calmVisual
  });
  formArt.drawActionLayer(pctx, {
    form, action: actionConfig, motion, progress: actionT, palette, layer: 'front',
    offX, offY, view, stage: geo, theme: runtimeState.currentTheme, calmVisual,
    backSurface: petActionBackSurface, frontSurface: petActionFrontSurface, artwork, sprites: petSprites
  });
  formArt.drawExpressionAccent(pctx, form, expressionAccent, runtimeState.animNow, {
    offX,
    offY,
    stage: geo,
    calmVisual, view,
    color: '#bb9af7'
  });

  if (runtimeState.state === 'hungry'
    && !formArt.drawStatusEffect(pctx, form, 'hungry', offX, offY, geo, { calmVisual, view, elapsedMs: runtimeState.animNow })) drawCraving(offX, offY, calmVisual);


  // Sakura petals inside pet canvas (skin effect)
  if (calmVisual) {
    // Petals are drawn on the always-visible pet canvas, so merely stopping
    // new particles would leave the old animation running for many frames.
    runtimeState.petals = [];
  } else {
    // 发射以前是每帧 Math.random() < 0.1 抽签；换成每秒 6 片的速率累加器后，
    // 不同帧率下的生成数量一致。位置与速度只在生成时抽取一次。
    if (formArt.skinEffectForSkin(skinId, form) === 'petals') {
      const spawned = petalEmitter.update(runtimeState.animDt);
      for (let i = 0; i < spawned; i++) {
        runtimeState.petals.push({ x: motionRandom() * size, y: -4, vy: 0.5, vx: (motionRandom() - 0.5) * 0.5, life: 100 });
      }
      runtimeState.petalsSpawnedTotal += spawned;
    }
    runtimeState.petals = petEffects.limitParticles(runtimeState.petals).slice(-80);
    runtimeState.petals = runtimeState.petals.filter(p => p.life > 0 && p.y < size);
    // 粒子速度与寿命按“60 FPS 帧当量”换算真实步长，帧率变化不改变轨迹。
    const petalStep = runtimeState.animDt / LEGACY_FRAME_MS;
    for (const p of runtimeState.petals) { p.x += p.vx * petalStep; p.y += p.vy * petalStep; p.life -= petalStep; pctx.fillStyle = '#ffb3c8'; pctx.fillRect(p.x, p.y, 3, 3); }
  }

  pctx.restore();

}

function drawCraving(offX, offY, calmVisual) {
  const float = calmVisual ? 0 : Math.round(Math.sin(runtimeState.animNow / 900));
  const cravingX = offX + 24;
  const cravingY = offY - 14 + float;
  pctx.fillStyle = '#e0af68'; pctx.fillRect(cravingX, cravingY, 16, 3);
  pctx.fillStyle = '#c07f26'; pctx.fillRect(cravingX, cravingY + 3, 16, 3);
  pctx.fillStyle = '#9ece6a'; pctx.fillRect(cravingX + 1, cravingY + 6, 14, 2);
  pctx.fillStyle = '#e0af68'; pctx.fillRect(cravingX, cravingY + 8, 16, 3);
  pctx.fillStyle = '#e0af68';
  pctx.fillRect(offX + 30, offY, 3, 2);
  pctx.fillRect(offX + 31, offY + 4, 2, 2);
}

// ---------- Draw background scene ----------
const SCENE_VIEW = petSceneArt.SCENE_VIEW;

function currentSessionActivity(now = runtimeState.animNow) {
  return runtimeState.sessionActivityController ? runtimeState.sessionActivityController.current(now) : null;
}

function resolveScene(period, now = new Date(currentFrame.wallNow)) {
  const scenes = runtimeState.petContent && runtimeState.petContent.SCENES;
  if (runtimeState.devPreview && runtimeState.devPreview.category === 'scene') {
    const preview = scenes && scenes[runtimeState.devPreview.id];
    if (preview) return preview;
  }
  const automaticSchedule = runtimeState.petContent && runtimeState.petContent.SCENE_SCHEDULE;
  const manualSchedule = runtimeState.petContent && runtimeState.petContent.SCENE_MANUAL_SCHEDULE;
  const schedule = runtimeState.manualSceneSelection && manualSchedule ? manualSchedule : automaticSchedule;
  if (!scenes || !schedule || !Array.isArray(schedule[period])) return null;
  const preferred = runtimeState.petContent.SKIN_SCENE_PREFERENCES && runtimeState.petContent.SKIN_SCENE_PREFERENCES[runtimeState.currentSkin];
  const candidates = runtimeState.manualSceneSelection && Array.isArray(preferred) && preferred.length && now.getDate() % 3 === 0
    ? preferred.filter(id => scenes[id] && scenes[id].periods.includes(period))
    : schedule[period];
  const available = candidates.length ? candidates : schedule[period];
  const daySeed = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  const key = `${daySeed}:${period}:${runtimeState.currentSkin}:${runtimeState.manualSceneSelection ? 'manual' : 'auto'}:${runtimeState.sceneOffset}`;
  if (runtimeState.selectedScene.key !== key) {
    const index = Math.abs(daySeed + runtimeState.sceneOffset) % available.length;
    runtimeState.selectedScene = { key, value: scenes[available[index]] || null };
    resetSceneParticles();
  }
  return runtimeState.selectedScene.value;
}

function drawSceneBackdrop(scene, calmVisual) {
  const form = forms.resolvePetForm(runtimeState.devPreview?.skin || runtimeState.currentSkin);
  petSceneLayer.drawBackdrop(scene, calmVisual, context => formArt.drawSceneBackdrop(context, form,
    { scene, calmVisual, elapsedMs: runtimeState.animNow }));
}

function drawSessionSceneBackdrop(mode, activity, calmVisual) {
  const form = forms.resolvePetForm(runtimeState.devPreview?.skin || runtimeState.currentSkin);
  petSceneLayer.drawSessionBackdrop(mode, activity, calmVisual, context => formArt.drawSceneBackdrop(context, form,
    { mode, activity, calmVisual, elapsedMs: runtimeState.animNow }));
}

function drawScene() {
  sctx.clearRect(0, 0, 220, 220);
  if (runtimeState.dockedEdge) {
    resetSceneParticles();
    return;
  }
  const calmVisual = currentFrame.policy.calmVisual;
  if (runtimeState.sessionState === 'focused' || runtimeState.sessionState === 'resting') {
    drawSessionSceneBackdrop(runtimeState.sessionState, currentSessionActivity(), calmVisual);
    runtimeState.sceneParticles = [];
    resetSceneParticles();
    return;
  }
  const now = new Date(currentFrame.wallNow);
  const period = getTimePeriod(now.getHours());
  const scene = resolveScene(period, now);
  drawSceneBackdrop(scene, calmVisual);
  if (currentFrame.policy.calmVisual) {
    runtimeState.sceneParticles = [];
    resetSceneParticles();
    return;
  }

  // Old clients/content packs still receive a complete fallback scene.
  if (!scene) {
    const decs = (runtimeState.petContent && runtimeState.petContent.SCENE_DECORATIONS && runtimeState.petContent.SCENE_DECORATIONS[period]) || [];
    for (const d of decs) {
      if (d.type === 'sun') drawSun(d.x || 30, d.y || 20, d.size || 20, d.color);
      else if (d.type === 'moon') drawMoon(d.x || 30, d.y || 20, d.size || 20, d.color);
      else if (d.type === 'sunset') drawSunset();
    }
  }

  // Update + draw scene particles
  spawnSceneParticles(period, scene);
  runtimeState.sceneParticles = petSceneLayer.limitParticles(runtimeState.sceneParticles);
  // 粒子速度与寿命按“60 FPS 帧当量”换算真实步长，不同帧率下轨迹一致。
  const sceneStep = runtimeState.animDt / LEGACY_FRAME_MS;
  for (const p of runtimeState.sceneParticles) {
    p.x += p.vx * sceneStep;
    // 这是旧 60 FPS 离散积分的可组合闭式形式。分割成 6/30/60 FPS 的任意
    // 步长，终点都与逐个 legacy frame 更新一致。
    const gravity = Number(p.gravity) || 0;
    p.y = petMotion.advanceDiscretePosition(p.y, p.vy, gravity, sceneStep);
    p.vy += gravity * sceneStep;
    p.life -= sceneStep;
    if (formArt.drawSceneParticle(sctx, forms.resolvePetForm(runtimeState.devPreview?.skin || runtimeState.currentSkin), p)) continue;
    if (p.type === 'cloud') drawCloud(p.x, p.y, p.size, p.color);
    else if (p.type === 'butterfly') drawButterfly(p.x, p.y, p.color, p.life);
    else if (p.type === 'star') drawTwinkleStar(p.x, p.y, p.color, p.life, p.baseLife);
    else if (p.type === 'firefly') drawFirefly(p.x, p.y, p.color, p.life);
    else if (p.type === 'plane') drawPlane(p.x, p.y, p.color);
    else if (p.type === 'bird') drawBird(p.x, p.y, p.color, p.life);
    else if (p.type === 'petal') { sctx.fillStyle = p.color; sctx.fillRect(p.x, p.y, 3, 3); }
    else if (p.type === 'dust') drawDust(p.x, p.y, p.color, p.life, p.baseLife);
    else if (p.type === 'leaf') drawLeaf(p.x, p.y, p.color);
    else if (p.type === 'bubble') drawBubble(p.x, p.y, p.size, p.color);
    else if (p.type === 'spark') { sctx.fillStyle = p.color; sctx.fillRect(p.x, p.y, 2, 2); }
    else if (p.type === 'dragonfly') drawDragonfly(p.x, p.y, p.color);
    else if (p.type === 'bat') drawBat(p.x, p.y, p.color);
    else if (p.type === 'starDust') { sctx.fillStyle = p.color; sctx.fillRect(p.x, p.y, 1, 1); }
    else if (p.type === 'codeRain') drawCodeRain(p);
    else if (p.type === 'note') drawNote(p.x, p.y, p.color);
    else if (p.type === 'rain') drawRain(p);
    else if (p.type === 'snow') drawSnow(p);
    else if (p.type === 'steam' || p.type === 'mist') drawSteam(p);
    else if (p.type === 'shootingStar') drawShootingStar(p);
    else if (p.type === 'fish') drawFish(p);
    else if (p.type === 'light' || p.type === 'pixel' || p.type === 'sparkle' || p.type === 'ember' || p.type === 'flash') drawSceneGlow(p);
    else if (p.type === 'page') drawPage(p);
  }
}

// 场景粒子数组与当前场景的速率累加器同生命周期：换场景、进入专注/休息、
// 吸附或策略收紧时一起清空，累加器不跨场景结转。
function resetSceneParticles() {
  petSceneLayer.resetParticles();
  runtimeState.sceneParticles = [];
  sceneEmitterRates = null;
}
function clearDecorativeParticles() {
  sleepTransition.reset();
  actionPlayback.reset();
  resetSceneParticles();
  runtimeState.overlayParticles = [];
  runtimeState.petals = [];
  petalEmitter.reset();
  sakuraRainEmitter.reset();
  resetPetActionEmitters();
}
function sceneEmitterAccumulators(scene) {
  if (!sceneEmitterRates) {
    sceneEmitterRates = ((scene && scene.emitters) || []).map(emitter => ({
      emitter,
      // 遗留 chance 是“60 FPS 每帧概率”，换算成每秒速率后与帧率无关。
      rate: petMotion.createRateEmitter({ ratePerSecond: (Number(emitter.chance) || 0) * 60 })
    }));
  }
  return sceneEmitterRates;
}

function spawnSceneParticles(period, scene) {
  if (currentFrame.policy.calmVisual) return;
  if (scene) {
    for (const { emitter, rate } of sceneEmitterAccumulators(scene)) {
      const spawned = rate.update(runtimeState.animDt);
      for (let i = 0; i < spawned; i++) spawnConfiguredParticle(emitter);
    }
  } else {
    // Time-based fallback particles for legacy content packs.
    if (period === 'morning') {
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.morningCloud, () => {
        runtimeState.sceneParticles.push({ type: 'cloud', x: -30, y: rand(20, 60), size: rand(15, 25), vx: 0.15, vy: 0, life: 1600, color: '#c0caf5' });
      });
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.morningBird, () => {
        runtimeState.sceneParticles.push({ type: 'bird', x: -20, y: rand(30, 80), vx: rand(0.8, 1.5), vy: 0, life: 300, baseLife: 300, color: '#7aa2f7' });
      });
    }
    if (period === 'noon' || period === 'forenoon') {
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.daylightButterfly, () => {
        runtimeState.sceneParticles.push({ type: 'butterfly', x: rand(0, 220), y: rand(20, 100), vx: rand(-0.6, 0.6), vy: rand(-0.3, 0.3), life: 400, baseLife: 400, color: pick(['#f7768e', '#e0af68', '#bb9af7']) });
      });
    }
    if (period === 'afternoon') {
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.afternoonPlane, () => {
        runtimeState.sceneParticles.push({ type: 'plane', x: -30, y: rand(30, 60), vx: rand(1.2, 1.8), vy: 0, life: 200, color: '#c0caf5' });
      });
    }
    if (period === 'evening') {
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.eveningDragonfly, () => {
        runtimeState.sceneParticles.push({ type: 'dragonfly', x: rand(0, 220), y: rand(40, 100), vx: rand(-0.5, 0.5), vy: 0, life: 250, color: '#bb9af7' });
      });
    }
    if (period === 'night') {
      emitPetRate(petFallbackSceneEmitters.nightFirefly, () => {
        if (runtimeState.sceneParticles.filter(p => p.type === 'firefly').length >= 4) return;
        runtimeState.sceneParticles.push({ type: 'firefly', x: rand(20, 200), y: rand(20, 180), vx: rand(-0.2, 0.2), vy: rand(-0.2, 0.2), life: 300, baseLife: 300, color: '#e0af68' });
        runtimeState.sceneSpawnedTotal += 1;
      });
    }
    if (period === 'night' || period === 'lateNight') {
      emitPetRate(petFallbackSceneEmitters.nightStar, () => {
        if (runtimeState.sceneParticles.filter(p => p.type === 'star').length >= 8) return;
        runtimeState.sceneParticles.push({ type: 'star', x: rand(10, 210), y: rand(10, 80), vx: 0, vy: 0, life: rand(200, 600), baseLife: 400, color: pick(['#c0caf5', '#e0af68', '#bb9af7']) });
        runtimeState.sceneSpawnedTotal += 1;
      });
    }
    if (period === 'lateNight') {
      runtimeState.sceneSpawnedTotal += emitPetRate(petFallbackSceneEmitters.lateNightBat, () => {
        runtimeState.sceneParticles.push({ type: 'bat', x: -20, y: rand(20, 70), vx: rand(1, 1.6), vy: 0, life: 250, color: '#414868' });
      });
    }
  }

  // Skin-specific
  if (runtimeState.currentSkin === 'forest') {
    runtimeState.sceneSpawnedTotal += emitPetRate(petSkinSceneEmitters.forest, () => {
      runtimeState.sceneParticles.push({ type: 'leaf', x: rand(0, 220), y: -5, vx: rand(-0.2, 0.2), vy: rand(0.4, 0.8), life: 500, color: pick(['#9ece6a', '#528b41']) });
    });
  }
  if (runtimeState.currentSkin === 'ocean') {
    runtimeState.sceneSpawnedTotal += emitPetRate(petSkinSceneEmitters.ocean, () => {
      runtimeState.sceneParticles.push({ type: 'bubble', x: rand(0, 220), y: 220, vx: rand(-0.1, 0.1), vy: rand(-0.5, -0.9), size: rand(3, 6), life: 400, color: 'rgba(125,207,255,0.7)' });
    });
  }
  if (runtimeState.currentSkin === 'flame') {
    runtimeState.sceneSpawnedTotal += emitPetRate(petSkinSceneEmitters.flame, () => {
      runtimeState.sceneParticles.push({ type: 'spark', x: 75 + rand(-10, 70), y: 130 + rand(0, 20), vx: rand(-0.3, 0.3), vy: rand(-1.5, -0.8), life: 40, color: pick(['#ff7a5c', '#e0af68', '#ffcc5c']) });
    });
  }
  if (runtimeState.currentSkin === 'moon') {
    runtimeState.sceneSpawnedTotal += emitPetRate(petSkinSceneEmitters.moon, () => {
      runtimeState.sceneParticles.push({ type: 'starDust', x: rand(0, 220), y: rand(0, 220), vx: rand(-0.05, 0.05), vy: rand(-0.05, 0.05), life: 80, color: pick(['#bb9af7', '#c0caf5', '#7dcfff']) });
    });
  }

  // Sakura skin: extra petal rain outside pet canvas.
  // 旧 `Math.random() < 0.06` 每帧抽签换成每秒 3.6 片的速率累加器。
  if (runtimeState.currentSkin === 'sakura') {
    const spawned = sakuraRainEmitter.update(runtimeState.animDt);
    for (let i = 0; i < spawned; i++) {
      runtimeState.sceneParticles.push({ type: 'petal', x: rand(0, 220), y: -5, vx: rand(-0.3, 0.3), vy: rand(0.5, 1), life: 400, color: '#ffb3c8' });
    }
    runtimeState.sceneSpawnedTotal += spawned;
  }

  // Sing egg: music notes
  if (runtimeState.currentEgg && runtimeState.currentEgg.id === 'sing') {
    runtimeState.sceneSpawnedTotal += emitPetRate(petActionEmitters.sing, () => {
      runtimeState.sceneParticles.push({ type: 'note', x: 90 + rand(-10, 30), y: 90 + rand(-5, 5), vx: rand(-0.4, 0.4), vy: rand(-1, -0.5), life: 60, color: pick(['#f7768e', '#e0af68', '#bb9af7']) });
    });
  }
}

// 发射节奏由调用方的速率累加器决定，这里只负责“生成一个”：
// 同类型数量仍受 emitter.max 上限约束，属性只在生成时随机一次。
function spawnConfiguredParticle(emitter) {
  const current = runtimeState.sceneParticles.filter(p => p.type === emitter.type).length;
  if (current >= emitter.max) return;
  const type = emitter.type;
  const speed = Number(emitter.speed) || 0.5;
  const color = pick(emitter.colors || ['#c0caf5']);
  const particle = {
    type, color, x: rand(14, 206), y: rand(18, 146), vx: rand(-speed * 0.25, speed * 0.25),
    vy: rand(-speed * 0.2, speed * 0.2), size: rand(2, 5), life: 260, baseLife: 260
  };
  if (['cloud', 'bird', 'plane', 'light', 'fish', 'shootingStar'].includes(type)) {
    particle.x = speed >= 0 ? -24 : 224;
    particle.y = rand(24, 118);
    particle.vx = speed * rand(0.75, 1.2);
    particle.vy = type === 'shootingStar' ? speed * 0.48 : rand(-0.05, 0.05);
    particle.life = particle.baseLife = type === 'cloud' ? 1_600 : 260;
    if (type === 'cloud') particle.size = rand(16, 30);
  } else if (['rain', 'snow', 'leaf', 'petal', 'page', 'pixel', 'codeRain'].includes(type)) {
    particle.x = rand(14, 206); particle.y = 12;
    particle.vx = type === 'rain' ? -speed * 0.16 : rand(-speed * 0.35, speed * 0.35);
    particle.vy = type === 'rain' ? speed : speed * rand(0.65, 1.2);
    particle.life = particle.baseLife = 180;
    if (type === 'codeRain') particle.ch = pick(['0', '1', '⌁', '·', '◆']);
  } else if (['bubble', 'steam', 'ember'].includes(type)) {
    particle.x = type === 'steam' ? rand(75, 105) : rand(25, 195);
    particle.y = type === 'steam' ? 102 : 176;
    particle.vx = rand(-speed * 0.2, speed * 0.2); particle.vy = -speed * rand(0.7, 1.25);
    particle.life = particle.baseLife = 190;
  } else if (type === 'mist') {
    particle.x = -28; particle.y = rand(30, 130); particle.vx = speed; particle.vy = 0;
    particle.size = rand(24, 48); particle.life = particle.baseLife = 1_300;
  } else if (type === 'star') {
    particle.vx = 0; particle.vy = 0; particle.life = particle.baseLife = rand(240, 620);
  } else if (type === 'firefly' || type === 'starDust' || type === 'sparkle') {
    particle.vx = rand(-speed, speed); particle.vy = rand(-speed, speed);
    particle.life = particle.baseLife = rand(90, 320);
  } else if (type === 'flash') {
    particle.x = 14; particle.y = 14; particle.vx = 0; particle.vy = 0;
    particle.size = 192; particle.life = particle.baseLife = 8;
  }
  runtimeState.sceneSpawnedTotal += 1;
  runtimeState.sceneParticles.push(particle);
}

// ---------- Scene drawing primitives ----------
function drawSun(x, y, size, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, size, size);
  sctx.fillRect(x + 2, y - 2, size - 4, 2);
  sctx.fillRect(x + 2, y + size, size - 4, 2);
  sctx.fillRect(x - 2, y + 2, 2, size - 4);
  sctx.fillRect(x + size, y + 2, 2, size - 4);
  // rays
  const ray = Math.sin(legacyFramesAt(runtimeState.animNow) * 0.05) * 2 + 4;
  sctx.fillRect(x + size / 2 - 1, y - ray, 2, ray);
  sctx.fillRect(x + size / 2 - 1, y + size, 2, ray);
  sctx.fillRect(x - ray, y + size / 2 - 1, ray, 2);
  sctx.fillRect(x + size, y + size / 2 - 1, ray, 2);
}

function drawMoon(x, y, size, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, size, size);
  sctx.fillRect(x + 2, y - 2, size - 4, 2);
  sctx.fillRect(x + 2, y + size, size - 4, 2);
  sctx.fillRect(x - 2, y + 2, 2, size - 4);
  sctx.fillRect(x + size, y + 2, 2, size - 4);
  // crater bite
  sctx.fillStyle = 'transparent';
  sctx.clearRect(x + size - 6, y + 2, 5, 5);
  sctx.clearRect(x + 3, y + size - 8, 4, 4);
}

function drawSunset() {
  const g = sctx.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, '#ff7a5c');
  g.addColorStop(0.5, '#f7768e');
  g.addColorStop(1, 'transparent');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, 220, 100);
}

function drawCloud(x, y, size, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, size, 4);
  sctx.fillRect(x + 2, y - 3, size - 4, 3);
  sctx.fillRect(x + 6, y - 6, size - 12, 3);
  sctx.fillRect(x - 2, y + 4, size + 4, 2);
}

function drawButterfly(x, y, color, life) {
  const flap = Math.sin(life * 0.4) * 3;
  sctx.fillStyle = color;
  sctx.fillRect(x - 3 - flap, y - 2, 3, 4);
  sctx.fillRect(x + flap, y - 2, 3, 4);
  sctx.fillStyle = '#1a1b26';
  sctx.fillRect(x - 1, y - 1, 2, 3);
}

function drawTwinkleStar(x, y, color, life, baseLife) {
  const twinkle = Math.sin((baseLife - life) * 0.1) * 0.5 + 0.5;
  if (twinkle < 0.3) return;
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 2, 2);
  if (twinkle > 0.6) {
    sctx.fillRect(x + 1, y - 1, 1, 1);
    sctx.fillRect(x + 1, y + 2, 1, 1);
    sctx.fillRect(x - 1, y + 1, 1, 1);
    sctx.fillRect(x + 2, y + 1, 1, 1);
  }
}

function drawFirefly(x, y, color, life) {
  const glow = Math.abs(Math.sin(life * 0.1));
  if (glow < 0.2) return;
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 2, 2);
  sctx.globalAlpha = glow * 0.4;
  sctx.fillRect(x - 2, y - 2, 6, 6);
  sctx.globalAlpha = 1;
}

function drawPlane(x, y, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 10, 2);
  sctx.fillRect(x + 2, y - 2, 3, 2);
  sctx.fillRect(x + 3, y + 2, 3, 2);
  // trail
  sctx.globalAlpha = 0.3;
  sctx.fillRect(x - 20, y, 20, 1);
  sctx.globalAlpha = 1;
}

function drawBird(x, y, color, life) {
  const flap = Math.sin(life * 0.3) > 0 ? 1 : -1;
  sctx.fillStyle = color;
  sctx.fillRect(x - 3, y + flap, 3, 1);
  sctx.fillRect(x, y, 2, 2);
  sctx.fillRect(x + 2, y + flap, 3, 1);
}

function drawDust(x, y, color, life, baseLife) {
  const fade = life / (baseLife || 100);
  sctx.globalAlpha = fade * 0.5;
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 1, 1);
  sctx.globalAlpha = 1;
}

function drawLeaf(x, y, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 4, 2);
  sctx.fillRect(x + 1, y + 2, 2, 2);
}

function drawBubble(x, y, size, color) {
  sctx.strokeStyle = color;
  sctx.lineWidth = 1;
  sctx.strokeRect(x, y, size, size);
  sctx.fillStyle = 'rgba(255,255,255,0.4)';
  sctx.fillRect(x + 1, y + 1, 1, 1);
}

function drawDragonfly(x, y, color) {
  const flap = Math.sin(legacyFramesAt(runtimeState.animNow) * 0.4) * 2;
  sctx.fillStyle = color;
  sctx.fillRect(x - 4, y - 1, 3, 1 + flap * 0.5);
  sctx.fillRect(x + 2, y - 1, 3, 1 + flap * 0.5);
  sctx.fillRect(x - 1, y, 3, 1);
}

function drawBat(x, y, color) {
  const flap = Math.sin(legacyFramesAt(runtimeState.animNow) * 0.5) > 0;
  sctx.fillStyle = color;
  if (flap) {
    sctx.fillRect(x - 5, y - 2, 4, 2);
    sctx.fillRect(x + 2, y - 2, 4, 2);
  } else {
    sctx.fillRect(x - 4, y, 4, 2);
    sctx.fillRect(x + 1, y, 4, 2);
  }
  sctx.fillRect(x - 1, y, 3, 2);
}

function drawCodeRain(p) {
  sctx.fillStyle = p.color;
  sctx.font = '10px monospace';
  sctx.fillText(p.ch, p.x, p.y);
}

function drawNote(x, y, color) {
  sctx.fillStyle = color;
  sctx.fillRect(x, y, 2, 5);
  sctx.fillRect(x - 2, y + 4, 4, 2);
  sctx.fillRect(x + 2, y - 1, 3, 1);
}

function drawRain(p) {
  sctx.globalAlpha = 0.34 + 0.3 * (p.life / p.baseLife);
  sctx.fillStyle = p.color;
  sctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 6);
  sctx.fillRect(Math.round(p.x - 1), Math.round(p.y + 5), 1, 2);
  sctx.globalAlpha = 1;
}

function drawSnow(p) {
  const pulse = 0.45 + Math.abs(Math.sin((p.baseLife - p.life) * 0.08)) * 0.5;
  sctx.globalAlpha = pulse;
  sctx.fillStyle = p.color;
  sctx.fillRect(Math.round(p.x - 1), Math.round(p.y), 3, 1);
  sctx.fillRect(Math.round(p.x), Math.round(p.y - 1), 1, 3);
  sctx.globalAlpha = 1;
}

function drawSteam(p) {
  const fade = Math.max(0, p.life / p.baseLife);
  sctx.globalAlpha = fade * 0.42;
  sctx.fillStyle = p.color;
  const size = Math.max(2, Math.round(p.size + (1 - fade) * 5));
  sctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
  sctx.fillRect(Math.round(p.x + size), Math.round(p.y - 2), Math.max(1, size - 2), 2);
  sctx.globalAlpha = 1;
}

function drawShootingStar(p) {
  sctx.fillStyle = p.color;
  sctx.fillRect(Math.round(p.x), Math.round(p.y), 4, 2);
  sctx.globalAlpha = 0.55;
  sctx.fillRect(Math.round(p.x - 14), Math.round(p.y - 4), 14, 1);
  sctx.fillRect(Math.round(p.x - 8), Math.round(p.y - 2), 8, 1);
  sctx.globalAlpha = 1;
}

function drawFish(p) {
  const direction = p.vx >= 0 ? 1 : -1;
  sctx.fillStyle = p.color;
  sctx.fillRect(Math.round(p.x), Math.round(p.y), 8, 4);
  sctx.fillRect(Math.round(p.x + (direction > 0 ? -3 : 8)), Math.round(p.y + 1), 3, 2);
  sctx.fillStyle = '#1a1b26';
  sctx.fillRect(Math.round(p.x + (direction > 0 ? 6 : 1)), Math.round(p.y + 1), 1, 1);
}

function drawSceneGlow(p) {
  const fade = Math.max(0, p.life / p.baseLife);
  const pulse = p.type === 'flash' ? fade : 0.35 + Math.abs(Math.sin(p.life * 0.11)) * 0.65;
  sctx.globalAlpha = pulse * (p.type === 'light' ? 0.7 : 0.9);
  sctx.fillStyle = p.color;
  const size = p.type === 'flash' ? p.size : p.type === 'pixel' ? 3 : 2;
  sctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
  if (p.type === 'sparkle') {
    sctx.fillRect(Math.round(p.x - 2), Math.round(p.y + 1), 6, 1);
    sctx.fillRect(Math.round(p.x + 1), Math.round(p.y - 2), 1, 6);
  }
  if (p.type === 'ember') sctx.fillRect(Math.round(p.x), Math.round(p.y + 3), 1, 3);
  sctx.globalAlpha = 1;
}

function drawPage(p) {
  sctx.save();
  sctx.translate(p.x, p.y);
  sctx.rotate(Math.sin(p.life * 0.08) * 0.35);
  sctx.fillStyle = p.color;
  sctx.fillRect(-4, -3, 8, 6);
  sctx.fillStyle = 'rgba(50,45,55,0.45)';
  sctx.fillRect(-2, -1, 4, 1);
  sctx.restore();
}

// ---------- Overlay canvas ----------
function drawOverlay() {
  octx.clearRect(0, 0, 220, 220);
  const calmVisual = currentFrame.policy.calmVisual;
  // Focus/rest identity lives in the contained room and activity bar. A
  // second pulsing rectangle around the pet only adds another competing edge.
  // Star burst when celebrating
  if (runtimeState.currentExprId === 'react.celebrate' && !calmVisual) {
    // 旧 ((frame + i*10) % 60) / 60：60 帧一个循环；颜色以前每帧 pick()
    // 重抽导致星星逐帧闪烁，现在每颗星按序号绑定固定颜色。
    const burstFrames = legacyFramesAt(runtimeState.animNow);
    for (let i = 0; i < 12; i++) {
      const t = ((burstFrames + i * 10) % 60) / 60;
      const angle = (i / 12) * Math.PI * 2;
      const dist = t * 50;
      const x = 110 + Math.cos(angle) * dist;
      const y = 110 + Math.sin(angle) * dist;
      octx.fillStyle = CELEBRATE_STAR_COLORS[i % CELEBRATE_STAR_COLORS.length];
      octx.globalAlpha = 1 - t;
      octx.fillText('✦', x, y);
    }
    octx.globalAlpha = 1;
  }
  // Overlay particles (drag trails, easter eggs, etc.)
  if (calmVisual) {
    runtimeState.overlayParticles = [];
  } else {
    // 覆盖层粒子同样按真实步长推进，帧率变化不改变飞行速度与寿命。
    const overlayStep = runtimeState.animDt / LEGACY_FRAME_MS;
    runtimeState.overlayParticles = runtimeState.overlayParticles.filter(p => p.life > 0);
    for (const p of runtimeState.overlayParticles) {
      p.x += p.vx * overlayStep;
      const gravity = Number(p.gravity) || 0;
      p.y = petMotion.advanceDiscretePosition(p.y, p.vy, gravity, overlayStep);
      p.vy += gravity * overlayStep;
      p.life -= overlayStep;
      formArt.drawParticle(octx, forms.resolvePetForm(runtimeState.devPreview?.skin || runtimeState.currentSkin), p);
    }
  }

  // Egg-specific overlays
  if (runtimeState.currentEgg && !calmVisual) drawEggOverlay();
  else if (runtimeState.devPreview && runtimeState.currentRenderedAction && !calmVisual) drawEggOverlay();
  runtimeState.overlayParticles = petEffects.limitParticles(runtimeState.overlayParticles);
}

function drawEggOverlay() {
  const t = runtimeState.currentActionProgress;
  const action = runtimeState.currentRenderedAction;
  if (!action) return;
  const id = action.id;
  emitActionEffect(action, t);
  formArt.drawActionOverlay(octx, forms.resolvePetForm(runtimeState.devPreview?.skin || runtimeState.currentSkin), action, t, {
    calmVisual: false,
    petCanvas,
    stage: runtimeState.petStageGeo
  });
  if (id === 'workout') {
    // sweat drops
    emitPetRate(petActionEmitters.workout, () => {
      appendActionParticle({ type: 'sweat', x: 100 + rand(-5, 15), y: 100, vx: rand(-0.3, 0.3), vy: 1, gravity: 0.1, life: 25, color: '#7dcfff' });
    });
  }
  if (id === 'bubble-blow' && !hasAttachedEffectOrigins) {
    emitPetRate(petActionEmitters.bubble, () => {
      appendActionParticle({ type: 'bubble', x: 140, y: 105, vx: rand(0.2, 0.5), vy: rand(-0.3, -0.1), size: 4, life: 60, color: 'rgba(200,220,255,0.7)' });
    });
  }
}

function emitActionEffect(action, progress) {
  // 每个行为声明一个语义 effect；这里查表拿到画笔与配色。未登记的 effect
  // 一律不发粒子（历史上会默默变成金色 ✦，导致“每个动作都冒同样的十字星”）。
  const visual = resolveActionEffectVisual(action.effect);
  if (!visual) return;
  // 安静类特效（打坐光环、困倦 zzz、热气）走稀疏发射器并向上轻飘，
  // 不与庆祝类同频，避免安静动作也像放烟花。
  const attachedBubble = (action.id === 'bubble-blow' && hasAttachedEffectOrigins)
    || (action.id === 'hiccup' && Boolean(actionEffectOrigins.bubbles));
  const origin = attachedBubble ? actionEffectOrigins.bubbles : null;
  const gentleHiccup = action.id === 'hiccup' && Boolean(origin);
  if (attachedBubble && !origin) return;
  const emitter = attachedBubble ? petActionEmitters.bubble : visual.calm ? petActionEmitters.calm : petActionEmitters.generic;
  emitPetRate(emitter, () => {
    const angle = visual.calm ? rand(-Math.PI * 0.65, -Math.PI * 0.35) : rand(-Math.PI, 0);
    const speed = rand(0.35, 1.2) * (visual.calm ? 0.55 : 1);
    appendActionParticle({
      type: visual.type,
      actionId: action.id,
      effect: action.effect,
      glyph: visual.glyphs ? pick(visual.glyphs) : undefined,
      x: origin ? origin.x : 110 + Math.cos(progress * Math.PI * 4) * 18,
      y: origin ? origin.y : 105 + Math.sin(progress * Math.PI * 3) * 10,
      vx: origin ? origin.direction * (gentleHiccup ? rand(.45, .75) : rand(.2, .5)) : Math.cos(angle) * speed,
      vy: origin ? (gentleHiccup ? rand(-.08, -.04) : rand(-.3, -.1)) : Math.sin(angle) * speed,
      gravity: ['puff', 'crumb', 'petal', 'leaf'].includes(visual.type) ? 0.04 : 0,
      size: gentleHiccup ? rand(2, 4) : rand(2, 6), life: gentleHiccup ? 30 : 46, baseLife: gentleHiccup ? 30 : 46, color: pick(visual.colors)
    });
  });
}


  const outputFields = Object.freeze([
    'actionParticlesSpawnedTotal', 'currentActionProgress', 'currentExprId',
    'exprStartAnimNow', 'currentRenderedEyeMask', 'petals', 'petalsSpawnedTotal',
    'selectedScene', 'sceneParticles', 'overlayParticles', 'sceneSpawnedTotal'
  ]);
  const commands = Object.freeze({
    render: () => { drawScene(); drawPet(); drawOverlay(); },
    drawScene, resetSceneParticles, clearDecorativeParticles, currentSessionActivity, resolveScene,
    mirrorPlaybackSnapshot: actionPlayback.snapshot,
    activityCombinationSnapshot: actionPlayback.combinationSnapshot
  });
  function executeFrame(frame, command = 'render', args = []) {
    if (!frame || !Object.isFrozen(frame) || !Object.hasOwn(commands, command)) throw new TypeError('invalid pet frame command');
    const previousFrame = currentFrame;
    const previousState = runtimeState;
    currentFrame = frame;
    runtimeState = { ...copyFrameData(frame.state), petContent: frame.content, petStageGeo: frame.stage, ...readEngines() };
    try {
      const value = commands[command](...args);
      const changedFields = command === 'currentSessionActivity' ? [] : outputFields;
      const updates = Object.fromEntries(changedFields.filter(name => Object.hasOwn(runtimeState, name))
        .map(name => [name, copyFrameData(runtimeState[name])]));
      return Object.freeze({ value, updates: freezeFrameData(updates) });
    } finally {
      currentFrame = previousFrame;
      runtimeState = previousState;
    }
  }
  return Object.freeze({ executeFrame });
}

export default Object.freeze({ createPetRenderer });
