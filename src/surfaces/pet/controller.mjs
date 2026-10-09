import petMotion from '../../core/pet-motion.mjs';
import petExpression from '../../core/pet-expression.mjs';
import petPresentation from '../../core/pet-presentation.mjs';
import petSprite from '../../core/pet-sprite.mjs';
import petPlayerCore from '../../core/pet-player.mjs';
import petSessionActivity from '../../core/session-activity.mjs';
import petArt from '../../core/pet-art.mjs';
import petSceneArt from '../../core/pet-scene-art.mjs';
import petFace from '../../core/pet-face.mjs';
import sensoryPolicy from '../../core/sensory-policy.mjs';
import { classifyWorkPeriod } from '../../content/work-period.mjs';
import { forms } from '../../capabilities/companion/index.mjs';
import { createPetLifecycle } from './lifecycle.mjs';
import { createPetCompositor } from './compositor.mjs';
import { createPetScene } from './scene.mjs';
import { createPetEffects } from './effects.mjs';
import { createSessionOrbit } from './session-orbit.mjs';
import { createLegacyFocusRing } from './legacy-focus-ring.mjs';
import { createPetSync, normalizeGaze } from './sync.mjs';
import { createNotebookVisit } from './notebook-visit.mjs';
import { createPetCommands } from './commands.mjs';
import { createPetFoodMenu } from './food-menu.mjs';
import { createPetPointer } from './pointer.mjs';
import { createPetMenu } from './menu.mjs';
import { createPetDevtools } from './devtools.mjs';
import { createPetRenderer } from './renderer.mjs';
import { createPetHitLayout } from './hit-layout.mjs';
import { createPetFrameContext, copyFrameData } from './frame-context.mjs';
import { createPetSpeech } from './speech.mjs';
import { createContextEmphasis } from './context-emphasis.mjs';
import { createManualActionPlayback, createInteractionParticles } from './interaction-playback.mjs';
import { activityModeFor, activityControllerContent, applyActivityMirrorSync, mirrorBaseExpressionFor } from './activity-mirror.mjs';

export function createPetController({ environment, clients } = {}) {
  if (!environment || !environment.window || !environment.document) throw new TypeError('pet runtime environment is required');
  if (!clients || typeof clients !== 'object') throw new TypeError('pet runtime client is required');
  const window = environment.window;
  const document = environment.document;
  const Date = environment.Date || globalThis.Date;
  const Math = environment.Math || globalThis.Math;
  const performance = environment.performance || globalThis.performance;
  if (typeof environment.requestAnimationFrame !== 'function') throw new TypeError('pet runtime requires requestAnimationFrame');
  const lifetime = createPetLifecycle(environment);
  const { requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, setInterval, clearInterval, listen } = lifetime;
  let started = false;
  let stopped = false;
  let frameHandle = null;
  let initialization = null;
// ARCHITECTURE「表达呈现」: the controller coordinates the shared frame loop,
// layered canvas, input and scoped presentation owners. Business commands and
// autonomous cue selection remain behind the main-process capability boundary.

const $ = (s) => document.querySelector(s);

const petCanvas = $('#petCanvas');
const petLayer = $('#petLayer');
const petHit = $('#petHit');
const sceneCanvas = $('#sceneCanvas');
const overlayCanvas = $('#overlayCanvas');
const stage = $('#stage');
const bubble = $('#bubble');

const pctx = petCanvas.getContext('2d'); pctx.imageSmoothingEnabled = false;
const sctx = sceneCanvas.getContext('2d'); sctx.imageSmoothingEnabled = false;
const octx = overlayCanvas.getContext('2d'); octx.imageSmoothingEnabled = false;

// ---------- Pixel stage ----------
// 宠物舞台几何由形态门面与 core/pet-stage.mjs 解析：身体 66 美术单位居中，四周留
// 40 美术单位余量给四肢、道具、装饰和旋转；光栅依据实际 CSS 尺寸与 DPR。
// 所有绘制仍然用美术像素坐标，由基底变换统一放大。
let petStageGeo = forms.resolveFormStage('pink', window.devicePixelRatio || 1);
const petHitLayout = createPetHitLayout({ hit: petHit, canvas: petCanvas, root: stage,
  getStage: () => petStageGeo });

// 身体位图缓存只按皮肤 × 离散色调 × 版型建键；表情、眨眼、注视和连续
// 位姿全部留在 live layer，避免状态组合让缓存无界增长。
const petSprites = petSprite.createPetSpriteCache({
  createSurface(width, height) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    return surface;
  },
  capacity: 32
});
// 活动脸每帧会变，但 surface 本身固定复用。先在无旋转、无缩放的身体坐标中
// 合成，再作为一张贴图进入身体变换，避免逐格 fillRect 的亚像素棋盘缝。
const petFaceSurface = document.createElement('canvas');
const petActionBackSurface = document.createElement('canvas');
const petActionFrontSurface = document.createElement('canvas');

const petCompositor = createPetCompositor({
  context: pctx,
  faceSurface: petFaceSurface,
  spriteCache: petSprites,
  getGeometry: () => petStageGeo,
  getBodyKey: (bodyTone, bodyVariant) => petArt.bodySpriteKey(currentSkin, bodyTone, bodyVariant),
  paintBody: (surface, palette, bodyTone, geometry, bodyVariant) => petArt.paintBodySprite(surface, palette, bodyTone, geometry, bodyVariant),
  paintFace: (surface, palette, face, blinking, geometry) => petArt.paintFaceSprite(surface, palette, face, blinking, {
    stage: geometry,
    faceRig: petFace,
    view: geometry.view || 'front'
  })
});

function applyPetStageGeometry(skinId = 'pink') {
  const geo = petStageGeo;
  // 改 width/height 会重置整个上下文状态，所以插值开关和基底变换必须随后重新设。
  petCanvas.width = geo.rasterWidth;
  petCanvas.height = geo.rasterHeight;
  petCanvas.style.width = `${geo.cssWidth}px`;
  petCanvas.style.height = `${geo.cssHeight}px`;
  petFaceSurface.width = geo.bodySize * geo.deviceScale;
  petFaceSurface.height = geo.bodySize * geo.deviceScale;
  for (const surface of [petActionBackSurface, petActionFrontSurface]) {
    surface.width = geo.rasterWidth;
    surface.height = geo.rasterHeight;
  }
  pctx.imageSmoothingEnabled = false;
  pctx.setTransform(geo.deviceScale, 0, 0, geo.deviceScale, 0, 0);
  // 旧位图是按旧 deviceScale 画的，不能再按 1:1 贴出去。
  petSprites.clear();
  petHitLayout.update(skinId);
}
applyPetStageGeometry();

function updatePetStageForSkin(skinId) {
  const next = forms.resolveFormStage(skinId, window.devicePixelRatio || 1);
  if (next.rasterWidth !== petStageGeo.rasterWidth) {
    petStageGeo = next;
    applyPetStageGeometry(skinId);
  } else {
    petHitLayout.update(skinId);
  }
}

// 窗口被拖到不同缩放比的显示器时设备像素比会变，不重算光栅就会重新
// 出现非整数缩放的像素栅格。
let removeStageScaleListener = null;
function handlePetStageScaleChange() {
  petStageGeo = forms.resolveFormStage(devPreview?.skin || currentSkin, window.devicePixelRatio || 1);
  applyPetStageGeometry(devPreview?.skin || currentSkin);
  watchPetStageScale();
}
function watchPetStageScale() {
  removeStageScaleListener?.();
  const media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  removeStageScaleListener = listen(media, 'change', handlePetStageScaleChange);
}
watchPetStageScale();

// ---------- Pet grid ----------
const PALETTES = petArt.PALETTES;

// ---------- State ----------
let currentSkin = 'pink';
let currentTheme = null;
let level = 1;
// 主进程算好的“现在戴着哪几件”。null 表示还没收到过——此时按 level 走 0.1.4 的自动规则,
// 而不是当成“什么都没戴”:首帧就把已解锁的配饰摘掉会比晚一帧戴上更难看。
let appearanceItemIds = null;
let energyLevel = 60;
let workStart = 10, workEnd = 21;   // 工作时间（主进程同步）
let state = 'idle';
let sessionState = 'idle';
// 主进程的当前类别投影；主动作仍由会话控制，组合规则由独立纯模块拥有。
let activityMirror = null;
let activityMirrorConcurrent = null;
// 会话是否处于“暂停”（独立于 baseState：暂停时 baseState 仍是 idle）。
let sessionPaused = false;
// 锁屏由主进程生命周期事实驱动；它与 document.hidden 一起控制渲染时钟。
let screenLocked = false;
// 临时身体状态与 Presentation Director 共用 animNow；不再另起 wall-clock
// timeout 与导演竞争。隐藏/锁屏时 animNow 停止，生命周期处理会显式取消。
let transientVisualState = null;
// 喂食表情由同一动画时钟推进；页面不可见时显式取消，避免后台 timer 补播。
let petContent = null;
let satiation = 60;
// Start conservatively so startup cannot flash before persisted settings arrive.
let stimulationMode = 'low';
let motionMode = 'reduced';
let petActivityMode = 'balanced';
let dnd = false;
let contextualRequestGeneration = 0;
let facing = 1;
let devPreview = null;
let devPreviewStartedAt = 0;
let devMode = false;
let petDevtools = null;
let idleSince = Date.now();
let dockedEdge = null;
let peeking = false;
let clickCount = 0;
let clickResetTimer = null;
let petPlayer = null;
let sessionActivityController = null;
const queuedCues = [];
const queuedPresentations = [];

