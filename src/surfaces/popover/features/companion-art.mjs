'use strict';

import { SKINS } from '../../../skins.mjs';
import sensoryPolicy from '../../../core/sensory-policy.mjs';
import { forms, formArt } from '../../../capabilities/companion/index.mjs';
import { createCompanionPortraitPainter } from './companion-portrait.mjs';
import { createCompanionAmbience } from '../ui/companion-ambience.mjs';

const popoverArtSkins = SKINS;
const popoverArtSensoryPolicy = sensoryPolicy;

// 面板里那只像素兽和它的彩带。这一层只会画:皮肤调色板、点阵、彩带粒子、
// 樱花花瓣,以及“降低动效”下该省掉哪些抖动。
// 它不认识 focusSession,也不认识 state —— 当前皮肤和基线心情都是外面给的,
// 所以换一套状态源不用改一行绘制代码。
// 之前这段代码在模块顶层直接 setInterval + window.addEventListener('resize'),
// 面板关掉也停不下来;现在两者都归 mount/dispose 管。
function createPopoverCompanionArt({
  document, window, $, getSkinId, getAppearanceIds = () => [], resolveBaseMood,
  skins = popoverArtSkins, sensoryPolicy = popoverArtSensoryPolicy
} = {}) {
  if (!document || !window || typeof $ !== 'function') {
    throw new TypeError('popover companion art requires document, window and $');
  }
  if (!skins || !skins.pink) throw new TypeError('popover companion art requires the skin table');
  if (!sensoryPolicy || typeof sensoryPolicy.resolveSensoryPolicy !== 'function') {
    throw new TypeError('popover companion art requires sensoryPolicy');
  }
  if (typeof getSkinId !== 'function' || typeof getAppearanceIds !== 'function'
    || typeof resolveBaseMood !== 'function') {
    throw new TypeError('popover companion art requires getSkinId, getAppearanceIds and resolveBaseMood');
  }

  const systemReducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let confettiParticles = [];
  let petalParticles = [];
  let drawTimer = null;
  let mounted = false;

  // 降低动效是三个来源的合取:body 上的两个模式与系统偏好。三处各判一次就会
  // 出现“彩带停了但花瓣还在飘”。
  function motionReduced() {
    return sensoryPolicy.resolveSensoryPolicy({
      motionMode: document.body.dataset.motion,
      stimulationMode: document.body.dataset.stimulation,
      systemReducedMotion: systemReducedMotionQuery.matches
    }).reduceMotion;
  }

  const monsterCanvas = $('#monsterCanvas');
  const ambience = createCompanionAmbience(document);
  const portraitPainter = createCompanionPortraitPainter({ document, window, canvas: monsterCanvas });
  const mctx = portraitPainter.heroContext;

  let currentMood = 'idle';
  let celebrateUntil = 0;
  let moodStartedAt = Date.now();

  function setMood(mood) {
    if (mood === currentMood) return;
    currentMood = mood;
    moodStartedAt = Date.now();
  }

  function drawMonster() {
    const now = Date.now();
    if (currentMood !== 'celebrate' || now > celebrateUntil) setMood(deriveMood());
    const calmVisual = motionReduced() || document.body.dataset.stimulation === 'low';
    const skinId = getSkinId() || 'pink';
    portraitPainter.drawHero({ skinId, mood: currentMood, elapsedMs: now - moodStartedAt,
      now, calmVisual, itemIds: getAppearanceIds() });
    drawPortraitPetals(skinId, calmVisual, portraitPainter.heroStage.artWidth);
  }

  function drawPortraitPetals(skinId, calmVisual, size) {
    if (formArt.skinEffectForSkin(skinId, forms.resolvePetForm(skinId)) !== 'petals' || calmVisual) {
      if (petalParticles.length) petalParticles = [];
      return;
    }
    if (Math.random() < 0.15) {
      petalParticles.push({
        x: Math.random() * size,
        y: -3,
        vy: 0.3 + Math.random() * 0.3,
        vx: (Math.random() - 0.5) * 0.4,
        size: 1 + Math.floor(Math.random() * 2),
        life: 100
      });
    }
    petalParticles = petalParticles.filter(p => p.life > 0 && p.y < size + 3);
    mctx.fillStyle = '#ffb3c8';
    for (const p of petalParticles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 1;
      mctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }

  function deriveMood() { return resolveBaseMood(); }

  // 皮肤的颜色要有去处:hero 底座的光晕、抽屉里聚焦卡的描边都取这两个值,
  // 而不是再画一只缩略图来代表“换了皮肤”。
  function skinAccent(skinId) {
    const theme = (skins[skinId] || skins.pink).theme;
    return Object.freeze({ primary: theme.primary, accent: theme.accent });
  }


  function refreshMood() {
    if (currentMood !== 'celebrate' || Date.now() > celebrateUntil) setMood(deriveMood());
  }

  const confettiCanvas = $('#confetti');
  const cctx = confettiCanvas.getContext('2d');
  function resizeConfetti() {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
  let confettiFrame = null;
  function burstConfetti(x, y) {
    if (motionReduced() || document.body.dataset.stimulation === 'low') {
      clearDecorativeMotion();
      return;
    }
    const colors = ['#f7768e', '#9ece6a', '#e0af68', '#7dcfff', '#bb9af7', '#7aa2f7'];
    for (let i = 0; i < 40; i++) {
      confettiParticles.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 8 - 2,
        size: 3 + Math.floor(Math.random() * 3),
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 60 + Math.random() * 30,
        gravity: 0.3 + Math.random() * 0.2,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3
      });
    }
    if (!confettiFrame) confettiFrame = requestAnimationFrame(updateConfetti);
  }

  function updateConfetti() {
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles = confettiParticles.filter(p => p.life > 0);
    for (const p of confettiParticles) {
      p.x += p.vx; p.y += p.vy;
      p.vy += p.gravity; p.rot += p.vr;
      p.life--;
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      cctx.restore();
    }
    confettiFrame = confettiParticles.length ? requestAnimationFrame(updateConfetti) : null;
  }

  function clearDecorativeMotion() {
    if (confettiFrame) cancelAnimationFrame(confettiFrame);
    confettiFrame = null;
    confettiParticles = [];
    petalParticles = [];
    cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  function celebrate() {
    celebrateUntil = Date.now() + 3000;
    setMood('celebrate');
    const rect = monsterCanvas.getBoundingClientRect();
    burstConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  const onResize = () => resizeConfetti();
  const onReducedMotionChange = () => {
    if (motionReduced()) clearDecorativeMotion();
  };

  function mount() {
    if (mounted) return;
    mounted = true;
    ambience.mount();
    resizeConfetti();
    window.addEventListener('resize', onResize);
    systemReducedMotionQuery.addEventListener('change', onReducedMotionChange);
    drawTimer = setInterval(drawMonster, 100);
  }

  function dispose() {
    if (!mounted) return;
    mounted = false;
    ambience.dispose();
    clearInterval(drawTimer);
    drawTimer = null;
    portraitPainter.dispose();
    window.removeEventListener('resize', onResize);
    systemReducedMotionQuery.removeEventListener('change', onReducedMotionChange);
    clearDecorativeMotion();
  }

  return Object.freeze({
    mount,
    dispose,
    celebrate,
    refreshMood,
    motionReduced,
    clearDecorativeMotion,
    drawPetPreview: portraitPainter.drawPetPreview,
    skinAccent
  });
}


export { createPopoverCompanionArt };