// Easter egg
let currentEgg = null;
let actionStartedAt = 0;
let actionSequence = 0;

// Particles for scene + overlay
let sceneParticles = [];
let overlayParticles = [];
let sceneOffset = 0;
let manualSceneSelection = false;
let selectedScene = { key: '', value: null };

// Sakura petals (in-canvas)
let petals = [];

// Speech and activity labels have one scoped surface owner.
const speech = createPetSpeech({ bubble, contextSlot: $('#contextRow'), setTimeout, clearTimeout });
const activityUi = createContextEmphasis({ stage, label: $('#activityLabel'), next: $('#activityNext'),
  badge: $('#contextBadge'), foodToast: $('#foodDrop'), speech });
const say = speech.say;
const legacyRing = createLegacyFocusRing({ document, now: () => performance.now() });
const sessionOrbit = createSessionOrbit({ document, now: () => performance.now(),
  isCalm: calmMotionRequested, isHidden: () => rendererPresentationSuspended() || Boolean(dockedEdge) || commandMenuOpen || foodMenuOpen
    || dragging || Boolean(petDevtools?.isOpen),
  openPanel: () => clients.pet_openPanel() });

// ---------- 帧率无关时间基 ----------
// 眨眼、常驻浮动、睡眠 z、庆祝星和花瓣共享帧率无关的单调动画时间，
// 避免同一配置在 6/30/60 FPS 下出现不同速度。
// core/pet-motion.mjs 的时钟累积经过时间：页面隐藏时不出帧、时间不走；
// 从后台恢复时步长受上限截断，不补播错过的装饰动画。
// 遗留常量都是按 60 FPS 调的，用 MS_PER_LEGACY_FRAME 换算，60 FPS 观感不变。
const LEGACY_FRAME_MS = petMotion.MS_PER_LEGACY_FRAME;
const motionClock = petMotion.createMotionClock({ maxStepMs: 250 });
let animNow = 0;   // 累计动画时间（ms），只在真正绘制的帧推进
let animDt = 0;    // 当前帧对应的真实步长（ms）
function legacyFramesAt(timeMs) { return timeMs / LEGACY_FRAME_MS; }

// 装饰性随机改用确定性序列，只在生成/启动时刻做选择；
// 绘制函数不允许逐帧调随机换颜色或形状。
const randomSeed = Math.floor(environment.Math.random() * 0x100000000);
const motionSeed = randomSeed;
const motionRandom = petMotion.createSeededRandom(randomSeed);
// 眨眼走独立子流：粒子生成的抽样次数随帧率变化，不能让它挤动眨眼排程。
const blinkRandom = petMotion.createSeededRandom(motionSeed ^ 0x9e3779b9);

// 眨眼调度：旧的 blinkTimer++/nextBlinkAt 是帧驱动的。换成绝对时间后
// 遗留的 40–140 帧间隔 ≈ 667–2333ms，闭合 6 帧 ≈ 100ms（60 FPS 口径）。
const blinkScheduler = petMotion.createBlinkScheduler({
  random: blinkRandom,
  minMs: 40 * LEGACY_FRAME_MS,
  maxMs: 140 * LEGACY_FRAME_MS,
  blinkMs: 6 * LEGACY_FRAME_MS
});

// 粒子发射器：遗留概率都是“60 FPS 每帧抽签”，换算成每秒速率后
// 用累积器发射，6/30/60 FPS 下的密度一致。
// 樱花花瓣：旧 `Math.random() < 0.1` 每帧 ≈ 每秒 6 片。
const petalEmitter = petMotion.createRateEmitter({ ratePerSecond: 0.1 * 60 });
// 樱花皮肤场景雨：旧 `Math.random() < 0.06` 每帧 ≈ 每秒 3.6 片。
const sakuraRainEmitter = petMotion.createRateEmitter({ ratePerSecond: 0.06 * 60 });

// 0.1.2 剩余的兼容场景、皮肤装饰与彩蛋效果原本仍靠“每帧概率”或
// `frame % N` 发射。统一换算成每秒速率后，6/30/60 FPS 下不会因为显示器
// 刷新率不同而改变密度。发射器只累计当前实际绘制的 animDt，隐藏、锁屏或
// 静态策略期间既不补播也不积攒债务。
const petFallbackSceneEmitters = Object.freeze({
  morningCloud: petMotion.createRateEmitter({ ratePerSecond: 0.02 * 60 }),
  morningBird: petMotion.createRateEmitter({ ratePerSecond: 0.004 * 60 }),
  daylightButterfly: petMotion.createRateEmitter({ ratePerSecond: 0.015 * 60 }),
  afternoonPlane: petMotion.createRateEmitter({ ratePerSecond: 0.008 * 60 }),
  eveningDragonfly: petMotion.createRateEmitter({ ratePerSecond: 0.005 * 60 }),
  nightFirefly: petMotion.createRateEmitter({ ratePerSecond: 0.02 * 60 }),
  nightStar: petMotion.createRateEmitter({ ratePerSecond: 0.05 * 60 }),
  lateNightBat: petMotion.createRateEmitter({ ratePerSecond: 0.003 * 60 })
});
const petSkinSceneEmitters = Object.freeze({
  forest: petMotion.createRateEmitter({ ratePerSecond: 0.03 * 60 }),
  ocean: petMotion.createRateEmitter({ ratePerSecond: 0.05 * 60 }),
  flame: petMotion.createRateEmitter({ ratePerSecond: 0.08 * 60 }),
  moon: petMotion.createRateEmitter({ ratePerSecond: 0.1 * 60 })
});
const petActionEmitters = Object.freeze({
  // 动作特效发射器。generic 以前是 60/7≈8.6/s，一个 8 秒动作要喷 ~70 颗，
  // 是“十字星刷屏”的密度来源之一；降到 ~4.5/s。calm 供打坐光环、困倦 zzz、
  // 热气等安静特效，进一步稀疏到 ~1.8/s。
  generic: petMotion.createRateEmitter({ ratePerSecond: 4.5 }),
  calm: petMotion.createRateEmitter({ ratePerSecond: 1.8 }),
  workout: petMotion.createRateEmitter({ ratePerSecond: 60 / 8 }),
  dig: petMotion.createRateEmitter({ ratePerSecond: 60 / 4 }),
  bubble: petMotion.createRateEmitter({ ratePerSecond: 60 / 12 }),
  sing: petMotion.createRateEmitter({ ratePerSecond: 0.15 * 60 })
});

function resetPetRateEmitters(group) {
  for (const emitter of Object.values(group)) emitter.reset();
}

function emitPetRate(emitter, emit) {
  const count = emitter.update(animDt);
  for (let index = 0; index < count; index++) emit();
  return count;
}

function resetPetActionEmitters() {
  resetPetRateEmitters(petActionEmitters);
}

const petEffects = createPetEffects({ context: octx, motion: petMotion, maxParticles: 160 });
const petSceneLayer = createPetScene({
  context: sctx,
  art: petSceneArt,
  resetEmitters: () => {
    resetPetRateEmitters(petFallbackSceneEmitters);
    resetPetRateEmitters(petSkinSceneEmitters);
    sakuraRainEmitter.reset();
    petActionEmitters.sing.reset();
  },
  maxParticles: 240
});

// 庆祝星的固定配色。以前每帧 pick() 重抽颜色，星星会逐帧闪烁；
// 现在每颗星按序号绑定颜色，生成后不再改变。
const CELEBRATE_STAR_COLORS = Object.freeze(['#e0af68', '#f7768e', '#7dcfff', '#bb9af7']);

// 粒子与眨眼的累计计数，只供自动化断言帧率无关性；不含业务状态。
let sceneSpawnedTotal = 0;
let petalsSpawnedTotal = 0;
let actionParticlesSpawnedTotal = 0;

function sample() {
    return Object.freeze({
      animNow,
      blinkCount: blinkScheduler.blinkCount,
      sceneParticlesSpawned: sceneSpawnedTotal,
      petalsSpawned: petalsSpawnedTotal,
      actionParticlesSpawned: actionParticlesSpawnedTotal,
      eggActive: currentEgg !== null,
      expressionId: currentExprId,
      presentationStatic: currentPresentation ? currentPresentation.static : false,
      presentationSource: currentPresentation ? currentPresentation.source : null,
      presentationEventId: currentPresentation ? currentPresentation.eventId : null,
      presentationMinHoldMs: presentationDirector && presentationDirector.transient
        ? presentationDirector.transient.minHoldMs
        : null,
      gazeX: gazeSpringX.value,
      gazeY: gazeSpringY.value,
      gazeInput: petGaze,
      facing,
      renderedEyeMask: currentRenderedEyeMask,
      actionId: currentEgg ? currentEgg.id : null,
      actionProgress: currentActionProgress,
      mirrorPlayback: petRenderer.mirrorPlaybackSnapshot(),
      activityCombination: petRenderer.activityCombinationSnapshot(),
      sessionActivityId: petRenderer.currentSessionActivity() ? petRenderer.currentSessionActivity().id : null,
      sessionActivityExpression: petRenderer.currentSessionActivity() ? petRenderer.currentSessionActivity().expression : null,
      state,
      sessionPaused,
      screenLocked,
      bodySpriteCacheSize: petSprites.size,
      bodySpriteCacheCapacity: petSprites.capacity,
      sceneParticleCount: sceneParticles.length,
      overlayParticleCount: overlayParticles.length,
      petalCount: petals.length
    });
}

// ---------- 表情呈现 ----------
// 表情注册表与导演在 init() 拿到内容后建立；建立之前用兜底中性脸绘制。
// 当前表情、它的起始时间（驱动进入序列与常驻循环）由动画时钟推进。
let expressionRegistry = null;
let presentationDirector = null;
let lastBaseExprId = null;
let lastBaseSource = null;
let lastEggEventId = null;
let currentExprId = null;
let exprStartAnimNow = 0;
let currentRenderedEyeMask = 'neutral';
let currentActionProgress = 0;
// 状态瞬态的“本次出现”事件 ID：上升沿递增序号，保证同一状态反复出现时
// 每次都拿到新 eventId（不会被导演的去重窗口吞掉），状态结束时取消。
let stateExprSeq = Object.create(null);
let stateExprActive = Object.create(null);
// 一次性/互动表情的事件序号（喂食、抚摸、启动、唤醒等）。
let manualExprSeq = 0;
// 会话起始边沿检测：从非专注切到专注时短暂呈现 work.starting。
let prevSessionState = null;
let startingSeq = 0;
let prevSessionPaused = false;
let resumeSeq = 0;
// 最近一次导演裁决的呈现（供诊断读取 static 等元信息）。
let currentPresentation = null;

// ---------- 注视与直接交互反馈 ----------
// 注视：主进程每 200ms 推送一次归一化方向（只读、不落库、不留轨迹），
// 渲染器用两个临界阻尼弹簧补足采样间隔，最终偏移量化到整美术像素。
let petGaze = Object.freeze({ x: 0, y: 0, near: false, sameDisplay: false });
const gazeSpringX = petMotion.createSpring({ omega: 12, value: 0 });
const gazeSpringY = petMotion.createSpring({ omega: 12, value: 0 });
// 交互压缩/回弹与拖动倾斜：事件驱动的有界弹簧。
// squash 1 = 最大压缩；tilt 为弧度，限幅在 ±0.28（约 ±16°）。
const squashSpring = petMotion.createSpring({ omega: 16, value: 0 });
const tiltSpring = petMotion.createSpring({ omega: 14, value: 0 });
let dragging = false;
let mouseVelocity = 0;
let dragVx = 0;
let dragVy = 0;
let heldExpressionEventId = null;

// 状态 → 临时表情。优先级取自来源档位；事件 ID 由出现序号保证唯一。
const STATE_TRANSIENT_EXPR = Object.freeze({
  celebrating: Object.freeze(['state.celebrating', 'react.celebrate', 'essential']),
  talking: Object.freeze(['state.talking', 'react.happy', 'interaction']),
  dragged: Object.freeze(['state.dragged', 'react.surprised', 'input-safe']),
  walking: Object.freeze(['state.walking', 'life.attentive', 'session'])
});

// 各状态瞬态的 TTL。同一事件重放不会延长 TTL，因此“会持续的状态”必须给足
// 上限：拖动可能远超 8 秒，给 10 分钟兜底（拖动结束会立刻取消，不依赖到期）。
const STATE_TRANSIENT_TTL = Object.freeze({
  celebrating: 8000,
  talking: 8000,
  dragged: 600_000,
  walking: 8000
});

function rendererPresentationSuspended() {
  return stopped || screenLocked || document.hidden;
}

// 动作播放与脸部 presentation 必须一起被抢占。否则 Director 虽然换了脸，
// 旧 autonomous action 仍会继续移动身体/画道具，形成两套事实源。
function cancelCurrentAction(reason = 'interaction', { autonomousOnly = false } = {}) {
  const action = currentEgg;
  const playerOwnsAction = Boolean(petPlayer && petPlayer.snapshot());
  if (!action && !playerOwnsAction) return false;
  if (autonomousOnly && action && action.manual) return false;

  if (playerOwnsAction) petPlayer.cancelCurrent(reason);
  if (currentEgg === action) currentEgg = null;
  resetPetActionEmitters();
  if (lastEggEventId && presentationDirector) {
    presentationDirector.cancelTransient(lastEggEventId, reason);
  }
  lastEggEventId = null;
  return true;
}

function beginActionPlayback(playback) {
  actionSequence += 1;
  currentEgg = {
    ...playback,
    presentationEventId: `egg.${playback.id}.${actionSequence}`
  };
  actionStartedAt = animNow;
  return currentEgg;
}

function updateActionPlayback(now = animNow) {
  const action = currentEgg;
  if (!action) {
    // Defensive convergence: if rendering state was cleared independently,
    // the player still gets a chance to close its ACK lifecycle.
    return petPlayer ? petPlayer.update(now) : false;
  }
  if (!action.manual && petPlayer) return petPlayer.update(now);
  if (now - actionStartedAt < action.duration) return false;
  if (currentEgg === action) currentEgg = null;
  resetPetActionEmitters();
  return true;
}

function presentExpressionEvent(eventId, expressionId, source, ttlMs, minHoldMs = 0) {
  if (!presentationDirector || rendererPresentationSuspended()) {
    return { ok: false, reason: 'not-visible' };
  }
  const normalizedSource = source || 'interaction';
  const priorities = petPresentation.PRIORITY_BY_SOURCE;
  if (priorities[normalizedSource] > priorities.cue) {
    cancelCurrentAction('interaction', { autonomousOnly: true });
  }
  return presentationDirector.presentTransient({
    eventId,
    expressionId,
    source: normalizedSource,
    issuedAt: animNow,
    minHoldMs,
    ttlMs
  });
}

// 呈现一个一次性/互动表情（喂食、抚摸、启动、唤醒等）。每次调用都是新的
// 事件，用递增 eventId 避免被去重窗口误判为重放。
function showExpression(expressionId, source, ttlMs, { minHoldMs = 0 } = {}) {
  manualExprSeq += 1;
  const eventId = `manual.${manualExprSeq}`;
  const result = presentExpressionEvent(
    eventId,
    expressionId,
    source,
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 1500,
    minHoldMs
  );
  return result.ok ? eventId : null;
}

function presentStructuredPetExpression(presentation) {
  if (!presentation || typeof presentation !== 'object') {
    return { ok: false, reason: 'invalid-presentation' };
  }
  if (!presentationDirector) {
    if (queuedPresentations.length >= 16) queuedPresentations.shift();
    queuedPresentations.push(presentation);
    return { ok: true, queued: true };
  }
  if (presentation.cancel === true) {
    return presentationDirector.cancelTransient(presentation.eventId, presentation.reason || 'cancelled');
  }
  if (!expressionRegistry || !expressionRegistry.has(presentation.expressionId)) {
    return { ok: false, reason: 'unknown-expression' };
  }
  return presentExpressionEvent(
    presentation.eventId,
    presentation.expressionId,
    presentation.source,
    presentation.ttlMs,
    presentation.minHoldMs
  );
}

// 深夜（客观时间事实，不推断用户状态）下的空闲呈现困倦而非普通待机。
function isLateNightIdle() {
  if (state !== 'idle') return false;
  const hour = new Date().getHours();
  return hour >= 22 || hour < 1;
}

function desiredBasePresentation() {
  let expressionId = 'life.idle';
  if (sessionPaused) expressionId = 'work.pause';
  else if (sessionState === 'focused' || sessionState === 'resting') {
    const activity = petRenderer.currentSessionActivity();
    const fallback = sessionState === 'focused' ? 'work.focus' : 'work.rest';
    expressionId = activity && expressionRegistry && expressionRegistry.has(activity.expression)
      ? activity.expression
      : fallback;
  }
  else if (state === 'sleeping') expressionId = 'life.sleep';
  else if (state === 'hungry') expressionId = 'react.hungry';
  else if (state === 'peeking') expressionId = 'life.peek';
  else if (isLateNightIdle()) expressionId = 'life.drowsy';
  const source = sessionPaused || sessionState === 'focused' || sessionState === 'resting'
    ? 'session'
    : 'base';
  return { expressionId: mirrorBaseExpressionFor(expressionId, petRenderer.currentSessionActivity(), activityMirror), source };
}

function syncPresentationBase() {
  if (!presentationDirector) return null;
  const next = desiredBasePresentation();
  if (next.expressionId === lastBaseExprId && next.source === lastBaseSource) return null;
  const result = presentationDirector.setBase(next);
  if (result.ok) {
    lastBaseExprId = next.expressionId;
    lastBaseSource = next.source;
  }
  if (result.cancelled && result.cancelled === lastEggEventId) {
    cancelCurrentAction('focus', { autonomousOnly: true });
  }
  return result;
}

// 状态机（pet state）与表情呈现共用同一条抢占规则：规则只实现在导演里，
// 这里只提问。表达库缺失时没有按表情呈现的通道，此时状态机只需拒绝闭合
// 来源集之外的状态，不再自己比较优先级。
function admitsTransientSource(source) {
  if (!petPresentation.PRESENTATION_TRANSIENT_SOURCES.includes(source)) return false;
  if (!presentationDirector) return true;
  return presentationDirector.wouldAdmit({ source, at: animNow }).ok;
}

// 把渲染器当前的确定性事实喂给导演，取回应展示的表情。每帧重放相同
// eventId 是幂等的，不会重启动画；事实变化才产生新的呈现。
function updatePresentation() {
  if (!presentationDirector || !expressionRegistry) return 'life.idle';
  const now = animNow;

  syncPresentationBase();

  // 恢复与首次进入是不同事实：恢复先短暂抬头，不能重复播放 starting。
  const resumedFocus = prevSessionPaused && !sessionPaused && sessionState === 'focused';
  if (resumedFocus) {
    resumeSeq += 1;
    presentationDirector.presentTransient({
      eventId: `resume.${resumeSeq}`,
      expressionId: 'work.resume',
      source: 'session',
      issuedAt: now,
      ttlMs: 1400
    });
  } else if (!sessionPaused && sessionState === 'focused' && prevSessionState !== 'focused') {
    startingSeq += 1;
    presentationDirector.presentTransient({
      eventId: `starting.${startingSeq}`,
      expressionId: 'work.starting',
      source: 'session',
      issuedAt: now,
      ttlMs: 1600
    });
  }
  prevSessionState = sessionState;
  prevSessionPaused = sessionPaused;

  // 彩蛋（自主内容）：播放中作为 cue 级临时表情，结束后取消。
  // 每次动作启动都分配独立序号；时间戳可能在同一帧内重复，也可能因系统校时
  // 回退，不能拿来充当事件身份。
  if (!currentEgg && lastEggEventId) {
    presentationDirector.cancelTransient(lastEggEventId);
    lastEggEventId = null;
  }
  if (currentEgg && !currentEgg.presentationOwned && !heldExpressionEventId
      && petContent && petContent.PET_ACTIONS && petContent.PET_ACTIONS[currentEgg.id]) {
    const action = petContent.PET_ACTIONS[currentEgg.id];
    const candidateExpression = currentEgg.expression || action.expression;
    const exprId = expressionRegistry.has(candidateExpression) ? candidateExpression : 'life.idle';
    const eventId = currentEgg.presentationEventId;
    presentationDirector.presentTransient({
      eventId,
      expressionId: exprId,
      source: currentEgg.manual ? 'interaction' : 'cue',
      issuedAt: now,
      ttlMs: Math.max(1000, currentEgg.duration || 8000)
    });
    lastEggEventId = eventId;
  }

  // 状态瞬态：上升沿生成新事件 ID；状态结束时取消。
  for (const [st, info] of Object.entries(STATE_TRANSIENT_EXPR)) {
    if (state === st) {
      if (!stateExprActive[st]) {
        stateExprSeq[st] = (stateExprSeq[st] || 0) + 1;
        stateExprActive[st] = `${info[0]}.${stateExprSeq[st]}`;
      }
      const transientSource = transientVisualState && transientVisualState.state === st
        ? transientVisualState.source
        : info[2];
      presentationDirector.presentTransient({
        eventId: stateExprActive[st],
        expressionId: info[1],
        source: transientSource,
        issuedAt: now,
        ttlMs: transientVisualState && transientVisualState.state === st
          ? Math.max(1, transientVisualState.expiresAt - now)
          : STATE_TRANSIENT_TTL[st] || 8000
      });
    } else if (stateExprActive[st]) {
      presentationDirector.cancelTransient(stateExprActive[st]);
      stateExprActive[st] = null;
    }
  }

  currentPresentation = presentationDirector.current(now);
  return currentPresentation ? currentPresentation.expressionId : 'life.idle';
}

// 把感官策略同步给导演：DND/低刺激门禁自主内容，减少动效/低刺激降级为静态，
// 菜单或喂食面板打开时不启动新的自主呈现。策略变化时调用，使导演内的门禁
// 与渲染器实际策略一致（而不是永远跑在默认值上）。
function syncPresentationPolicy() {
  if (!presentationDirector) return;
  presentationDirector.setSensoryPolicy({
    dnd,
    reduceMotion: reducedMotion(),
    lowStimulation: stimulationMode === 'low',
    menuOpen: commandMenuOpen || foodMenuOpen || Boolean(petDevtools?.isOpen)
  });
}

// ---------- Utilities ----------
function pick(arr) { return arr[Math.floor(motionRandom() * arr.length)]; }
function rand(min, max) { return min + motionRandom() * (max - min); }
function getTimePeriod(hour) {
  return classifyWorkPeriod(hour, workStart, workEnd, Math);
}
function reducedMotion() {
  return sensoryPolicy.resolveSensoryPolicy({
    motionMode,
    stimulationMode,
    dnd,
    systemReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }).reduceMotion;
}
function calmMotionRequested() {
  return sensoryPolicy.resolveSensoryPolicy({
    motionMode,
    stimulationMode,
    dnd,
    systemReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }).calmVisuals;
}
function applySensoryProfile() {
  const sensory = sensoryPolicy.resolveSensoryPolicy({ motionMode, stimulationMode, dnd });
  document.body.dataset.motion = sensory.motionMode;
  document.body.dataset.stimulation = sensory.stimulationMode;
}
applySensoryProfile();

const rendererFields = [
  ['petStageGeo', () => petStageGeo, value => { petStageGeo = value; }],
  ['currentSkin', () => currentSkin, value => { currentSkin = value; }],
  ['currentTheme', () => currentTheme, value => { currentTheme = value; }],
  ['level', () => level, value => { level = value; }],
  ['appearanceItemIds', () => appearanceItemIds, value => { appearanceItemIds = value; }],
  ['energyLevel', () => energyLevel, value => { energyLevel = value; }],
  ['workStart', () => workStart, value => { workStart = value; }],
  ['workEnd', () => workEnd, value => { workEnd = value; }],
  ['state', () => state, value => { state = value; }],
  ['sessionState', () => sessionState, value => { sessionState = value; }],
  ['activityMirror', () => activityMirror, value => { activityMirror = value; }],
  ['activityMirrorConcurrent', () => activityMirrorConcurrent, value => { activityMirrorConcurrent = value; }],
  ['sessionPaused', () => sessionPaused, value => { sessionPaused = value; }],
  ['screenLocked', () => screenLocked, value => { screenLocked = value; }],
  ['transientVisualState', () => transientVisualState, value => { transientVisualState = value; }],
  ['petContent', () => petContent, value => { petContent = value; }],
  ['satiation', () => satiation, value => { satiation = value; }],
  ['stimulationMode', () => stimulationMode, value => { stimulationMode = value; }],
  ['motionMode', () => motionMode, value => { motionMode = value; }],
  ['dnd', () => dnd, value => { dnd = value; }],
  ['facing', () => facing, value => { facing = value; }],
  ['devPreview', () => devPreview, value => { devPreview = value; }],
  ['devPreviewStartedAt', () => devPreviewStartedAt, value => { devPreviewStartedAt = value; }],
  ['currentEgg', () => currentEgg, value => { currentEgg = value; }],
  ['dockedEdge', () => dockedEdge, value => { dockedEdge = value; }],
  ['actionStartedAt', () => actionStartedAt, value => { actionStartedAt = value; }],
  ['sessionActivityController', () => sessionActivityController, value => { sessionActivityController = value; }],
  ['sceneParticles', () => sceneParticles, value => { sceneParticles = value; }],
  ['overlayParticles', () => overlayParticles, value => { overlayParticles = value; }],
  ['sceneOffset', () => sceneOffset, value => { sceneOffset = value; }],
  ['manualSceneSelection', () => manualSceneSelection, value => { manualSceneSelection = value; }],
  ['selectedScene', () => selectedScene, value => { selectedScene = value; }],
  ['petals', () => petals, value => { petals = value; }],
  ['sceneSpawnedTotal', () => sceneSpawnedTotal, value => { sceneSpawnedTotal = value; }],
  ['petalsSpawnedTotal', () => petalsSpawnedTotal, value => { petalsSpawnedTotal = value; }],
  ['actionParticlesSpawnedTotal', () => actionParticlesSpawnedTotal, value => { actionParticlesSpawnedTotal = value; }],
  ['expressionRegistry', () => expressionRegistry, value => { expressionRegistry = value; }],
  ['presentationDirector', () => presentationDirector, value => { presentationDirector = value; }],
  ['currentExprId', () => currentExprId, value => { currentExprId = value; }],
  ['exprStartAnimNow', () => exprStartAnimNow, value => { exprStartAnimNow = value; }],
  ['currentRenderedEyeMask', () => currentRenderedEyeMask, value => { currentRenderedEyeMask = value; }],
  ['currentActionProgress', () => currentActionProgress, value => { currentActionProgress = value; }],
  ['petGaze', () => petGaze, value => { petGaze = value; }],
  ['commandMenuOpen', () => commandMenuOpen, value => { commandMenuOpen = value; }],
  ['foodMenuOpen', () => foodMenuOpen, value => { foodMenuOpen = value; }],
  ['devtoolsOpen', () => Boolean(petDevtools?.isOpen), value => { void value; }],
  ['dragging', () => dragging, value => { dragging = value; }],
  ['dragVx', () => dragVx, value => { dragVx = value; }],
  ['dragVy', () => dragVy, value => { dragVy = value; }],
  ['animNow', () => animNow, value => { animNow = value; }],
  ['animDt', () => animDt, value => { animDt = value; }]
];
const engineNames = new Set(['expressionRegistry', 'presentationDirector', 'sessionActivityController']);
const frameFields = rendererFields.filter(([name]) => !engineNames.has(name) && !['petContent', 'petStageGeo'].includes(name));
const frameWriters = new Map(frameFields.map(([name, _read, write]) => [name, write]));
const petPainter = createPetRenderer({
  readEngines: () => ({ expressionRegistry, presentationDirector, sessionActivityController }),
  window,
  document,
  date: Date,
  math: Math,
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
  celebrateStarColors: CELEBRATE_STAR_COLORS,
  motionRandom,
  pick,
  rand,
  getTimePeriod,
  reducedMotion,
  updatePresentation,
  activityUi,
  resetPetRateEmitters,
  emitPetRate,
  resetPetActionEmitters,
  legacyFramesAt,
  legacyFrameMs: LEGACY_FRAME_MS,
  palettes: PALETTES
});

function runPetFrame(command, ...args) {
  const frame = createPetFrameContext({
    state: Object.fromEntries(frameFields.map(([name, read]) => [name, read()])),
    now: animNow, dt: animDt, wallNow: Date.now(),
    policy: { calmVisual: reducedMotion() || stimulationMode === 'low' },
    stage: petStageGeo, content: petContent
  });
  const result = petPainter.executeFrame(frame, command, args);
  for (const [name, value] of Object.entries(result.updates)) {
    const write = frameWriters.get(name);
    if (!write) throw new Error(`unexpected renderer result: ${name}`);
    write(copyFrameData(value));
  }
  return result.value;
}
const petRenderer = Object.freeze({
  render: () => runPetFrame('render'),
  currentSessionActivity: () => runPetFrame('currentSessionActivity'),
  mirrorPlaybackSnapshot: () => runPetFrame('mirrorPlaybackSnapshot'),
  activityCombinationSnapshot: () => runPetFrame('activityCombinationSnapshot'),
  resolveScene: (...args) => runPetFrame('resolveScene', ...args),
  resetSceneParticles: () => runPetFrame('resetSceneParticles'),
  clearDecorativeParticles: () => runPetFrame('clearDecorativeParticles')
});

// ---------- Speech ----------
async function sayContextual(customState) {
  if (stopped || dnd) return;
  const requestGeneration = ++contextualRequestGeneration;
  const hour = new Date().getHours();
  try {
    const line = await clients.pet_getContextualLine({
      hour, state: customState || state, energyLevel,
      workStart, workEnd
    });
    if (!stopped && !dnd && requestGeneration === contextualRequestGeneration && line) say(line);
  } catch (_) {
    if (!stopped && !dnd && requestGeneration === contextualRequestGeneration) say('我在这里陪你');
  }
}

// ---------- State machine ----------
function setState(newState, { temporary = false } = {}) {
  if (stopped) return state;
  if (!temporary) transientVisualState = null;
  if (state !== newState) {
    state = newState;
    clients.pet_setState(newState);
  }
  syncPresentationBase();
  return state;
}

function syncSessionActivityMode(at = animNow) {
  if (typeof sessionActivityController === 'undefined' || !sessionActivityController) return;
  activityUi.observeCategory(activityMirror, { concurrent: activityMirrorConcurrent, suspended: rendererPresentationSuspended() });
  const activity = sessionActivityController.setMode(activityModeFor(sessionState, activityMirror), at);
  activityUi.syncActivity(activity);
  if (typeof sceneParticles !== 'undefined') petRenderer.resetSceneParticles();
}

function normalizeSessionState(newState) {
  return ['focused', 'resting'].includes(newState) ? newState : 'idle';
}

function setSessionState(newState) {
  sessionState = normalizeSessionState(newState);
  syncSessionActivityMode();
  // 新 base 只更新返回目标；高优先级输入/互动/必要反馈由 Director 管到结束。
  // 会话级 walking 遇到新的会话 base 则立即让位。
  const active = STATE_TRANSIENT_EXPR[state];
  const source = transientVisualState && transientVisualState.state === state
    ? transientVisualState.source
    : active && active[2];
  const transientPriority = source && petPresentation.PRIORITY_BY_SOURCE[source];
  const baseSource = sessionPaused || sessionState === 'focused' || sessionState === 'resting'
    ? 'session'
    : 'base';
  const basePriority = petPresentation.PRIORITY_BY_SOURCE[baseSource];
  if (baseSource === 'session') cancelCurrentAction('focus', { autonomousOnly: true });
  syncPresentationBase();
  if (transientPriority > basePriority) return state;
  return setState(sessionState);
}

function setTemporaryState(newState, durationMs, restoreState = sessionState, options = {}) {
  // 先更新权威 base，再让单调动画时钟管理 transient 生命周期。输入安全态
  // 等更高级事实不会被较低级的异步业务通知覆盖。
  sessionState = normalizeSessionState(restoreState);
  syncSessionActivityMode();
  const priorities = petPresentation.PRIORITY_BY_SOURCE;
  const defaultSource = STATE_TRANSIENT_EXPR[newState] && STATE_TRANSIENT_EXPR[newState][2];
  const nextSource = priorities[options.source] ? options.source : defaultSource;
  if (!admitsTransientSource(nextSource)) return false;
  if (rendererPresentationSuspended()) {
    transientVisualState = null;
    setState(sessionState);
    return false;
  }
  if (nextSource && priorities[nextSource] > priorities.cue) {
    cancelCurrentAction('interaction', { autonomousOnly: true });
  }
  const ttlMs = Math.max(0, Number(durationMs) || 0);
  transientVisualState = Object.freeze({ state: newState, source: nextSource, expiresAt: animNow + ttlMs });
  setState(newState, { temporary: true });
  return true;
}

function expireTemporaryState(now = animNow) {
  if (!transientVisualState || now < transientVisualState.expiresAt) return false;
  transientVisualState = null;
  setState(sessionState);
  return true;
}

// ---------- Docking + peeking ----------
function applyDockClass() {
  stage.classList.remove('dock-top', 'dock-bottom', 'dock-left', 'dock-right', 'is-docked', 'peek');
  if (dockedEdge) stage.classList.add(`dock-${dockedEdge}`);
  stage.classList.toggle('is-docked', Boolean(dockedEdge));
  if (peeking) stage.classList.add('peek');
  sessionOrbit.render();
}

function handlePetDock({ edge } = {}) {
  dockedEdge = edge;
  applyDockClass();
}

function handlePetPeek({ peek } = {}) {
  peeking = !dnd && peek;
  applyDockClass();
  if (peeking && petContent && petContent.LINES) {
    const line = pick(petContent.LINES.peek);
    say(line, 2500);
    setState('peeking');
  } else if (!peek) {
    setState(sessionState);
  }
}

// 注视只读推送：钳到 [-1,1]，非法值归零。不存储历史、不做跨屏追踪。
function handlePetGaze(g) {
  petGaze = normalizeGaze(g);
}

function handlePetDevtools({ open = false } = {}) {
  if (!devMode || !petDevtools) return;
  if (open) {
    petDevtools.setCatalog(petContent && petContent.PET_CATALOG);
    // Preview controls must start from the live form. Otherwise selecting a
    // view immediately reverts a long-eared pet to the first catalog skin.
    document.getElementById('devSkin').value = currentSkin;
    petDevtools.open();
  } else petDevtools.close();
}

listen($('#activityNext'), 'click', event => {
  event.stopPropagation();
  if (!sessionActivityController) return;
  const activity = sessionActivityController.advance(animNow);
  activityUi.syncActivity(activity);
});

// ---------- Menu adapter ----------
let commandMenuOpen = false;
let menuKeyboardActive = false;
let pointerInsidePet = false;
let stageExpanded = false;
let lastStageGeo = null;
let lastRuntimeSnapshot = '';

function reportPetRuntime() {
  if (stopped) return;
  const runtime = {
    visible: !document.hidden && !screenLocked,
    menuOpen: commandMenuOpen || foodMenuOpen || Boolean(petDevtools?.isOpen),
    dragging,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };
  const snapshot = JSON.stringify(runtime);
  if (snapshot === lastRuntimeSnapshot) return;
  lastRuntimeSnapshot = snapshot;
  clients.pet_updateRuntime(runtime).catch(() => {});
}

function applyDevPreview(selection) {
  if (!devMode || !selection || typeof selection !== 'object') return false;
  const next = { ...selection };
  if (next.category === 'skin') next.skin = next.id;
  if (next.category === 'appearance' && petContent && Array.isArray(petContent.PET_APPEARANCE_ITEMS)) {
    const item = petContent.PET_APPEARANCE_ITEMS.find(candidate => candidate.id === next.id);
    if (item) next.skin = item.skin || forms.previewSkinForForm(item.formId || 'dango', currentSkin);
  }
  devPreview = Object.freeze(next);
  if (next.skin) document.getElementById('devSkin').value = next.skin;
  updatePetStageForSkin(next.skin || currentSkin);
  devPreviewStartedAt = animNow;
  petRenderer.clearDecorativeParticles();
  return true;
}

function clearDevPreview() {
  devPreview = null;
  updatePetStageForSkin(currentSkin);
  devPreviewStartedAt = 0;
  petRenderer.clearDecorativeParticles();
}

const petMenu = createPetMenu({
  window,
  document,
  petHit,
  stage,
  commandMenu: $('#commandMenu'),
  feedQuick: $('#feedQuick'),
  client: clients,
  isDevtoolsOpen: () => petDevtools && petDevtools.isOpen,
  requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout,
  callbacks: {
    onStateChange(next) {
      commandMenuOpen = next.commandMenuOpen;
      menuKeyboardActive = next.menuKeyboardActive;
      pointerInsidePet = next.pointerInsidePet;
      stageExpanded = next.stageExpanded;
      lastStageGeo = next.lastStageGeo;
      sessionOrbit.render();
    },
    isFoodMenuOpen: () => foodMenuOpen,
    isDnd: () => dnd,
    cancelFeedPresentation: reason => cancelFeedPresentation(reason),
    cancelCurrentAction: reason => cancelCurrentAction(reason),
    onPolicyChange: syncPresentationPolicy,
    reportRuntime: reportPetRuntime,
    handleClick,
    openCommandMenuOnce: source => openCommandMenuOnce(source),
    openFoodMenu: () => openFoodMenu(),
    runCommand: act => runCommand(act)
  }
});

const toggleCommandMenu = (...args) => petMenu.toggle(...args);
const syncStageExpansion = (...args) => petMenu.syncStageExpansion(...args);

petDevtools = createPetDevtools({
  document, setTimeout, clearTimeout,
  panel: document.getElementById('devTools'),
  list: document.getElementById('devToolsList'),
  viewSelect: document.getElementById('devView'),
  skinSelect: document.getElementById('devSkin'),
  levelInput: document.getElementById('devLevel'),
  callbacks: {
    preview: applyDevPreview,
    clear: clearDevPreview,
    onStateChange: open => {
      if (open) {
        void toggleCommandMenu(false, { restoreFocus: false }).catch(() => {});
        void closeFoodMenu();
        cancelFeedPresentation('devtools-open');
        cancelCurrentAction('devtools-open');
      } else {
        clearDevPreview();
      }
      stage.classList.toggle('devtools-open', Boolean(open));
      syncPresentationPolicy();
      sessionOrbit.render();
      void syncStageExpansion().catch(() => {});
      reportPetRuntime();
    }
  }
});

const petCommands = createPetCommands({
  menu: { open: () => toggleCommandMenu(true), close: () => toggleCommandMenu(false) },
  client: clients,
  state: () => ({ commandMenuOpen, foodMenuOpen }),
  setState: patch => { if (patch.sessionState) setSessionState(patch.sessionState); }
});

function startManualAction(actionId, text, { speak = true, interactionId } = {}) {
  const playback = createManualActionPlayback(petContent, actionId, { interactionId, formId: forms.resolvePetForm(currentSkin).id });
  if (!playback) return false;
  const action = petContent.PET_ACTIONS[actionId];
  cancelCurrentAction('interaction');
  resetPetActionEmitters();
  beginActionPlayback(playback);
  if (speak) say(text || pick(action.lines), Math.min(action.duration, 5_500));
  return true;
}

async function runCommand(act) {
  if (stopped) return;
  act = petCommands.normalize(act);
  if (act === 'feed') return openFoodMenu();
  await toggleCommandMenu(false);
  if (stopped) return;
  if (act === 'focus') {
      try {
        const result = await clients.pet_startFocus();
        if (stopped) return;
        if (result && result.ok) {
          say('开始专注。');
          setSessionState('focused');
        } else {
          const decisionMessage = result && ({
            'awaiting-confirmation': '上轮已经到点，请在面板确认计入完成或放弃本轮',
            'quick-start-decision-pending': '两分钟已经完成，请先在面板选择下一步',
            'focus-landing-pending': '先保存或跳过上一轮的落点，再开始新一轮'
          })[result.reason];
          if (decisionMessage) {
            say(decisionMessage);
            clients.pet_openPanel();
            return;
          }
          const active = result && ['already-running', 'session-active'].includes(result.reason);
          say(active ? '已有计时在进行或暂停中' : '这次没能开始计时，请从面板再试一次');
        }
      } catch (_) {
        if (stopped) return;
        say('这次没能开始计时，请从面板再试一次');
      }
  } else if (act === 'impulse') {
    clients.pet_openImpulse();
    say('说吧，我记着。');
  } else if (act === 'panel') clients.pet_openPanel();
  else if (act === 'devtools' && devMode) {
    handlePetDevtools({ open: true });
    say('开发检验台已打开：逐项点选或一键播放全部。', 3500);
  }
  else if (act === 'talk') {
    startManualAction('wave', null, { speak: false });
    await sayContextual('talking');
  } else if (act === 'highfive') startManualAction('high-five', '手举高——啪！击掌成功。');
  else if (act === 'dance') startManualAction('dance', '音乐来了，陪我左右踏两步！');
  else if (act === 'stretch') startManualAction('stretch', '一起把手举高，慢慢伸个懒腰。');
  else if (act === 'scene') {
    manualSceneSelection = true;
    sceneOffset += 1;
    selectedScene.key = '';
    petRenderer.resetSceneParticles();
    const next = petRenderer.resolveScene(getTimePeriod(new Date().getHours()), new Date());
    say(next ? `换到「${next.name}」啦` : '风景换好啦');
  }
  else if (act === 'dnd') {
    try {
      const result = await clients.pet_toggleDnd();
      if (stopped) return;
      if (result) dnd = Boolean(result.dnd);
      if (!dnd) say('免打扰已关闭');
    } catch (_) { /* keep current presentation when the command result is unavailable */ }
  } else if (act === 'hide') clients.pet_hide();
}

// ---------- Pointer adapter ----------
const petPointer = createPetPointer({
  window,
  document,
  petHit,
  petLayer,
  client: clients,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  callbacks: {
    onStateChange(next) {
      dragging = next.dragging;
      dragVx = next.dragVx;
      dragVy = next.dragVy;
      mouseVelocity = next.mouseVelocity;
    },
    setFacing: nextFacing => { facing = nextFacing === -1 ? -1 : 1; },
    onHeldExpressionChange: eventId => { heldExpressionEventId = eventId; },
    isFoodMenuOpen: () => foodMenuOpen,
    closeFoodMenu,
    cancelFeedPresentation,
    cancelCurrentAction,
    cancelDraggedPresentation(reason) {
      if (stateExprActive.dragged && presentationDirector) {
        presentationDirector.cancelTransient(stateExprActive.dragged, reason);
        stateExprActive.dragged = null;
      }
    },
    setState,
    getSessionState: () => sessionState,
    resetGaze: () => { petGaze = normalizeGaze(); },
    reportRuntime: reportPetRuntime,
    getPetContent: () => petContent,
    calmMotionRequested,
    setSquash: (value, velocity) => squashSpring.set(value, velocity),
    setSquashTarget: value => squashSpring.setTarget(value),
    setTiltTarget: value => tiltSpring.setTarget(value),
    showExpression,
    cancelExpression: (eventId, reason) => presentationDirector?.cancelTransient(eventId, reason),
    startManualAction,
    say,
    setTemporaryState,
    emitPurrParticles,
    openCommandMenuOnce,
    toggleCommandMenu,
    markInteraction: () => { idleSince = Date.now(); },
    handleClick,
    readWallClock: () => Date.now()
  }
});

function suspendRenderer(reason) {
  activityUi.suspend();
  sessionOrbit.render();
  motionClock.reset();
  animDt = 0;
  petGaze = Object.freeze({ x: 0, y: 0, near: false, sameDisplay: false });
  gazeSpringX.snap(0);
  gazeSpringY.snap(0);
  petRenderer.clearDecorativeParticles();
  petPointer.cancel(reason);
  cancelFeedPresentation(reason);
  cancelCurrentAction(reason);
  if (presentationDirector && presentationDirector.transient) {
    presentationDirector.cancelTransient(presentationDirector.transient.eventId, reason);
  }
  stateExprActive = Object.create(null);
  if (transientVisualState) {
    transientVisualState = null;
    setState(sessionState);
  }
}

function setScreenLocked(locked) {
  const next = locked === true;
  if (screenLocked === next) return;
  screenLocked = next;
  // 解锁也重新锚定，第一帧 dt=0，不消费锁屏期间的墙钟间隔。
  motionClock.reset();
  animDt = 0;
  if (screenLocked) suspendRenderer('screen-locked');
  else {
    prevSessionState = sessionState;
    prevSessionPaused = sessionPaused;
  }
  reportPetRuntime();
}

listen(document, 'visibilitychange', () => {
  // hidden 与 visible 两个边沿都重置锚点；恢复首帧必须严格为 0ms。
  motionClock.reset();
  animDt = 0;
  if (document.hidden) suspendRenderer('hidden');
  else {
    prevSessionState = sessionState;
    prevSessionPaused = sessionPaused;
  }
  reportPetRuntime();
});

// 左键互动的陪伴动作池（接替已移除的互动轮盘，三句台词原封不动）
const COMPANION_GESTURES = [
  { text: '嗯，摸摸很安心 \u{1F90D}', action: 'tail-wiggle' },
  { text: '啪！我们继续 \u{270B}', action: 'happy-hop' },
  { text: '一起慢慢呼吸一下 \u{1F319}', action: 'meditate' }
];
let companionGestureTurn = 0;

// 长按的呼噜反馈：头顶飘几颗心。减少动效或低刺激下不发射。
function emitPurrParticles() {
  overlayParticles.push(...createInteractionParticles('purr', { calmVisual: calmMotionRequested(), random: motionRandom }));
}

function handleClick() {
  clickCount++;
  if (clickResetTimer) clearTimeout(clickResetTimer);
  clickResetTimer = setTimeout(() => { clickCount = 0; }, 3000);

  const ints = petContent && petContent.INTERACTIONS && petContent.INTERACTIONS.clickCount;
  if (ints && ints[clickCount]) {
    const react = ints[clickCount];
    if (!startManualAction(react.action, `${react.emoji} ${react.text}`, { interactionId: `click-${clickCount}` })) say(`${react.emoji} ${react.text}`, 2500);
    if (react.xp) {
      clients.pet_interaction(`click-${clickCount}`).then(result => {
        if (!stopped && result && result.text) say(result.text, 2600);
      }).catch(() => {});
    }
    overlayParticles.push(...createInteractionParticles(react.effect, { calmVisual: calmMotionRequested(), random: motionRandom, formId: forms.resolvePetForm(currentSkin).id }));
    return;
  }
  // 未命中里程碑时穿插陪伴动作：原互动轮盘的摸摸 / 击掌 / 一起休息并入这里，台词不丢
  companionGestureTurn++;
  if (companionGestureTurn % 3 === 0) {
      const gesture = pick(COMPANION_GESTURES);
      startManualAction(gesture.action, gesture.text);
    return;
  }
  sayContextual();
  setTemporaryState('talking', 650);
}

let lastCommandOpenAt = Number.NEGATIVE_INFINITY;
function openCommandMenuOnce(source) {
  const now = performance.now();
  if (now - lastCommandOpenAt < 350) return false;
  lastCommandOpenAt = now;
  void toggleCommandMenu(true, { focus: true, keyboard: source === 'keyboard' }).catch(() => {});
  return true;
}

listen(petHit, 'contextmenu', (e) => {
  e.preventDefault();
  openCommandMenuOnce('contextmenu');
});

// ---------- IPC ----------
function handlePetSync(data = {}) {
  if (data.devMode !== undefined) devMode = data.devMode === true;
  if (data.skin) {
    if (data.skin !== currentSkin) cancelFeedPresentation('skin-changed');
    currentSkin = data.skin;
    updatePetStageForSkin(devPreview?.skin || currentSkin);
  }
  if (data.theme) {
    currentTheme = data.theme;
    document.documentElement.style.setProperty('--primary', data.theme.primary);
    document.documentElement.style.setProperty('--accent', data.theme.accent);
  }
  if (data.work) { workStart = data.work.start; workEnd = data.work.end; }
  if (data.energyLevel !== undefined) energyLevel = data.energyLevel;
  if (data.level !== undefined) level = data.level;
  if (Array.isArray(data.appearanceItemIds)) appearanceItemIds = data.appearanceItemIds;
  if (data.stimulationMode) stimulationMode = data.stimulationMode;
  if (data.motionMode) motionMode = data.motionMode;
  if (data.petActivityMode) petActivityMode = data.petActivityMode;
  if (calmMotionRequested()) {
    // 低刺激禁止 autonomous cue；用户主动动作与 Reduce Motion 下的 cue
    // 保留 action 身份，并在 drawPet 中冻结到静态采样点。
    if (stimulationMode === 'low') {
      cancelCurrentAction('low-stimulation', { autonomousOnly: true });
    }
    // 策略收紧必须立刻清空所有装饰粒子并归零发射累加器，
    // 不能只阻止下一次创建。
    petRenderer.clearDecorativeParticles();
  }
  if (data.dnd !== undefined) {
    dnd = Boolean(data.dnd);
    if (dnd) {
      contextualRequestGeneration += 1;
      speech.hide();
      cancelCurrentAction('dnd', { autonomousOnly: true });
      if (state === 'walking') setState(sessionState);
    }
  }
  applySensoryProfile();
  syncPresentationPolicy();
  if (data.screenLocked !== undefined) setScreenLocked(data.screenLocked);
  if (data.sessionDisplay !== undefined) { legacyRing.clear(); sessionOrbit.sync(data.sessionDisplay); }
  else if (data.focusRing !== undefined && !sessionOrbit.ownsDisplay()) legacyRing.sync(data.focusRing);
  sessionOrbit.render();
  // 暂停是独立呈现事实：收到后覆盖/清除会话暂停标记。
  const pausedChanged = data.paused !== undefined && (data.paused === true) !== sessionPaused;
  if (data.paused !== undefined) sessionPaused = data.paused === true;
  notebookVisit.handle(data.cue);
  if (data.activityMirror !== undefined || data.activityMirrorConcurrent !== undefined) {
    ({ activityMirror, activityMirrorConcurrent } = applyActivityMirrorSync({ activityMirror, activityMirrorConcurrent }, data));
    syncSessionActivityMode();
  }
  if (data.transientState) {
    setTemporaryState(data.transientState, data.transientDurationMs, data.baseState);
  } else if (data.baseState) {
    if (normalizeSessionState(data.baseState) !== sessionState || pausedChanged || data.forcedState) {
      setSessionState(data.baseState);
    }
  } else if (data.forcedState) {
    // Compatibility for a renderer surviving a development hot reload.
    if (data.forcedState === 'celebrating') setTemporaryState('celebrating', 3500);
    else setSessionState(data.forcedState);
  }
  if (data.presentation) presentStructuredPetExpression(data.presentation);
  if (data.foodDrop && !dnd) showFoodReward(data.foodDrop);
  if (data.satiation !== undefined) { satiation = data.satiation; updateSatBar(data.satiation); }
  foodMenu.update(data);
  petFeeding.reconcile();
  if (data.message && !dnd) { say(data.message, 4500); setTemporaryState('talking', 4500); }
  syncPresentationBase();
  reportPetRuntime();
}

// 主进程推送库存/饱食变化（完成任务掉落食物等）—— 面板开着时就地刷新
function handlePetFeedState(data) {
  if (!data) return;
  foodMenu.update(data);
  if (data.satiation !== undefined) { satiation = data.satiation; updateSatBar(data.satiation); }
}

// ---------- Deterministic local state maintenance ----------
// Autonomous cue selection belongs exclusively to the main-process Director.
const stateMaintenanceTimer = setInterval(() => {
  if (dragging || currentEgg || foodMenuOpen) return;   // 喂食中不乱跑不发彩蛋
  if (state === 'walking' || state === 'focused' || state === 'resting' || state === 'celebrating' || state === 'dragged') return;
  if (dnd) return;
  const now = Date.now();
  const idleFor = now - idleSince;
  const hour = new Date().getHours();

  // Hunger is core status; low stimulation keeps its feedback static.
  if (satiation <= 20 && state !== 'hungry') { setState('hungry'); if (stimulationMode !== 'low' && motionRandom() < 0.3) sayContextual('hungry'); return; }
  if (satiation > 20 && state === 'hungry') { setState('idle'); idleSince = now; return; }
  // Sleep at deep night
  if ((hour >= 1 && hour < Math.min(6, workStart)) && idleFor > 60000 && state !== 'sleeping' && !dockedEdge) { setState('sleeping'); return; }
  if (state === 'sleeping' && (hour >= Math.min(6, workStart) || idleFor < 60000)) { setState('idle'); idleSince = now; return; }
}, 1000);

// ---------- Main render loop ----------
// fps 只是节流上限（真实帧率由显示器决定）。动画推进统一走运动时钟：
// 每个实际绘制的帧累加一次带上限的 dt；页面隐藏不出帧则时间不走，
// 后台恢复的大间隔被截断，不会一步把动画打飞或补播。
let lastDrawAt = 0;
function loop(timestamp = 0) {
  if (stopped) return;
  const fps = reducedMotion() || stimulationMode === 'low' ? 6 : (stimulationMode === 'high' ? 60 : 30);
  if (!document.hidden && !screenLocked && timestamp - lastDrawAt >= 1000 / fps) {
    lastDrawAt = timestamp;
    const stepped = motionClock.step(timestamp);
    animDt = stepped.dtMs;
    animNow = stepped.nowMs;
    updateActionPlayback(animNow);
    expireTemporaryState(animNow);
    advanceFeedPresentation(animNow);
    petRenderer.render();
    sessionOrbit.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

// System Reduce Motion can change while the app is running. Cancel decorative
// effects immediately instead of waiting for the next throttled frame.
const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
listen(reducedMotionMedia, 'change', () => {
  reportPetRuntime();
  syncPresentationPolicy();
  sessionOrbit.render();
  if (!calmMotionRequested()) return;
  petRenderer.clearDecorativeParticles();
});

// ---------- Feeding system ----------
let foodMenuOpen = false;
const foodMenu = createPetFoodMenu({
  document, client: clients, content: () => petContent,
  setOpen: value => { foodMenuOpen = value; syncPresentationPolicy(); sessionOrbit.render(); },
  available: () => !petDevtools?.isOpen && !rendererPresentationSuspended(),
  beforeOpen: () => { cancelFeedPresentation('menu-open'); cancelCurrentAction('menu-open'); },
  closeCommandMenu: () => toggleCommandMenu(false), expand: syncStageExpansion,
  changed: reportPetRuntime, focusReturn: () => petHit.focus({ preventScroll: true }),
  requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame, updateSatBar,
  feeding: {
    clock: { read: () => animNow }, present: presentStructuredPetExpression, say: speech.sayOwned, calm: calmMotionRequested,
    canPresent: () => !rendererPresentationSuspended(),
    canPresentAutomatic: () => !dnd && !['off', 'quiet'].includes(petActivityMode) && sessionState === 'idle' && !sessionPaused && !dragging && !foodMenuOpen && !commandMenuOpen && !dockedEdge && !petDevtools?.isOpen,
    presentAction: (actionId, duration) => {
      const playback = createManualActionPlayback(petContent, actionId, { formId: forms.resolvePetForm(currentSkin).id });
      if (!playback) return null;
      cancelCurrentAction('feeding');
      const action = beginActionPlayback({ ...playback, duration, presentationOwned: true });
      return reason => { if (currentEgg === action) cancelCurrentAction(reason); };
    },
    onFeedAccepted: (foodId, result) => {
      if (!calmMotionRequested()) showFoodDropIntoMouth(foodId);
      return { reaction: result.reaction || '' };
    },
    onPresentationComplete: durationMs => setTemporaryState('celebrating', durationMs, sessionState, { source: 'interaction' }),
    scheduleReaction: (show, delayMs) => setTimeout(show, delayMs), clearReaction: clearTimeout
  }
});
const petFeeding = foodMenu.feed;
function openFoodMenu() { return foodMenu.open(); }
function closeFoodMenu() { return foodMenu.close(); }

function cancelFeedPresentation(reason = 'cancelled') {
  return petFeeding.cancel(reason);
}

function advanceFeedPresentation(now = animNow) {
  return petFeeding.advance(now);
}

async function feedPet(foodId) {
  return petFeeding.feedPet(foodId);
}

function showFoodDropIntoMouth(foodId) {
  const foods = petContent && petContent.FOODS;
  if (!foods || !foods[foodId]) return;
  const toast = document.getElementById('foodDrop');
  toast.textContent = foods[foodId].emoji;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
}

function showFoodReward(foodId) {
  const foods = petContent && petContent.FOODS;
  if (!foods || !foods[foodId]) return;
  const toast = document.getElementById('foodDrop');
  toast.textContent = foods[foodId].emoji + '+1';
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  say(`得到 ${foods[foodId].name}，点旁边的喂食按钮给我。`, 3500);
}

function updateSatBar(satiation) {
  if (satiation === undefined || satiation === null) return;
  const bar = document.getElementById('satBar');
  const fill = document.getElementById('satFill');
  const label = document.getElementById('satLabel');
  fill.style.width = Math.max(0, Math.min(100, satiation)) + '%';
  label.textContent = `饱食 ${satiation}`;
  bar.classList.add('show');
  clearTimeout(updateSatBar._t);
  updateSatBar._t = setTimeout(() => bar.classList.remove('show'), 3000);
}

// 关闭：✕ 按钮 或 点面板外（留 800ms 宽限忽略长按松手那下点击）—— 不再存在自动消失
listen(document.getElementById('foodClose'), 'click', (e) => {
  e.stopPropagation();
  closeFoodMenu();
});
listen(window, 'click', (e) => {
  foodMenu.outside(e);
});
listen(document, 'keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (foodMenuOpen) closeFoodMenu();
  else if (commandMenuOpen) void toggleCommandMenu(false).catch(() => {});
});

function presentCue(envelope) {
  if (!petPlayer) {
    queuedCues.push(envelope);
    return { ok: true, queued: true };
  }
  const activePresentation = presentationDirector && presentationDirector.current(animNow);
  const cuePriority = petPresentation.PRIORITY_BY_SOURCE.cue;
  return petPlayer.presentCue(envelope, {
    visible: !rendererPresentationSuspended(),
    menuOpen: commandMenuOpen || foodMenuOpen || Boolean(petDevtools?.isOpen),
    dragging,
    dnd,
    lowStimulation: stimulationMode === 'low',
    reduceMotion: reducedMotion(),
    presentationBlocked: Boolean(activePresentation && activePresentation.priority > cuePriority)
  });
}

const notebookVisit = createNotebookVisit({ document, startAction: startManualAction, calm: calmMotionRequested,
  setInterval, clearInterval, setTimeout, clearTimeout,
  stopAction: () => { if (currentEgg?.id === 'take-note') cancelCurrentAction('notebook-closed'); } });
const petSync = createPetSync({
  client: clients,
  onSync: handlePetSync,
  onSelfMeal: meal => petFeeding.presentMeal(meal),
  onDock: handlePetDock,
  onPeek: handlePetPeek,
  onCue: presentCue,
  onFeedState: handlePetFeedState,
  onGaze: handlePetGaze,
  onDevtools: handlePetDevtools
});
petSync.connect();

// ---------- Init ----------
async function init() {
  const hydration = petSync.beginHydration();
  try {
    const snapshot = await clients.pet_getState();
    if (stopped) return;
    petSync.hydrate(snapshot, hydration);
    petContent = await clients.pet_getContent();
    if (stopped) return;
    if (petDevtools && petContent.PET_CATALOG) petDevtools.setCatalog(petContent.PET_CATALOG);
    sessionActivityController = petSessionActivity.createSessionActivityController({
      ...activityControllerContent(petContent),
      // 轮换推进只认单调动画时钟（校时不能跳段）；入口活动用墙钟分钟挑，
      // 否则 animNow 从 0 起算，刚启动就开始专注时永远是同一个活动。
      clock: { now: () => animNow },
      entryClock: { now: () => Date.now() }
    });
    // 表情注册表与呈现导演：内容到位后建立，动画时钟作为导演的单调时钟。
    if (Array.isArray(petContent.EXPRESSIONS)) {
      expressionRegistry = petExpression.createExpressionRegistry(petContent.EXPRESSIONS);
      presentationDirector = petPresentation.createPresentationDirector({
        clock: { now: () => animNow }
      });
      // 用启动时已加载的感官策略初始化导演门禁，再呈现“刚睁眼”的 wake。
      syncPresentationPolicy();
      showExpression('life.wake', 'session', 1500);
      while (queuedPresentations.length) presentStructuredPetExpression(queuedPresentations.shift());
    }
    petPlayer = petPlayerCore.createPetPlayer({
      manifest: petContent.manifest,
      envelopeClock: { now: () => Date.now() },
      playbackClock: { now: () => animNow },
      acknowledge: acknowledgement => clients.pet_ackCue(acknowledgement).catch(() => {}),
      onStart: playback => {
        const variant = playback.variant;
        const actionId = playback.cue.id.startsWith('egg.') ? playback.cue.id.slice(4) : variant.animationId;
        const action = petContent.PET_ACTIONS && petContent.PET_ACTIONS[actionId];
        // 静态降级仍代表同一个 cue/action；只是不执行动态 motion/粒子。
        // 保留真实 action ID，Director 才能继续解析并展示其对应静态表情。
        resetPetActionEmitters();
        beginActionPlayback({
          id: actionId,
          duration: variant.durationMs,
          manual: false,
          static: variant.animationId === 'static-pose'
        });
        const pairedLine = action && Array.isArray(action.lines) && action.lines.length ? pick(action.lines) : variant.message;
        if (pairedLine) say(pairedLine, Math.min(variant.durationMs, 5_500));
      },
      onComplete: () => {
        currentEgg = null;
        resetPetActionEmitters();
      },
      onCancel: () => {
        currentEgg = null;
        resetPetActionEmitters();
        overlayParticles = [];
        speech.hide();
      }
    });
    while (queuedCues.length) presentCue(queuedCues.shift());
    syncSessionActivityMode();
    syncPresentationBase();
  } catch (e) { /* retain accepted live context if either hydration read fails */ }
  if (stopped) return;
  idleSince = Date.now();
  // 启动时保证窗口是常态尺寸（上次异常退出可能停在扩容态）
  await clients.pet_setMenuOpen(false);
  if (stopped) return;
  reportPetRuntime();
  if (!dnd && sessionState !== 'focused') say('我在这儿。', 3500);
}
  function start() {
    if (stopped) return;
    if (started) return initialization;
    started = true;
    initialization = init()
      .catch(() => {})
      .then(() => {
        if (!stopped) loop();
      });
    return initialization;
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    contextualRequestGeneration += 1;
    petSync.dispose();
    lifetime.dispose();
    petPointer.dispose();
    petMenu.dispose();
    petDevtools.dispose();
    stage.classList.remove('devtools-open');
    dockedEdge = null;
    peeking = false;
    applyDockClass();
    notebookVisit.dispose();
    activityUi.dispose();
    sessionOrbit.dispose();
    foodMenu.dispose();
    speech.hide();
    if (stateMaintenanceTimer) clearInterval(stateMaintenanceTimer);
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    suspendRenderer('disposed');
  }
  listen(window, 'pagehide', stop);
  return Object.freeze({ start, stop, sample });
}

export default Object.freeze({ createPetController });
