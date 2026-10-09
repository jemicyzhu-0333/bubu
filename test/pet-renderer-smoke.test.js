'use strict';

// pet runtime 的运行时冒烟与裁切验证。
//
// “动作时道具被画布裁掉”只在真正套上 rotate/scale 之后才暴露。这里用一个带完整
// 变换矩阵的假 2D 上下文加载真实的 ES module runtime，逐帧驱动全部 42 个行为与 12 个会话
// 动作，然后断言：每一次绘制的几何都落在光栅内。
//
// 静态扫描（pet-stage.test.js）守的是源码里写下的坐标；这里守的是坐标经过
// 旋转、缩放、镜像之后的真实落点。两者缺一不可。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPetRuntimeFixture } = require('../test-support/pet-runtime-fixture');

const petContent = require('../src/pet-content.js');
const { adaptLegacyPetContent } = require('../src/core/content-pack');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { resolveFormStage } = require('../src/capabilities/companion/form-registry.mjs');
const { createPetCatalog } = require('../src/capabilities/companion/pet-catalog');
const { SKINS } = require('../src/skins.mjs');
const { RasterBrowserImage } = require('../test-support/raster-browser-image.js');
const dangoArtist = require('../src/capabilities/companion/presentation/dango-raster-production.mjs').default;
globalThis.Image = RasterBrowserImage;
test.before(() => dangoArtist.ready({ all: true }));

const { pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
globalThis.Path2D = class { constructor(d) { this.d = d; this.bounds = pathBounds(d); } };
test.after(() => { delete globalThis.Path2D; delete globalThis.Image; });

const ROOT = path.join(__dirname, '..');

// pet:getContent 的真实负载（与 main.js 的 handler 逐字对应）。
const BUILT_IN_MANIFEST = adaptLegacyPetContent(petContent);
const PET_CONTENT_PAYLOAD = {
  LINES: petContent.LINES,
  SCENE_DECORATIONS: petContent.SCENE_DECORATIONS,
  SCENES: petContent.SCENES,
  SCENE_SCHEDULE: petContent.SCENE_SCHEDULE,
  SCENE_MANUAL_SCHEDULE: petContent.SCENE_MANUAL_SCHEDULE,
  SKIN_SCENE_PREFERENCES: petContent.SKIN_SCENE_PREFERENCES,
  PET_ACTIONS: petContent.PET_ACTIONS,
  SESSION_ACTIVITIES: petContent.SESSION_ACTIVITIES,
  SESSION_ACTIVITY_ROTATIONS: petContent.SESSION_ACTIVITY_ROTATIONS,
  MIRROR_ACTIVITIES: petContent.MIRROR_ACTIVITIES,
  MIRROR_ROTATIONS: petContent.MIRROR_ROTATIONS,
  STATE_SCENES: petContent.STATE_SCENES,
  SKIN_SCENES: petContent.SKIN_SCENES,
  INTERACTIONS: petContent.INTERACTIONS,
  FOODS: petContent.FOODS,
  EXPRESSIONS: petContent.EXPRESSIONS,
  EXPRESSION_LIBRARY_STATS: petContent.EXPRESSION_LIBRARY_STATS,
  PET_APPEARANCE_ITEMS: petContent.PET_APPEARANCE_ITEMS,
  PET_APPEARANCE_VIEWS: petContent.PET_APPEARANCE_VIEWS,
  PET_CATALOG: createPetCatalog({ content: petContent, skins: SKINS }),
  manifest: BUILT_IN_MANIFEST
};

// Keep the smoke suite's full content, plain styles and inert media listeners.
const createHarness = createPetRuntimeFixture({ contentPayload: PET_CONTENT_PAYLOAD,
  styleProperties: false, liveReducedMotion: false });

function devButton(harness, category, id) {
  const button = harness.document.getElementById('devToolsList').children
    .flatMap(section => section.children)
    .flatMap(grid => grid.children)
    .find(item => item.dataset.devCategory === category && item.dataset.devId === id);
  assert.ok(button, `missing devtools item: ${category}:${id}`);
  return button;
}

// ---------- 用例 ----------
// init() 是 async 并且串联了多个 await；用宏任务边界确保它整段跑完，
// 否则 petContent / petPlayer / sessionActivityController 都还是 null。
function settleInit() {
  return new Promise(resolve => setImmediate(() => setImmediate(() => setImmediate(resolve))));
}

function cueEnvelope(cue, issuedAt) {
  const variant = cue.variants.find(item => !item.static) || cue.variants[0];
  const normalizedIssuedAt = Math.round(issuedAt);
  return {
    version: 1,
    decisionId: `smoke-${cue.id.replace(/[^a-z0-9._-]/g, '-')}`,
    cueId: cue.id,
    familyId: cue.familyId,
    variant: variant.id,
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedIssuedAt + 30_000
  };
}

test('pet runtime 在真实内容与全部动作下都能无异常出帧', async () => {
  const harness = createHarness();
  await settleInit();

  assert.equal(typeof harness.bridge.handlers.sync, 'function', 'onPetSync 未注册，说明 pet runtime 初始化中断了');
  assert.equal(typeof harness.bridge.handlers.cue, 'function', 'onPetCue 未注册');

  // 高刺激 + 完整动效 = 最激烈的绘制路径（低刺激会直接跳过动作变换）。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frame(4);

  assert.ok(harness.petContext._calls.length > 0, '宠物画布没有产生任何绘制');
});

test('快捷行动面板的同步 cue 在 DND 下仍播放已有的读书动作', async () => {
  const harness = createHarness();
  await settleInit();

  harness.bridge.handlers.sync({
    dnd: true,
    stimulationMode: 'low',
    motionMode: 'reduced',
    cue: { id: 'system.notebook-ready', at: harness.clockState.now }
  });

  assert.equal(harness.runtime.sample().actionId, 'take-note');
});

test('全部行为与会话动作的绘制都落在光栅内，没有任何一处被画布裁掉', async () => {
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const harness = createHarness({ devicePixelRatio: 2 });
  await settleInit();

  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });

  const overflow = [];
  // 跨全部帧累积的极限包围盒，换算回“以身体左上角为原点的美术像素”坐标系。
  const worst = { left: 0, top: 0, right: 0, bottom: 0 };
  let drawCalls = 0;

  function assertInsideRaster(label) {
    const box = harness.petContext._box;
    drawCalls += harness.petContext._calls.length;
    if (box.minX === Infinity) return;
    const tolerance = 0.001;
    if (box.minX < -tolerance) overflow.push(`${label}: 左侧越界 ${(-box.minX).toFixed(1)} 设备像素`);
    if (box.minY < -tolerance) overflow.push(`${label}: 顶部越界 ${(-box.minY).toFixed(1)} 设备像素`);
    if (box.maxX > stage.rasterWidth + tolerance) overflow.push(`${label}: 右侧越界 ${(box.maxX - stage.rasterWidth).toFixed(1)} 设备像素`);
    if (box.maxY > stage.rasterHeight + tolerance) overflow.push(`${label}: 底部越界 ${(box.maxY - stage.rasterHeight).toFixed(1)} 设备像素`);

    const scale = stage.deviceScale;
    worst.left = Math.min(worst.left, box.minX / scale - stage.bodyOrigin.x);
    worst.top = Math.min(worst.top, box.minY / scale - stage.bodyOrigin.y);
    worst.right = Math.max(worst.right, box.maxX / scale - stage.bodyOrigin.x);
    worst.bottom = Math.max(worst.bottom, box.maxY / scale - stage.bodyOrigin.y);

    harness.petContext._reset();
  }

  // 1) 所有皮肤 × 关键状态的静态身体（sakura 的花瓣故意从画布上方落入，单独排除）。
  for (const skin of ['pink', 'forest', 'ocean', 'moon', 'flame', 'crown', 'robot', 'woodsman', 'bat']) {
    for (const state of ['idle', 'sleeping', 'celebrating', 'hungry', 'walking', 'talking', 'dragged']) {
      harness.bridge.handlers.sync({ skin, baseState: state, stimulationMode: 'high', motionMode: 'full' });
      harness.frame(6, 200);
      assertInsideRaster(`skin=${skin} state=${state}`);
    }
  }

  // 2) 专注与休息的 12 个会话动作，各推进多帧覆盖整个相位。
  for (const baseState of ['focused', 'resting']) {
    harness.bridge.handlers.sync({ baseState, stimulationMode: 'high', motionMode: 'full' });
    for (let round = 0; round < 8; round++) {
      harness.document._resolve('#activityNext').dispatch('click', { stopPropagation() {} });
      // 会话动作至少 20s，扫 24 帧 × 1s 覆盖它的完整相位。
      harness.frame(24, 1_000);
      assertInsideRaster(`session=${baseState} round=${round}`);
    }
  }

  // 3) 全部 42 个行为彩蛋，逐个通过 Director 信封播放并扫过完整相位。
  harness.bridge.handlers.sync({ baseState: 'idle', stimulationMode: 'high', motionMode: 'full' });
  let issuedAt = 1_700_000_000_000;
  for (const cue of BUILT_IN_MANIFEST.cues) {
    issuedAt = harness.clockState.now + 1;
    harness.bridge.handlers.cue(cueEnvelope(cue, issuedAt));
    // 最短行为 6.5s，步长 500ms × 24 帧 = 12s，保证 actionT 从 0 扫到 1。
    harness.frame(24, 500);
    assertInsideRaster(`cue=${cue.id}`);
  }

  assert.deepEqual(overflow, [],
    '有绘制越出了光栅，会被画布边缘裁掉。请检查 core/pet-stage.mjs 的 PET_ART_BLEED 或收敛该动作的坐标。');

  // ---- 负向对照 ----
  // 上面全绿必须是“余量够用”的结果，不能是“根本没画东西”的结果。
  // 0.1.2 之前的画布是 70×70、身体居中，即安全区只有 [-2, 68]；
  // 用同一批帧的真实落点反验它：当时确实会被裁。
  assert.ok(drawCalls > 3_000, `只采集到 ${drawCalls} 次绘制，驱动器没有真正跑到动作渲染`);

  const LEGACY_BLEED = 2;
  const clippedSides = [];
  if (worst.left < -LEGACY_BLEED) clippedSides.push(`左 ${(-worst.left - LEGACY_BLEED).toFixed(1)}`);
  if (worst.top < -LEGACY_BLEED) clippedSides.push(`上 ${(-worst.top - LEGACY_BLEED).toFixed(1)}`);
  if (worst.right > stage.bodySize + LEGACY_BLEED) clippedSides.push(`右 ${(worst.right - stage.bodySize - LEGACY_BLEED).toFixed(1)}`);
  if (worst.bottom > stage.bodySize + LEGACY_BLEED) clippedSides.push(`下 ${(worst.bottom - stage.bodySize - LEGACY_BLEED).toFixed(1)}`);
  assert.ok(clippedSides.length >= 3,
    `负向对照失效：当前绘制的极限伸展（左 ${worst.left.toFixed(1)} 上 ${worst.top.toFixed(1)} ` +
    `右 ${worst.right.toFixed(1)} 下 ${worst.bottom.toFixed(1)}）居然能塞进旧的 70×70 画布，` +
    '说明驱动器没有真正画出四肢与道具。');

  // 余量也不能拉得过头：它直接决定窗口内的画布面积与每帧成本。
  const usedBleed = Math.max(-worst.left, -worst.top, worst.right - stage.bodySize, worst.bottom - stage.bodySize);
  assert.ok(usedBleed <= stage.bleed,
    `实际用到 ${usedBleed.toFixed(1)} 美术像素余量，超过了契约的 ${stage.bleed}`);
  assert.ok(stage.bleed - usedBleed <= 12,
    `余量 ${stage.bleed} 比实际需要的 ${usedBleed.toFixed(1)} 多出太多，白白撑大了画布`);
});

// “割裂”的充分条件：只有平移的身体贴图必须落在整数设备像素上。
// 旋转/缩放类动作本来就需要连续变换，轮廓抗锯齿是预期行为，
// 且它们是一整张位图的轮廓，不会在格子之间裂开，所以这里按 CTM 区分。
function isAxisAlignedUnscaled(matrix, deviceScale) {
  const epsilon = 1e-9;
  return Math.abs(matrix.b) < epsilon
    && Math.abs(matrix.c) < epsilon
    && Math.abs(Math.abs(matrix.a) - deviceScale) < epsilon
    && Math.abs(Math.abs(matrix.d) - deviceScale) < epsilon;
}

test('平移类动作的身体贴图始终 1:1 落在整数设备像素上（不产生裂缝）', async () => {
  for (const devicePixelRatio of [1, 2, 3]) {
    const stage = resolveFormStage('pink', devicePixelRatio);
    const harness = createHarness({ devicePixelRatio });
    await settleInit();

    harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });

    const canvas = harness.document._resolve('#petCanvas');
    assert.equal(canvas.width, stage.rasterWidth);
    assert.equal(canvas.height, stage.rasterHeight);
    assert.equal(canvas.style.width, `${stage.cssWidth}px`);

    let checkedBlits = 0;
    const misaligned = [];

    function inspect(label) {
      for (const call of harness.petContext._calls) {
        // Moving raster limbs, face and equipment use continuous attachment
        // coordinates; this invariant applies to the cached body surface only.
        if (call.source !== 'drawImage' || call.imageSrc) continue;
        if (!isAxisAlignedUnscaled(call.matrix, stage.deviceScale)) continue;
        checkedBlits++;
        if (Math.abs(call.x - Math.round(call.x)) > 1e-6 || Math.abs(call.y - Math.round(call.y)) > 1e-6) {
          misaligned.push(`${label}: 身体贴图落在 (${call.x.toFixed(3)}, ${call.y.toFixed(3)})`);
        }
      }
      harness.petContext._reset();
    }

    // 会话动作全部是平移类，扫完整相位。
    for (const baseState of ['focused', 'resting']) {
      harness.bridge.handlers.sync({ baseState, stimulationMode: 'high', motionMode: 'full' });
      for (let round = 0; round < 6; round++) {
        harness.document._resolve('#activityNext').dispatch('click', { stopPropagation() {} });
        harness.frame(24, 1_000);
        inspect(`dpr=${devicePixelRatio} session=${baseState} round=${round}`);
      }
    }

    // 行为彩蛋里的平移类动作（look / daydream / 兼主身体节拍的兼容分支）同样要对齐。
    harness.bridge.handlers.sync({ baseState: 'idle', stimulationMode: 'high', motionMode: 'full' });
    for (const cue of BUILT_IN_MANIFEST.cues) {
      harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
      harness.frame(24, 500);
      inspect(`dpr=${devicePixelRatio} cue=${cue.id}`);
    }

    assert.ok(checkedBlits > 200,
      `dpr=${devicePixelRatio} 只检查到 ${checkedBlits} 个平移贴图，驱动器没有真正跑到平移动作`);
    assert.deepEqual(misaligned.slice(0, 5), [],
      '平移类动作的身体贴图落在了半个设备像素上：轮廓会被反锯齿化，' +
      '在透明置顶窗口上就是一条能看见桌面的裂缝。位移必须经过 snapToPetDevicePixel。');
  }
});

// ---------- 帧率无关性 ----------
// 同一 5 秒真实时间分别按 6/30/60 FPS 模拟：
// - 眨眼由绝对时间调度，计数容差定义为 ±1（浮点累计动画时间的末帧差）；
// - 粒子由速率累加器发射，计数容差定义为 ±1（浮点结转舍入）；
// - 身体贴图落点容差定义为 1 美术像素（整数设备像素量化单位）。
// 三个模拟使用同一种子的确定性随机，调度序列完全相同。
const FPS_PARITY_DURATION_MS = 5000;

async function runFpsSimulation(fps) {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  // 高刺激 + 完整动效才会启用常驻动画与粒子；樱花皮肤自带两层粒子发射器。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'sakura' });

  // 帧间隔略大于显示周期，确保穿过节流门限；推进到累计动画时间达到 5 秒。
  const stepMs = 1000 / fps + 0.01;
  let steps = 0;
  while (harness.runtime.sample().animNow < FPS_PARITY_DURATION_MS && steps < 100000) {
    harness.frameBy(stepMs);
    steps += 1;
  }
  // 最后一帧的身体贴图位置作为轨迹抽样点。
  let lastBlit = null;
  for (let index = harness.petContext._calls.length - 1; index >= 0; index--) {
    const call = harness.petContext._calls[index];
    if (call.source === 'drawImage') { lastBlit = call; break; }
  }
  return { sample: harness.runtime.sample(), lastBlit };
}

test('6/30/60 FPS 模拟同一 5 秒：眨眼、粒子与轨迹结果一致', async () => {
  const runs = {};
  for (const fps of [6, 30, 60]) runs[fps] = await runFpsSimulation(fps);

  for (const fps of [6, 30, 60]) {
    const { sample } = runs[fps];
    assert.ok(sample.animNow >= FPS_PARITY_DURATION_MS, `fps=${fps} 没有跑满 5 秒动画时间`);
    assert.ok(sample.animNow <= FPS_PARITY_DURATION_MS + 300,
      `fps=${fps} 超出 5 秒超过一帧上限，动画时钟可能被补播`);
  }

  // 眨眼：绝对时间调度。同一随机序列的排程与帧率无关。
  // 眨眼间隔 667–2333ms，5 秒内期望 2–7 次；下限守住“发射器真的在跑”。
  const blinks = [runs[6].sample.blinkCount, runs[30].sample.blinkCount, runs[60].sample.blinkCount];
  for (const count of blinks) {
    assert.ok(count >= 1 && count <= 10, `5 秒眨眼次数 ${count} 不在合理量级内`);
  }
  assert.ok(Math.max(...blinks) - Math.min(...blinks) <= 1,
    `三种帧率的眨眼次数差超过容差 1：${blinks}`);

  // 粒子：花瓣与场景粒子雨都走速率累加器。
  // 期望量级：花瓣 6/秒 × 5 秒 ≈ 30；樱花场景雨 3.6/秒 × 5 秒 ≈ 18
  // （场景自带发射器只会更多）。量级下限防止“对称坍缩成几个”也蒙混过关。
  const floors = { petalsSpawned: 20, sceneParticlesSpawned: 15 };
  for (const key of ['petalsSpawned', 'sceneParticlesSpawned']) {
    const values = [runs[6].sample[key], runs[30].sample[key], runs[60].sample[key]];
    for (const value of values) {
      assert.ok(value >= floors[key],
        `${key} 数量 ${value} 低于期望量级下限 ${floors[key]}，发射器可能没有在跑`);
    }
    assert.ok(Math.max(...values) - Math.min(...values) <= 1,
      `${key} 三种帧率数量差超过容差 1：${values}`);
  }

  // 轨迹：同真实时刻的身体贴图落点应在 1 美术像素内一致。
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const blits = [runs[6].lastBlit, runs[30].lastBlit, runs[60].lastBlit];
  assert.ok(blits.every(Boolean), '没有采集到身体贴图');
  const tolerance = stage.deviceScale;
  for (const [a, b] of [[blits[0], blits[1]], [blits[1], blits[2]], [blits[0], blits[2]]]) {
    assert.ok(Math.abs(a.x - b.x) <= tolerance,
      `身体贴图 x 在不同帧率间漂移：${a.x.toFixed(2)} vs ${b.x.toFixed(2)}`);
    assert.ok(Math.abs(a.y - b.y) <= tolerance,
      `身体贴图 y 在不同帧率间漂移：${a.y.toFixed(2)} vs ${b.y.toFixed(2)}`);
  }
});

test('动作完成时间不随帧率变化', async () => {
  const cue = BUILT_IN_MANIFEST.cues[0];
  const variant = cue.variants.find(item => !item.static) || cue.variants[0];
  const duration = variant.durationMs;

  for (const fps of [6, 30, 60]) {
    const harness = createHarness({ deterministicRandom: true });
    await settleInit();
    harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
    const warmupStep = 1000 / fps + 0.01;
    while (harness.runtime.sample().animNow < 1700) {
      harness.frameBy(warmupStep);
    }
    const played = harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
    assert.equal(played.ok, true, `fps=${fps} cue 被拒绝：${played.reason || 'unknown'}`);
    assert.equal(harness.runtime.sample().eggActive, true,
      `fps=${fps} 彩蛋未启动`);
    const actionStartedAt = harness.runtime.sample().animNow;

    // 动画时钟首帧只锚定不推进，业务时钟领先一个步长；
    // 余量必须大于两帧，6 FPS（166.7ms 步长）下才不会越线。
    const stepMs = 1000 / fps + 0.01;
    let guard = 0;
    while (harness.runtime.sample().animNow - actionStartedAt < duration - 400 && guard++ < 100000) {
      harness.frameBy(stepMs);
    }
    assert.equal(harness.runtime.sample().eggActive, true,
      `fps=${fps} 动作在时长到达前结束了`);

    guard = 0;
    while (harness.runtime.sample().animNow - actionStartedAt < duration + 500 && guard++ < 100000) {
      harness.frameBy(stepMs);
    }
    assert.equal(harness.runtime.sample().eggActive, false,
      `fps=${fps} 动作没有按真实时长完成`);
  }
});

test('彩蛋粒子发射不随 6/30/60 FPS 改变密度', async () => {
  const cue = BUILT_IN_MANIFEST.cues.find(item => item.id === 'egg.workout');
  assert.ok(cue, '缺少 workout 彩蛋测试夹具');
  const totals = [];

  for (const fps of [6, 30, 60]) {
    const harness = createHarness({ deterministicRandom: true });
    await settleInit();
    harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
    const stepMs = 1000 / fps + 0.01;
    harness.frameBy(stepMs, Math.ceil(fps * 2));
    const played = harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
    assert.equal(played.ok, true, `fps=${fps} workout cue 被拒绝`);
    const startedAt = harness.runtime.sample().animNow;
    while (harness.runtime.sample().animNow - startedAt < 3000) {
      harness.frameBy(stepMs);
    }
    totals.push(harness.runtime.sample().actionParticlesSpawned);
  }

  for (const total of totals) {
    // 0.4.x：generic 特效发射器从 8.57/s 降到 4.5/s（配合按语义分色，避免“每个动作
    // 都在放烟花”）。workout 另有 7.5/s 的专用出汗发射器，合计约 12/s → 3 秒 ~36 颗。
    assert.ok(total >= 30 && total <= 42, `3 秒 workout 粒子数 ${total} 偏离期望量级`);
  }
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 2,
    `三种帧率的彩蛋粒子数差超过容差 2：${totals}`);
});

test('页面隐藏时动画时钟停走，恢复后不补播', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(1000 / 60 + 0.01, 120);
  const before = harness.runtime.sample().animNow;
  assert.ok(before > 1500, '应先累积约 2 秒动画时间');

  // 隐藏 10 秒：rAF 回调仍然到达，但一帧都不画。
  harness.document.hidden = true;
  harness.document.dispatch('visibilitychange');
  harness.frameBy(1000, 10);
  assert.equal(harness.runtime.sample().animNow, before,
    '页面隐藏期间动画时间不得推进');

  // 恢复后的第一帧必须只重新锚定，严格不补播后台时间。
  harness.document.hidden = false;
  harness.document.dispatch('visibilitychange');
  harness.frameBy(1000 / 60 + 0.01, 1);
  const resumed = harness.runtime.sample().animNow;
  assert.equal(resumed, before, '恢复首帧只应重新锚定，不能推进动画时间');
  harness.frameBy(1000 / 60 + 0.01, 1);
  assert.ok(harness.runtime.sample().animNow > before,
    '重新锚定后的下一帧应恢复正常推进');
});

// ---------- 身体与脸部独立呈现 ----------

test('身体位图缓存不随眨眼/表情切换增长（有界）', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });

  // 预热：首次绘制会创建该皮肤的身体位图。
  harness.frameBy(1000 / 60 + 0.01, 10);
  const afterWarmup = harness.created.count;
  assert.ok(afterWarmup >= 1, '首帧应至少创建一块身体位图');

  // 驱动足够多的帧，覆盖多次眨眼与表情切换（庆祝/说话/空闲来回）。
  for (const forcedState of ['idle', 'celebrating', 'talking', 'idle', 'celebrating', 'idle']) {
    harness.bridge.handlers.sync({ baseState: 'idle', transientState: forcedState, transientDurationMs: 3500, stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
    harness.frameBy(1000 / 60 + 0.01, 120);
  }

  // 眨眼与表情只影响“活动脸”，不进身体位图缓存键：缓存不得增长。
  assert.equal(harness.created.count, afterWarmup,
    `身体位图缓存在眨眼/表情切换中从 ${afterWarmup} 增长到 ${harness.created.count}，说明缓存键仍含逐帧位姿`);
});

test('模拟空闲 10 分钟时缓存、粒子和单一心跳保持有界', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'sakura' });
  const stepMs = 1000 / 6 + 0.01;
  harness.frameBy(stepMs, 60);
  const warmedSurfaces = harness.created.count;
  const startedAt = harness.runtime.sample().animNow;
  let checkpoints = 0;

  while (harness.runtime.sample().animNow - startedAt < 10 * 60 * 1000) {
    harness.frameBy(stepMs, 60);
    const sample = harness.runtime.sample();
    checkpoints += 1;
    assert.ok(sample.bodySpriteCacheSize <= sample.bodySpriteCacheCapacity,
      `body cache ${sample.bodySpriteCacheSize}/${sample.bodySpriteCacheCapacity} 越界`);
    assert.ok(sample.sceneParticleCount <= 240, `scene particles 越界：${sample.sceneParticleCount}`);
    assert.ok(sample.overlayParticleCount <= 160, `overlay particles 越界：${sample.overlayParticleCount}`);
    assert.ok(sample.petalCount <= 80, `petals 越界：${sample.petalCount}`);
    assert.equal(harness.timers.rafCallbacks.length, 1, '渲染器只能维持一个 rAF 心跳');
    for (const key of ['animNow', 'gazeX', 'gazeY', 'actionProgress']) {
      assert.ok(Number.isFinite(sample[key]), `${key} 在长稳运行中变为非有限值`);
    }
    // 记录型 Canvas 会保存所有调用；周期清理只清测试观察数据，不改变渲染状态。
    for (const { context } of harness.contexts) context._reset();
  }

  assert.ok(checkpoints >= 59, '长稳模拟没有覆盖完整 10 分钟');
  assert.equal(harness.created.count, warmedSurfaces,
    '同皮肤空闲运行不应持续创建 body sprite surface');
});

test('renderer 不再使用帧计数或逐帧随机驱动动效', () => {
  const source = ['runtime', 'controller', 'renderer', 'compositor', 'scene', 'effects', 'sync', 'menu', 'pointer'].map(name => fs.readFileSync(path.join(ROOT, 'src/surfaces/pet', name + '.mjs'), 'utf8')).join('\n');
  const executableLines = source.split('\n').filter(line => !line.trimStart().startsWith('//'));
  const randomCalls = executableLines.filter(line => line.includes('Math.random('));
  assert.deepEqual(randomCalls.map(line => line.trim()), [
    'const randomSeed = Math.floor(environment.Math.random() * 0x100000000);'
  ], 'Math.random 只允许在启动时生成一次种子');
  assert.doesNotMatch(executableLines.join('\n'), /\bframe\s*(?:\+\+|%|\*)/,
    '渲染与发射不得重新依赖 frame 计数');
});

test('所有皮肤保持轮廓与眼嘴对比', () => {
  const palettes = require('../src/core/pet-art.mjs').PALETTES;
  assert.ok(Object.keys(palettes).length >= 10, '至少 10 个皮肤');
  for (const [skin, p] of Object.entries(palettes)) {
    assert.notEqual(p[4], p[2], `${skin} 眼色与体色相同，眼睛会不可见`);
    assert.notEqual(p[1], p[2], `${skin} 轮廓色与体色相同，轮廓会消失`);
    assert.ok(p[1] && p[2] && p[3] && p[4], `${skin} 调色板不完整`);
  }
});

test('16 个核心表达全部注册且各有独立静态位姿', () => {
  const petExpression = require('../src/core/pet-expression.mjs');
  const registry = petExpression.createExpressionRegistry(PET_CONTENT_PAYLOAD.EXPRESSIONS);
  assert.equal(registry.errors.length, 0, `payload 表达注册不应出错：${registry.errors.join('; ')}`);

  const core = [
    'life.idle', 'life.wake', 'life.sleep', 'life.drowsy', 'life.peek', 'life.attentive',
    'work.ready', 'work.starting', 'work.focus', 'work.pause', 'work.rest',
    'react.happy', 'react.satisfied', 'react.surprised', 'react.petted', 'react.celebrate'
  ];
  for (const id of core) {
    assert.ok(registry.has(id), `核心表达 ${id} 未注册`);
    const config = registry.get(id);
    assert.ok(config.static && config.static.face, `${id} 缺少静态位姿`);
  }

  // 16 个核心表达的静态脸两两不同，保证可辨识。
  const signatures = core.map(id => {
    const f = registry.get(id).static.face;
    return `${f.eyes}|${f.mouth}`;
  });
  assert.equal(new Set(signatures).size, core.length, '16 个核心表达的静态脸必须两两可辨');
});

test('表情位姿采样驱动绘制，脸部随身体变换不漂移', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });

  // 空闲（呼吸循环）与庆祝（跳动）都应分别贴出身体和已合成的活动脸。
  // 活动脸不能在变形后的主 context 逐格 fillRect，否则缩放会产生内部棋盘缝。
  harness.frameBy(1000 / 60 + 0.01, 60);
  const calls = harness.petContext._calls;
  const blits = calls.filter(call => call.source === 'drawImage');
  assert.ok(blits.length >= 120, '每帧都应分别贴出身体与活动脸两张贴图');

  // 每个身体贴图的落点都必须在光栅内（不漂移出画布）。
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  for (const blit of blits) {
    assert.ok(blit.x >= -0.001 && blit.y >= -0.001, '身体贴图漂出画布左上');
    assert.ok(blit.x <= stage.rasterWidth + 0.001 && blit.y <= stage.rasterHeight + 0.001,
      '身体贴图漂出画布右下');
  }
});

test('困倦符号只画在宠物层，不再通过独立 overlay 叠在脸上', async testContext => {
  const harness = createHarness({ deterministicRandom: true });
  testContext.after(() => harness.runtime.stop());
  await settleInit();
  const lateNight = new Date(harness.clockState.now);
  lateNight.setHours(23, 0, 0, 0);
  harness.clockState.now = lateNight.getTime();
  harness.bridge.handlers.sync({ baseState: 'idle', skin: 'pink', level: 1, motionMode: 'reduced' });
  harness.frameBy(200, 12);
  const overlay = harness.contexts.find(item => item.id === '#overlayCanvas').context;
  harness.petContext._reset();
  overlay._reset();
  harness.frameBy(200);

  assert.equal(harness.runtime.sample().expressionId, 'life.drowsy');
  const accents = harness.petContext._calls.filter(call => call.imageSrc?.includes('/effects/drowsy-zzz.png'));
  assert.equal(accents.length, 4, '一枚生成的困倦符号应进入身体变换');
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  assert.ok(accents.every(call => call.y < stage.bodyOrigin.y * stage.deviceScale), '符号必须在头顶而非脸部');
  assert.deepEqual(overlay._calls, [], '静态困倦不再在 overlay 上绘制另一组符号');
});

test('呈现可达性——状态/会话事实映射到对应表情，且重复出现不被去重吞掉', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const expr = () => harness.runtime.sample().expressionId;
  const step = 1000 / 60 + 0.01;

  // 启动：先有短暂的 wake，随后落回 idle/drowsy（深夜）。推进越过 wake 的 1.5s。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);
  assert.ok(['life.idle', 'life.drowsy'].includes(expr()),
    `待机 base 应是 idle 或 drowsy，实际 ${expr()}`);

  // 进入专注：先 work.starting，稳定后落回当前轮换动作的正式 expression。
  harness.bridge.handlers.sync({ baseState: 'focused', stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 2);
  assert.equal(expr(), 'work.starting', '进入专注瞬间应呈现 starting');
  harness.frameBy(step, 120);
  assert.equal(expr(), harness.runtime.sample().sessionActivityExpression,
    'starting 稳定后应落到当前专注动作的正式 expression');

  // 休息：当前轮换动作自己的正式 expression。
  harness.bridge.handlers.sync({ baseState: 'resting', stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 10);
  assert.equal(expr(), harness.runtime.sample().sessionActivityExpression,
    '休息应呈现当前动作的正式 expression');

  // 说话（互动）：react.happy。
  harness.bridge.handlers.sync({ baseState: 'idle', stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 10);
  harness.bridge.handlers.sync({ transientState: 'talking', transientDurationMs: 5000, baseState: 'idle' });
  harness.frameBy(step, 5);
  assert.equal(expr(), 'react.happy', '说话应呈现 happy');

  // base 更新不能抢断更高优先级 talking；超时后才回到最新 base。
  harness.bridge.handlers.sync({ baseState: 'idle', stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 10);
  assert.equal(expr(), 'react.happy', 'base 更新不得抢断互动 transient');
  harness.frameBy(step, 300);
  assert.ok(['life.idle', 'life.drowsy'].includes(expr()), '说话结束应回到 base');

  // 再次说话：必须再次呈现 happy（新事件），而不是被去重窗口吞掉。
  harness.bridge.handlers.sync({ transientState: 'talking', transientDurationMs: 5000, baseState: 'idle' });
  harness.frameBy(step, 5);
  assert.equal(expr(), 'react.happy', '重复出现的互动必须再次呈现，不能被去重吞掉');

  // 庆祝：react.celebrate。
  harness.bridge.handlers.sync({ transientState: 'celebrating', transientDurationMs: 3500 });
  harness.frameBy(step, 5);
  assert.equal(expr(), 'react.celebrate', '庆祝应呈现 celebrate');
});

test('会话暂停（paused 事实）呈现 work.pause，恢复后回到会话基座', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const expr = () => harness.runtime.sample().expressionId;
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);

  // 专注中：当前轮换动作自己的正式 expression。
  harness.bridge.handlers.sync({ baseState: 'focused' });
  harness.frameBy(step, 120);
  assert.equal(expr(), harness.runtime.sample().sessionActivityExpression,
    '专注中应呈现当前动作的正式 expression');

  // 暂停：baseState 回 idle，但 paused=true → 呈现 work.pause 而非普通待机。
  harness.bridge.handlers.sync({ baseState: 'idle' });
  harness.bridge.handlers.sync({ paused: true });
  harness.frameBy(step, 10);
  assert.equal(expr(), 'work.pause', '暂停应呈现 pause，而不是普通 idle');

  // 恢复：paused=false + 回到专注 → 先 resume，再落回当前动作 expression。
  harness.bridge.handlers.sync({ baseState: 'focused' });
  harness.bridge.handlers.sync({ paused: false });
  harness.frameBy(step, 2);
  assert.equal(expr(), 'work.resume', '暂停后恢复必须呈现 resume，不能重新播放 starting');
  harness.frameBy(step, 120);
  assert.equal(expr(), harness.runtime.sample().sessionActivityExpression,
    '恢复后应落回当前会话动作基座');
});

test('启动时恢复暂停事实，不闪回 idle/wake', async () => {
  const harness = createHarness({
    deterministicRandom: true,
    initialState: { state: 'idle', paused: true }
  });
  await settleInit();
  harness.frameBy(1000 / 60 + 0.01, 2);
  assert.equal(harness.runtime.sample().expressionId, 'work.pause');
});

test('Dango actual controller cycles idle, focus, idle, night sleep and morning idle without stale session props', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + .01;
  const sample = () => harness.runtime.sample();
  try {
    harness.frameBy(step, 120);
    assert.equal(sample().expressionId, 'life.idle');
    harness.bridge.handlers.sync({ baseState: 'focused' }); harness.frameBy(step, 2);
    assert.equal(sample().expressionId, 'work.starting');
    harness.frameBy(step, 120);
    assert.equal(sample().expressionId, sample().sessionActivityExpression);
    assert.ok(sample().sessionActivityId);
    harness.bridge.handlers.sync({ baseState: 'idle' }); harness.frameBy(step, 20);
    assert.equal(sample().expressionId, 'life.idle'); assert.equal(sample().sessionActivityId, null);
    const nextDay = new Date(harness.clockState.now);
    nextDay.setDate(nextDay.getDate() + 1); nextDay.setHours(2, 0, 0, 0);
    harness.clockState.now = nextDay.getTime();
    for (const interval of harness.timers.intervals) interval();
    harness.frameBy(step, 20);
    assert.equal(sample().state, 'sleeping'); assert.equal(sample().expressionId, 'life.sleep');
    assert.equal(sample().renderedEyeMask, 'closed'); assert.equal(sample().sessionActivityId, null);
    nextDay.setHours(7, 0, 0, 0); harness.clockState.now = nextDay.getTime();
    for (const interval of harness.timers.intervals) interval();
    harness.frameBy(step, 20);
    // Current product state maintenance returns to idle; it does not emit a
    // life.wake event. Wake-expression previews must not claim otherwise.
    assert.equal(sample().state, 'idle'); assert.equal(sample().expressionId, 'life.idle');
    assert.equal(sample().sessionActivityId, null); assert.equal(sample().eggActive, false);
  } finally { harness.runtime.stop(); }
});

test('Dango focus interruption while hidden resumes latest idle and calm state, without replaying start or resume', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + .01;
  try {
    harness.frameBy(step, 120);
    harness.bridge.handlers.sync({ baseState: 'focused' }); harness.frameBy(step, 2);
    assert.equal(harness.runtime.sample().expressionId, 'work.starting');
    harness.document.hidden = true; harness.document.dispatch('visibilitychange');
    harness.bridge.handlers.sync({ baseState: 'idle', paused: true });
    harness.bridge.handlers.sync({ baseState: 'focused', paused: false });
    harness.bridge.handlers.sync({ baseState: 'idle', stimulationMode: 'low' });
    const hidden = harness.runtime.sample(); harness.frameBy(1000, 5);
    assert.equal(harness.runtime.sample().animNow, hidden.animNow);
    harness.document.hidden = false; harness.document.dispatch('visibilitychange'); harness.frameBy(step, 3);
    const current = harness.runtime.sample();
    assert.equal(current.expressionId, 'life.idle'); assert.equal(current.presentationStatic, true);
    assert.equal(current.sessionActivityId, null); assert.equal(current.eggActive, false);
    assert.equal(current.overlayParticleCount, 0);
  } finally { harness.runtime.stop(); }
});

test('减少动效/低刺激运行时切换，呈现立即降级为静态', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const dbg = () => harness.runtime.sample();
  const step = 1000 / 60 + 0.01;

  // 完整动效：呈现非静态。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);
  assert.equal(dbg().presentationStatic, false, '完整动效下呈现应为动态');

  // 运行中切到减少动效：导演门禁立即把呈现降级为静态。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'reduced' });
  harness.frameBy(step, 10);
  assert.equal(dbg().presentationStatic, true, '减少动效下呈现应降级为静态');

  // 运行中切到低刺激：同样降级为静态。
  harness.bridge.handlers.sync({ stimulationMode: 'low', motionMode: 'full' });
  harness.frameBy(step, 10);
  assert.equal(dbg().presentationStatic, true, '低刺激下呈现应降级为静态');

  // 切回完整：恢复动态。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 10);
  assert.equal(dbg().presentationStatic, false, '恢复完整动效后呈现应回到动态');
});

test('注视弹簧平滑与门禁（同屏跟随、减少动效/跨屏回中）', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const dbg = () => harness.runtime.sample();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120); // 越过 wake，落到支持注视的 idle

  // 1) 完整动效 + 同屏：眼神朝注视方向收敛（弹簧补足 200ms 采样间隔）。
  harness.bridge.handlers.gaze({ x: 1, y: 0.5, near: true, sameDisplay: true });
  harness.frameBy(step, 90);
  assert.ok(dbg().gazeX > 0.9, `同屏注视应让眼神收敛到 ~1，实际 ${dbg().gazeX.toFixed(2)}`);
  assert.ok(dbg().gazeY > 0.4, `同屏注视应让眼神收敛到 ~0.5，实际 ${dbg().gazeY.toFixed(2)}`);

  // 2) 运行中切到减少动效，注视输入仍在：眼神应被门禁并衰减回中。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'reduced' });
  harness.bridge.handlers.gaze({ x: 1, y: 0.5, near: true, sameDisplay: true });
  harness.frameBy(step, 90);
  assert.ok(Math.abs(dbg().gazeX) < 0.1, '减少动效下注视应回到正中（静态）');

  // 3) 恢复完整动效，光标虽已远离但仍同屏：仍然跟随。主进程的 near 是
  // 吸附探头用的 120px 阈值，不是注视门禁；拿它当门禁就等于废掉鼠标跟随。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.bridge.handlers.gaze({ x: -1, y: -1, near: false, sameDisplay: true });
  harness.frameBy(step, 90);
  assert.ok(dbg().gazeX < -0.9, `同屏远处光标仍应跟随，实际 ${dbg().gazeX.toFixed(2)}`);
  assert.ok(dbg().gazeY < -0.9, `同屏远处光标纵向仍应跟随，实际 ${dbg().gazeY.toFixed(2)}`);

  // 4) 光标跨屏：即使输入方向非零，眼神也保持正中。
  harness.bridge.handlers.gaze({ x: 1, y: 1, near: false, sameDisplay: false });
  harness.frameBy(step, 90);
  assert.ok(Math.abs(dbg().gazeX) < 0.1, '跨屏时注视应回中');
});

test('左右镜像时生成眼睛的注视方向仍与屏幕光标一致', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const dbg = () => harness.runtime.sample(), step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);
  const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
  const firstEyeSources = new Set(Object.values(DANGO_RASTER.views).flatMap(view =>
    Object.values(view.face?.eyes || {}).map(pair => new URL(pair[0].src, DANGO_RASTER.baseUrl).pathname)));
  let bodyBlit = null, eyeMatrices = [];
  const ctx = harness.petContext;
  const clear = ctx.clearRect.bind(ctx), image = ctx.drawImage.bind(ctx);
  ctx.clearRect = (...args) => { bodyBlit = null; eyeMatrices = []; clear(...args); };
  ctx.drawImage = (surface, ...args) => {
    image(surface, ...args);
    const matrix = ctx._calls.at(-1).matrix;
    if (!surface.src) bodyBlit = { offX: args[0], matrix };
    else if (firstEyeSources.has(new URL(surface.src).pathname)) eyeMatrices.push(matrix);
  };
  const petHit = harness.document.getElementById('petHit');
  for (const facing of [-1, 1]) {
    petHit.dispatch('pointerdown', { isPrimary: true, button: 0, ctrlKey: false, pointerId: 1, screenX: 100, screenY: 100 });
    await settleInit(); harness.clockState.now += 100;
    petHit.dispatch('pointermove', { pointerId: 1, screenX: 100 + 40 * facing, screenY: 100 });
    petHit.dispatch('pointercancel', { pointerId: 1 });
    assert.equal(dbg().facing, facing);
    const local = {};
    for (const direction of [-1, 1]) {
      harness.bridge.handlers.gaze({ x: direction, y: 0, near: false, sameDisplay: true });
      harness.frameBy(step, 90);
      assert.ok(bodyBlit && eyeMatrices.length >= 1, 'the assertion observes the production eye bitmap transform');
      const body = bodyBlit.matrix, eye = eyeMatrices[0], det = body.a * body.d - body.b * body.c;
      local[direction] = (body.d * (eye.e - body.e) - body.c * (eye.f - body.f)) / det - bodyBlit.offX;
      assert.equal(Math.sign(body.a), facing);
      assert.ok(dbg().gazeX * direction > .9);
    }
    const visibleTravel = (local[1] - local[-1]) * facing;
    assert.ok(visibleTravel > 1 && visibleTravel < 7, `facing=${facing}, actual native eye travel=${visibleTravel}`);
  }
});

test('开发检验台打开时收起命令菜单，动作条目从点击时刻开始播放', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const dbg = () => harness.runtime.sample();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ devMode: true, stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);

  const petHit = harness.document.getElementById('petHit');
  petHit.dispatch('contextmenu', { preventDefault() {} });
  await settleInit();
  assert.equal(harness.document.getElementById('commandMenu').classList.contains('show'), true);

  harness.bridge.handlers.devtools({ open: true });
  const devPanel = harness.document.getElementById('devTools');
  assert.equal(devPanel.classList.contains('show'), true);
  assert.equal(harness.document.getElementById('commandMenu').classList.contains('show'), false);

  const actionButton = devButton(harness, 'action', 'wave');
  const profileButton = devButton(harness, 'view', 'profile');
  assert.equal(profileButton.textContent, '侧面 · profile');
  profileButton.dispatch('click');
  harness.frameBy(step, 1);
  assert.equal(dbg().renderedEyeMask, 'neutral', '点击侧面应切换到单眼侧脸渲染');
  const backButton = devButton(harness, 'view', 'back');
  backButton.dispatch('click');
  harness.frameBy(step, 1);
  assert.equal(dbg().renderedEyeMask, 'back', '点击背面应隐藏脸部');

  actionButton.dispatch('click');
  harness.frameBy(step, 1);
  assert.ok(dbg().actionProgress >= 0 && dbg().actionProgress < 0.05,
    `动作点击后应从第 0 帧开始，实际 ${dbg().actionProgress.toFixed(3)}`);
  assert.equal(dbg().expressionId, petContent.PET_ACTIONS.wave.expression);
  harness.frameBy(step, 60);
  assert.ok(dbg().actionProgress > 0.1, '动作应在点击后持续推进');
  actionButton.dispatch('click');
  harness.frameBy(step);
  assert.ok(dbg().actionProgress < 0.01, '重复点击同一动作应从头重播');
});

test('an in-flight menu expansion closes before a drag captures its native anchor', async () => {
  const pending = [], calls = [];
  let armed = false;
  const harness = createHarness({ bridgeOverrides: {
    pet_setMenuOpen: open => {
      if (!armed) return Promise.resolve(null);
      calls.push(open); return new Promise(resolve => pending.push(resolve));
    },
    pet_dragStart: async () => { calls.push('drag'); }
  } });
  await settleInit();
  armed = true;
  const hit = harness.document.getElementById('petHit');
  const menu = harness.document.getElementById('commandMenu');
  hit.dispatch('contextmenu', { preventDefault() {} });
  await settleInit();
  assert.deepEqual(calls, [true]);
  assert.equal(menu.classList.contains('show'), false, 'wait for native geometry before showing menu');
  harness.document.dispatch('keydown', { key: 'Escape' });
  hit.dispatch('pointerdown', { isPrimary: true, button: 0, pointerId: 2, screenX: 10, screenY: 10 });
  hit.dispatch('pointermove', { pointerId: 2, screenX: 40, screenY: 10 });
  pending.shift()({ width: 520, height: 360, stageOffset: { x: 30, y: -20 } });
  await settleInit();
  assert.deepEqual(calls, [true, false]);
  assert.equal(menu.classList.contains('show'), false, 'stale open must not reveal the menu');
  pending.shift()({ width: 220, height: 220, stageOffset: { x: 0, y: 0 } });
  await settleInit();
  assert.deepEqual(calls, [true, false, 'drag']);
  assert.equal(harness.document.getElementById('stage').classList.contains('menu-open'), false);
  hit.dispatch('pointercancel', { pointerId: 2 });
});

test('closing food during its native expansion cannot reopen it from a stale response', async () => {
  const pending = [], calls = [];
  let armed = false;
  const harness = createHarness({ bridgeOverrides: {
    pet_setMenuOpen: open => {
      if (!armed) return Promise.resolve(null);
      calls.push(open); return new Promise(resolve => pending.push(resolve));
    }
  } });
  await settleInit();
  armed = true;
  harness.document.getElementById('feedQuick').dispatch('click', { stopPropagation() {} });
  await settleInit();
  assert.deepEqual(calls, [true]);
  harness.document.dispatch('keydown', { key: 'Escape' });
  pending.shift()({ width: 520, height: 360 });
  await settleInit();
  assert.deepEqual(calls, [true, false]);
  pending.shift()({ width: 220, height: 220 });
  await settleInit();
  assert.equal(harness.document.getElementById('foodPanel').classList.contains('show'), false);
  assert.equal(harness.document.getElementById('stage').classList.contains('menu-open'), false);
});

test('长耳形态在四视图、专属配饰和动作相位下不越出画布，实时切换恢复团子兽', async () => {
  for (const devicePixelRatio of [1, 1.5, 2, 3]) {
    const harness = createHarness({ devicePixelRatio, deterministicRandom: true });
    await settleInit();
    const stage = resolveFormStage('usagi', devicePixelRatio);
    const root = harness.document.getElementById('stage');
    const hit = harness.document.getElementById('petHit');
    const canvas = harness.document.getElementById('petCanvas');
    harness.bridge.handlers.sync({
      skin: 'usagi', level: 25,
      appearanceItemIds: ['usagi.ear-bow', 'usagi.star-collar', 'usagi.travel-cape'],
      devMode: true, stimulationMode: 'high', motionMode: 'full'
    });
    assert.equal(root.dataset.petForm, 'usagi');
    assert.equal(canvas.style.imageRendering, 'auto');
    assert.ok(Number.parseFloat(hit.style.height) > 105, '耳尖必须可点');
    harness.bridge.handlers.devtools({ open: true });
    assert.equal(harness.document.getElementById('devSkin').value, 'usagi');
    for (const view of ['front', 'three-quarter', 'profile', 'back']) {
      devButton(harness, 'view', view).dispatch('click');
      harness.petContext._reset();
      harness.frameBy(1000 / 60 + 0.01, 1);
      assert.equal(harness.runtime.sample().renderedEyeMask, view === 'back' ? 'back' : 'neutral');
      const box = harness.petContext._box;
      assert.ok(box.minX >= 0 && box.minY >= 0
        && box.maxX <= stage.rasterWidth && box.maxY <= stage.rasterHeight,
      `usagi/${view}/dpr=${devicePixelRatio} cropped ${JSON.stringify(box)}`);
      assert.ok(harness.petContext._calls.some(call => call.source === 'Path2D' || call.source === 'bezierCurveTo'),
        'vector face / outfit should render on the desktop compositor');
    }
    for (const actionId of ['wave', 'read-book', 'dig-treasure']) {
      devButton(harness, 'action', actionId).dispatch('click');
      for (let frame = 0; frame < 12; frame += 1) {
        harness.petContext._reset();
        harness.frameBy(1000 / 30 + 0.01, 1);
        const box = harness.petContext._box;
        assert.ok(box.minX >= 0 && box.minY >= 0
          && box.maxX <= stage.rasterWidth && box.maxY <= stage.rasterHeight,
        `usagi/${actionId}/${frame}/dpr=${devicePixelRatio} cropped ${JSON.stringify(box)}`);
      }
    }
    devButton(harness, 'appearance', 'usagi.travel-cape').dispatch('click');
    assert.equal(root.dataset.petForm, 'usagi');
    harness.bridge.handlers.sync({ skin: 'pink', appearanceItemIds: [] });
    // The preview is independent of persistence; close it to observe the switch.
    harness.document.getElementById('devTools').querySelector('[data-dev-action="close"]').dispatch('click');
    assert.equal(root.dataset.petForm, 'dango');
    assert.equal(hit.style.height, '105px');
    assert.equal(canvas.style.imageRendering, 'auto');
  }
});

test('单件长耳配饰在团子兽开发预览时也使用自己的形态', async () => {
  const harness = createHarness();
  await settleInit();
  harness.bridge.handlers.sync({ skin: 'pink', devMode: true });
  harness.bridge.handlers.devtools({ open: true });
  devButton(harness, 'appearance', 'usagi.travel-cape').dispatch('click');
  assert.equal(harness.document.getElementById('stage').dataset.petForm, 'usagi');
  harness.frameBy(1000 / 60 + 0.01);
  assert.ok(harness.petContext._calls.some(call => call.source === 'Path2D' || call.source === 'bezierCurveTo'));
});

test('开发检验台不与已打开或仍在加载的喂食面板重叠', async () => {
  for (const pending of [false, true]) {
    let resolveFeed;
    const feedState = { satiation: 60, foodInventory: {}, totalFeeds: 0, basicMeal: { remaining: 3, eligible: false } };
    const harness = createHarness({
      initialState: { devMode: true },
      bridgeOverrides: {
        pet_getFeedState: () => pending
          ? new Promise(resolve => { resolveFeed = resolve; }) : Promise.resolve(feedState)
      }
    });
    await settleInit();
    harness.document.getElementById('feedQuick').dispatch('click', { stopPropagation() {} });
    if (!pending) {
      await settleInit();
      assert.equal(harness.document.getElementById('foodPanel').classList.contains('show'), true);
    }
    harness.bridge.handlers.devtools({ open: true });
    if (pending) resolveFeed(feedState);
    await settleInit();
    assert.equal(harness.document.getElementById('devTools').classList.contains('show'), true);
    assert.equal(harness.document.getElementById('foodPanel').classList.contains('show'), false);
  }
});

test('preload 只暴露只读注视监听，不暴露发送能力', () => {
  const preload = require('node:fs').readFileSync(path.join(ROOT, 'src', 'preload-pet.js'), 'utf8');
  let bridge;
  const subscriptions = new Map();
  require('node:vm').runInNewContext(preload, { require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on: (channel, listener) => subscriptions.set(channel, listener),
        removeListener: channel => subscriptions.delete(channel) } };
  } });
  const seen = [];
  const unsubscribe = bridge.onPetGaze(value => seen.push(value));
  assert.deepEqual([...subscriptions.keys()], ['pet:gaze']);
  subscriptions.get('pet:gaze')({ sender: 'must not leak' }, { x: 1 });
  assert.deepEqual(seen, [{ x: 1 }]);
  unsubscribe();
  assert.equal(subscriptions.size, 0);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|sendSync)\(/, 'preload 不得暴露 ipcRenderer.send');
});

test('注视输入被钳制到 [-1,1]，非法值归零', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const dbg = () => harness.runtime.sample();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);

  // 越界输入被钳到 [-1,1]
  harness.bridge.handlers.gaze({ x: 5, y: -3, near: true, sameDisplay: true });
  assert.equal(dbg().gazeInput.x, 1, 'gaze.x 应钳到 1');
  assert.equal(dbg().gazeInput.y, -1, 'gaze.y 应钳到 -1');

  // NaN / 缺失值归零，不产生非有限偏移
  harness.bridge.handlers.gaze({ x: Number.NaN, y: undefined, sameDisplay: true });
  assert.equal(dbg().gazeInput.x, 0, 'NaN 注视应归零');
  assert.equal(dbg().gazeInput.y, 0, '缺失注视应归零');
});

test('注视不落库、不记录、无轨迹历史', () => {
  const fs = require('node:fs');
  const petSrc = fs.readFileSync(path.join(ROOT, 'src/surfaces/pet/sync.mjs'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  // 渲染器只持有单帧注视快照（冻结对象），不存在注视历史数组/日志。
  assert.doesNotMatch(petSrc, /gazeHistory|gazeTrail|gazeLog|gaze[A-Za-z]*\.push\(/,
    '渲染器不得维护注视历史/轨迹');
  // 主进程不把注视写入 store 或日志。
  assert.doesNotMatch(mainSrc, /store\.set\([^)]*gaze|console\.[a-z]+\([^)]*gaze|gaze[A-Za-z]*\.push\(/,
    '主进程不得持久化或记录注视');
  // 注视只经只读推送进入渲染器。
  assert.match(mainSrc, /petWindow\.send\('pet:gaze'/, '注视应是 main→renderer 只读推送');
  assert.doesNotMatch(mainSrc, /registerIpc\('pet:gaze'/, '注视不得成为可被渲染器调用的 IPC');
});

test('按压进行中切到静态，压缩形变立即归零（不残留）', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  const dscale = resolvePetStage({ devicePixelRatio: 2 }).deviceScale;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'pink' });
  harness.frameBy(step, 120);

  // 按下（未达拖动阈值）：onPressChange(true) 把压缩弹簧目标置 1。
  harness.document._resolve('#petHit').dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 1, screenX: 100, screenY: 100
  });
  harness.frameBy(step, 60); // 让压缩发展到接近满

  // 保持按压的同时切到减少动效：必须立刻归静态，压缩不得残留。
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'reduced' });
  harness.petContext._reset();
  harness.frameBy(step, 10);

  const blits = harness.petContext._calls.filter(c => c.source === 'drawImage');
  assert.ok(blits.length > 0, '静态下仍应有身体贴图');
  for (const blit of blits) {
    assert.ok(Math.abs(blit.matrix.a - blit.matrix.d) < 1e-3,
      `静态 attentive pose 不应残留按压造成的非等比形变，a=${blit.matrix.a.toFixed(4)}, d=${blit.matrix.d.toFixed(4)}`);
    assert.ok(Math.abs(blit.matrix.a - dscale * 1.04) < 1e-3,
      `静态 attentive pose 应保留注册表位姿，a=${blit.matrix.a.toFixed(4)}`);
  }
});

test('低刺激按下仍给出静态 attentive 反馈', async () => {
  const harness = createHarness({
    deterministicRandom: true,
    initialState: { stimulationMode: 'low', motionMode: 'full' }
  });
  await settleInit();
  harness.frameBy(200, 10);
  const hit = harness.document._resolve('#petHit');
  hit.dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 6, screenX: 100, screenY: 100
  });
  harness.frameBy(200, 1);
  const pressed = harness.runtime.sample();
  assert.equal(pressed.expressionId, 'life.attentive');
  assert.equal(pressed.presentationSource, 'interaction');
  assert.equal(pressed.presentationStatic, true);
  hit.dispatch('pointercancel', { pointerId: 6 });
});

test('长按表情保持到释放，且 DND 不抑制主动互动', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { dnd: true } });
  await settleInit();
  const hit = harness.document._resolve('#petHit');
  const step = 1000 / 60 + 0.01;
  harness.frameBy(step, 120);

  hit.dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 7, screenX: 100, screenY: 100
  });
  assert.equal(harness.fireTimeoutByDelay(550), true, '550ms 长按计时器必须存在');
  harness.frameBy(step, 2);
  assert.equal(harness.runtime.sample().expressionId, 'react.petted');
  assert.equal(harness.runtime.sample().presentationSource, 'interaction');
  assert.equal(harness.runtime.sample().presentationMinHoldMs, 300,
    '按住生命周期不能伪装成十分钟 minHold');

  // 即使动画时间超过旧的 2200ms，只要还按住就必须保持 petted。
  harness.frameBy(step, 180);
  assert.equal(harness.runtime.sample().expressionId, 'react.petted');

  hit.dispatch('pointerup', { pointerId: 7, screenX: 100, screenY: 100 });
  harness.frameBy(step, 2);
  assert.notEqual(harness.runtime.sample().expressionId, 'react.petted');
  assert.equal(harness.runtime.sample().presentationSource, 'interaction',
    '释放后仍在播放的手动动作必须保持 interaction 来源');
});

test('会话轮换只随单调动画时钟推进，不受系统校时跳变影响', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { state: 'focused' } });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 120);

  const before = harness.runtime.sample();

  // NTP / 手工校时会让 Date 突然跨很远；会话轮换不能因此跳段。
  harness.clockState.now += 24 * 60 * 60 * 1000;
  harness.frameBy(step, 1);
  const afterForwardJump = harness.runtime.sample();
  assert.equal(afterForwardJump.sessionActivityId, before.sessionActivityId);

  harness.clockState.now -= 48 * 60 * 60 * 1000;
  harness.frameBy(step, 1);
  const afterBackwardJump = harness.runtime.sample();
  assert.equal(afterBackwardJump.sessionActivityId, before.sessionActivityId);
});

test('会话入口活动随墙钟分钟轮转，不被从 0 起算的动画时钟钉在首项', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 30);

  // 刚启动就开始专注（animNow 还不到一分钟）也不能每次都从同一个活动进入。
  harness.bridge.handlers.sync({ baseState: 'focused' });
  harness.frameBy(step, 2);
  const firstEntry = harness.runtime.sample().sessionActivityId;
  assert.ok(firstEntry, '专注态必须有会话活动');

  harness.bridge.handlers.sync({ baseState: 'idle' });
  harness.frameBy(step, 2);
  harness.clockState.now += 60_000;
  harness.bridge.handlers.sync({ baseState: 'focused' });
  harness.frameBy(step, 2);
  const secondEntry = harness.runtime.sample().sessionActivityId;
  assert.notEqual(secondEntry, firstEntry,
    '下一个墙钟分钟开始的会话必须从另一个活动进入');
});

test('动作相位与完成只随单调动画时钟推进，不受系统校时跳变影响', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 120);

  const cue = BUILT_IN_MANIFEST.cues.find(item => item.id === 'egg.workout');
  const played = harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
  assert.equal(played.ok, true);
  harness.frameBy(step, 30);
  const before = harness.runtime.sample();
  assert.ok(before.actionProgress > 0 && before.actionProgress < 0.2);

  harness.clockState.now += 24 * 60 * 60 * 1000;
  harness.frameBy(step, 1);
  const afterForwardJump = harness.runtime.sample();
  assert.equal(afterForwardJump.eggActive, true);
  assert.ok(afterForwardJump.actionProgress > before.actionProgress);
  assert.ok(afterForwardJump.actionProgress - before.actionProgress < 0.01);

  harness.clockState.now -= 48 * 60 * 60 * 1000;
  harness.frameBy(step, 1);
  const afterBackwardJump = harness.runtime.sample();
  assert.equal(afterBackwardJump.eggActive, true);
  assert.ok(afterBackwardJump.actionProgress >= afterForwardJump.actionProgress,
    '墙钟回退不能让动作倒放');
});

test('跨屏旧注视不阻断拖动方向，放下反馈在 DND 下仍可达', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { dnd: true } });
  await settleInit();
  const hit = harness.document._resolve('#petHit');
  const step = 1000 / 60 + 0.01;
  harness.frameBy(step, 120);
  harness.bridge.handlers.gaze({ x: -1, y: 0, near: false, sameDisplay: false });

  hit.dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 8, screenX: 100, screenY: 100
  });
  harness.clockState.now += 100;
  hit.dispatch('pointermove', { pointerId: 8, screenX: 120, screenY: 100 });
  await settleInit();
  harness.clockState.now += 100;
  // Continue at 0.2 px/ms, so the gaze remains visibly directed while dragging.
  hit.dispatch('pointermove', { pointerId: 8, screenX: 140, screenY: 100 });
  harness.frameBy(step, 30);
  let sample = harness.runtime.sample();
  assert.equal(sample.state, 'dragged');
  assert.equal(sample.expressionId, 'react.surprised');
  assert.ok(sample.gazeX > 0.05, '拖动方向注视不能依赖拖动前的 sameDisplay');

  hit.dispatch('pointerup', { pointerId: 8, screenX: 140, screenY: 100 });
  harness.frameBy(step, 2);
  sample = harness.runtime.sample();
  assert.equal(sample.state, 'idle', '放下必须同步离开 dragged 状态');
  assert.equal(sample.expressionId, 'react.satisfied', 'DND 不能吞掉用户主动放下反馈');
});

test('快速甩动同步退出 dragged，手动动作在 DND 下仍是互动来源', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { dnd: true } });
  await settleInit();
  const hit = harness.document._resolve('#petHit');
  const step = 1000 / 60 + 0.01;
  harness.frameBy(step, 120);

  hit.dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 9, screenX: 10, screenY: 10
  });
  hit.dispatch('pointermove', { pointerId: 9, screenX: 30, screenY: 10 });
  await settleInit();
  harness.clockState.now += 1;
  hit.dispatch('pointermove', { pointerId: 9, screenX: 90, screenY: 10 });
  hit.dispatch('pointerup', { pointerId: 9, screenX: 90, screenY: 10 });
  harness.frameBy(step, 2);

  const sample = harness.runtime.sample();
  assert.equal(sample.state, 'idle', 'fling 分支不能把状态遗留为 dragged');
  assert.equal(sample.eggActive, true, 'fling 应继续播放原有 7 秒动作');
  assert.equal(sample.actionId, 'spin');
  assert.equal(sample.presentationSource, 'interaction', '手动 fling 不能被误标成自主 cue');

  // 低刺激只冻结用户主动动作，不得把反馈身份整个抹掉。
  harness.bridge.handlers.sync({ stimulationMode: 'low' });
  harness.frameBy(200, 2);
  const calm = harness.runtime.sample();
  assert.equal(calm.actionId, 'spin');
  assert.equal(calm.presentationSource, 'interaction');
  assert.equal(calm.presentationStatic, true);
  assert.equal(calm.actionProgress, 0.5, '低刺激下动作细节也必须冻结在静态采样点');
});

test('更高优先级 presentation 阻止在途自主 cue 覆盖用户动作', async () => {
  const acknowledgements = [];
  const harness = createHarness({
    deterministicRandom: true,
    bridgeOverrides: {
      pet_ackCue: ack => { acknowledgements.push(ack); return Promise.resolve(null); }
    }
  });
  await settleInit();
  const hit = harness.document._resolve('#petHit');
  const step = 1000 / 60 + 0.01;
  harness.frameBy(step, 120);

  hit.dispatch('pointerdown', {
    isPrimary: true, button: 0, ctrlKey: false, pointerId: 10, screenX: 10, screenY: 10
  });
  hit.dispatch('pointermove', { pointerId: 10, screenX: 30, screenY: 10 });
  await settleInit();
  harness.clockState.now += 1;
  hit.dispatch('pointermove', { pointerId: 10, screenX: 90, screenY: 10 });
  hit.dispatch('pointerup', { pointerId: 10, screenX: 90, screenY: 10 });
  harness.frameBy(step, 2);
  assert.equal(harness.runtime.sample().actionId, 'spin');

  const cue = BUILT_IN_MANIFEST.cues[0];
  const result = harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'presentation-priority');
  assert.equal(harness.runtime.sample().actionId, 'spin',
    '被拒绝的 autonomous cue 不得覆盖手动 action body');
  assert.equal(acknowledgements.at(-1).status, 'rejected');
});

test('DND 下成功喂食仍展示用户请求的三段反馈', async () => {
  const feedState = {
    satiation: 60,
    foodInventory: { fish: 1 },
    foodTickets: 6,
    basicMeal: { remaining: 3, eligible: false },
    totalFeeds: 0
  };
  const harness = createHarness({
    deterministicRandom: true,
    initialState: { dnd: true },
    bridgeOverrides: {
      pet_getFeedState: () => Promise.resolve(feedState),
      pet_feed: () => Promise.resolve({ ok: true, gainedXp: 0, reaction: '好吃！', animation: null })
    }
  });
  await settleInit();
  harness.frameBy(1000 / 60 + 0.01, 120);

  harness.document._resolve('#feedQuick').dispatch('click', { stopPropagation() {} });
  await settleInit();
  const fish = harness.document._resolve('#foodList').children.find(item => item.dataset.food === 'fish');
  assert.ok(fish && !fish.disabled, '测试食物应可点击');
  fish.dispatch('click', { stopPropagation() {} });
  await settleInit();
  harness.frameBy(1000 / 60 + 0.01, 2);

  const sample = harness.runtime.sample();
  assert.equal(sample.expressionId, 'react.surprised', 'DND 不应抑制主动喂食的 anticipate 阶段');
  assert.equal(sample.presentationSource, 'interaction');
});

test('喂食三阶段按动画时钟顺序完成，庆祝只在满足之后接管', async () => {
  const feedState = {
    satiation: 60,
    foodInventory: { fish: 1 },
    foodTickets: 6,
    basicMeal: { remaining: 3, eligible: false },
    totalFeeds: 0
  };
  const harness = createHarness({
    deterministicRandom: true,
    bridgeOverrides: {
      pet_getFeedState: () => Promise.resolve(feedState),
      pet_feed: () => Promise.resolve({
        ok: true, gainedXp: 0, reaction: '好吃！', animation: 'happy'
      })
    }
  });
  await settleInit();
  const step = 100;
  harness.frameBy(step, 20);
  harness.document._resolve('#feedQuick').dispatch('click', { stopPropagation() {} });
  await settleInit();
  const fish = harness.document._resolve('#foodList').children.find(item => item.dataset.food === 'fish');
  fish.dispatch('click', { stopPropagation() {} });
  await settleInit();

  harness.frameBy(step, 1);
  assert.equal(harness.runtime.sample().expressionId, 'react.surprised');
  harness.frameBy(step, 4);
  assert.equal(harness.runtime.sample().expressionId, 'react.hungry');
  harness.frameBy(step, 8);
  assert.equal(harness.runtime.sample().expressionId, 'react.satisfied');
  assert.notEqual(harness.runtime.sample().state, 'celebrating',
    '庆祝不能抢占尚未完成的喂食三阶段');
  harness.frameBy(step, 22);
  const completed = harness.runtime.sample();
  assert.equal(completed.state, 'celebrating');
  assert.equal(completed.expressionId, 'react.celebrate');
  assert.equal(completed.presentationSource, 'interaction', '喂食庆祝属于用户互动而非必要系统反馈');
});

test('Reduce Motion 的 cue 保留静态 action 身份与静态身体位姿', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 200;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'reduced', paused: true });
  harness.petContext._reset();
  harness.frameBy(step, 2);
  const pauseBlit = harness.petContext._calls.find(call => call.source === 'drawImage');
  assert.ok(pauseBlit, '静态 pause 仍应绘制身体');
  assert.ok(pauseBlit.matrix.d < resolvePetStage({ devicePixelRatio: 2 }).deviceScale,
    'work.pause 的静态 scaleY 应作用于身体，不能只换脸');

  harness.bridge.handlers.sync({ paused: false, baseState: 'idle' });
  const cue = BUILT_IN_MANIFEST.cues[0];
  const envelope = cueEnvelope(cue, harness.clockState.now + 1);
  envelope.variant = cue.variants.find(item => item.static).id;
  harness.bridge.handlers.cue(envelope);
  harness.frameBy(step, 2);
  const sample = harness.runtime.sample();
  assert.equal(sample.eggActive, true, '静态 variant 也必须保留 action playback 身份');
  assert.notEqual(sample.expressionId, 'life.idle', '静态 variant 不能丢失 cue 对应表情');
  assert.equal(sample.presentationStatic, true);
});

test('锁屏停止 ticker、清空装饰粒子，解锁首帧重新锚定', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full', skin: 'sakura' });
  harness.frameBy(step, 120);
  const before = harness.runtime.sample();
  assert.ok(before.petalCount > 0, '锁屏前应确有装饰粒子在运行');

  harness.bridge.handlers.sync({ screenLocked: true });
  harness.frameBy(1000, 10);
  let locked = harness.runtime.sample();
  assert.equal(locked.animNow, before.animNow);
  assert.equal(locked.petalCount, 0);
  assert.equal(locked.sceneParticleCount, 0);
  assert.equal(locked.overlayParticleCount, 0);

  harness.bridge.handlers.sync({ screenLocked: false });
  harness.frameBy(step, 1);
  locked = harness.runtime.sample();
  assert.equal(locked.animNow, before.animNow, '解锁首帧只重新锚定');
  harness.frameBy(step, 1);
  assert.ok(harness.runtime.sample().animNow > before.animNow);
});

test('隐藏期间取消短暂 presentation，恢复时不补播会话边沿', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { state: 'focused' } });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  harness.frameBy(step, 2);
  assert.equal(harness.runtime.sample().expressionId, 'work.starting');

  harness.document.hidden = true;
  harness.document.dispatch('visibilitychange');
  harness.bridge.handlers.sync({ paused: true, baseState: 'idle' });
  harness.bridge.handlers.sync({ paused: false, baseState: 'focused' });
  harness.frameBy(1000, 5);

  harness.document.hidden = false;
  harness.document.dispatch('visibilitychange');
  harness.frameBy(step, 2);
  assert.equal(
    harness.runtime.sample().expressionId,
    harness.runtime.sample().sessionActivityExpression,
    '后台发生的 pause/resume/starting 边沿不得在恢复后补播');
});

test('12 个会话动作轮换时都直接呈现各自的正式 expression', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 1000 / 60 + 0.01;
  const seen = new Set();

  for (const baseState of ['focused', 'resting']) {
    harness.bridge.handlers.sync({ baseState, stimulationMode: 'high', motionMode: 'full' });
    harness.frameBy(step, 120);
    for (let index = 0; index < 6; index++) {
      const sample = harness.runtime.sample();
      assert.equal(sample.expressionId, sample.sessionActivityExpression,
        `${sample.sessionActivityId} 未呈现自身 expression`);
      seen.add(sample.sessionActivityId);
      harness.document._resolve('#activityNext').dispatch('click', { stopPropagation() {} });
      harness.frameBy(step, 2);
    }
  }

  assert.equal(seen.size, 12, 'focused/resting 的 12 个动作都必须进入 renderer');
});

test('主进程结构化事实进入同一 Director，DND 下必要反馈仍可见', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  const step = 100;
  harness.bridge.handlers.sync({ stimulationMode: 'high', motionMode: 'full' });
  harness.frameBy(step, 20);

  harness.bridge.handlers.sync({
    presentation: {
      eventId: 'fact.ai.processing.1',
      expressionId: 'system.processing',
      source: 'interaction',
      ttlMs: 2000,
      minHoldMs: 300
    }
  });
  harness.frameBy(step, 1);
  let sample = harness.runtime.sample();
  assert.equal(sample.expressionId, 'system.processing');
  assert.equal(sample.presentationEventId, 'fact.ai.processing.1');
  assert.equal(sample.presentationSource, 'interaction');

  // 同 eventId 重放不能重启或延长 TTL。
  harness.frameBy(step, 10);
  harness.bridge.handlers.sync({
    presentation: {
      eventId: 'fact.ai.processing.1',
      expressionId: 'system.processing',
      source: 'interaction',
      ttlMs: 2000,
      minHoldMs: 300
    }
  });
  harness.frameBy(step, 11);
  sample = harness.runtime.sample();
  assert.notEqual(sample.presentationEventId, 'fact.ai.processing.1',
    '重复投递不得把已经到期的事实重新播放');

  harness.bridge.handlers.sync({
    dnd: true,
    presentation: {
      eventId: 'fact.proposal.waiting.1',
      expressionId: 'work.waiting',
      source: 'essential',
      ttlMs: 1600,
      minHoldMs: 500
    }
  });
  harness.frameBy(step, 1);
  sample = harness.runtime.sample();
  assert.equal(sample.expressionId, 'work.waiting');
  assert.equal(sample.presentationSource, 'essential');

  harness.bridge.handlers.sync({
    presentation: {
      eventId: 'fact.invalid.1',
      expressionId: 'system.not-real',
      source: 'essential',
      ttlMs: 1000
    }
  });
  harness.frameBy(step, 1);
  assert.equal(harness.runtime.sample().expressionId, 'work.waiting',
    '未知 expression 必须被拒绝，不能覆盖当前事实');

  harness.bridge.handlers.sync({
    presentation: {
      eventId: 'fact.proposal.waiting.1',
      cancel: true,
      reason: 'proposal-dismissed'
    }
  });
  harness.frameBy(step, 1);
  sample = harness.runtime.sample();
  assert.notEqual(sample.expressionId, 'work.waiting',
    'proposal 关闭后必须立刻撤销等待表达');
  assert.equal(sample.presentationEventId, null);
});

test('Director 覆盖睡眠 base 时，旧 state 不得强制覆盖活动脸', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
  harness.frameBy(200, 10);
  const sleepAt = new Date(harness.clockState.now);
  sleepAt.setDate(sleepAt.getDate() + 1);
  sleepAt.setHours(2, 0, 0, 0);
  harness.clockState.now = sleepAt.getTime();
  for (const interval of harness.timers.intervals) interval();
  harness.bridge.handlers.sync({ motionMode: 'reduced' });
  harness.frameBy(200, 2);
  assert.equal(harness.runtime.sample().expressionId, 'life.sleep');

  const cue = BUILT_IN_MANIFEST.cues[0];
  const result = harness.bridge.handlers.cue(cueEnvelope(cue, harness.clockState.now + 1));
  assert.equal(result.ok, true);
  harness.frameBy(200, 2);
  const sample = harness.runtime.sample();
  assert.equal(sample.expressionId, 'work.ready');
  assert.equal(sample.renderedEyeMask, 'determined',
    '活动 presentation 的眼形不能被旧 sleeping state 强制闭合');
});

test('main 锁屏事实参与 Surprise 门禁，且门禁态不会读取全局光标', () => {
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(mainSrc, /petRuntime\.visible\s*&&\s*!petScreenLocked/,
    '锁屏必须让 Surprise context 视为不可见');
  assert.match(mainSrc, /pointerBlocked[\s\S]*?if \(pointerBlocked\)[\s\S]*?return;[\s\S]*?screenHost\.cursorPoint\(\)/,
    '锁屏/菜单/隐藏门禁必须发生在读取全局光标之前');
  const { projectPetState } = require('../src/application');
  const context = projectPetState({ snapshot: { level: 1, unlockedSkins: ['pink'], currentSkin: 'pink',
    pet: {}, companion: {} }, settings: {}, pomodoro: { paused: true, running: false },
    energyEstimate: { level: 50 }, workStart: 10, workEnd: 21 },
  { skins: { pink: { theme: {} } }, appearanceItems: [], contextRevision: 2 });
  assert.equal(context.paused, true, 'pure pet query carries the sampled authoritative pause fact');
  assert.equal(context.state, 'idle');
  assert.equal(context.contextRevision, 2);
});

test('脚下的进度环：主进程给锚点，桌宠页自己推算；同一个锚点不重启动画，变了才重启，null 就收起', async () => {
  const harness = createHarness();
  await settleInit();
  const stage = harness.document.getElementById('stage');
  const arc = harness.document.querySelector('#focusRing .ring-arc');
  const vars = {};
  const animationWrites = [];
  arc.style = {
    setProperty: (name, value) => { vars[name] = value; },
    set animation(value) { animationWrites.push(value); },
    get animation() { return ''; }
  };
  const sync = harness.bridge.handlers.sync;
  const MIN = 60_000;

  sync({ focusRing: { mode: 'focus', sessionId: 's1', plannedMs: 25 * MIN, elapsedMs: 3 * MIN, running: true } });
  assert.equal(stage.dataset.ring, 'focus');
  assert.equal(vars['--ring-total'], `${25 * MIN}ms`);
  assert.equal(vars['--ring-delay'], `${-3 * MIN}ms`, '负的延迟 = 已经走了多少');
  assert.equal(vars['--ring-state'], 'running');
  assert.equal(vars['--ring-steps'], '50', '降低动效时每 30 秒一格：25 分钟 = 50 格');
  assert.deepEqual(animationWrites, ['none', ''], '设置锚点时重启一次动画');

  // 主进程因为别的原因（统计变了）又推了一次上下文：锚点只差半秒，环不该抖一下。
  sync({ focusRing: { mode: 'focus', sessionId: 's1', plannedMs: 25 * MIN, elapsedMs: 3 * MIN + 500, running: true } });
  assert.deepEqual(animationWrites, ['none', ''], '同一个锚点不重启动画');

  // 真的对不上了（例如中途调整了时长，或本机睡眠后校正）：重新对齐。
  sync({ focusRing: { mode: 'focus', sessionId: 's1', plannedMs: 25 * MIN, elapsedMs: 10 * MIN, running: true } });
  assert.deepEqual(animationWrites, ['none', '', 'none', '']);
  assert.equal(vars['--ring-delay'], `${-10 * MIN}ms`);

  // 暂停：环停在原地，不假装还在前进。
  sync({ focusRing: { mode: 'focus', sessionId: 's1', plannedMs: 25 * MIN, elapsedMs: 10 * MIN, running: false } });
  assert.equal(vars['--ring-state'], 'paused');

  // 休息换成另一种颜色；会话结束（null）环收起，也不留着旧的锚点。
  sync({ focusRing: { mode: 'break', sessionId: 'b1', plannedMs: 5 * MIN, elapsedMs: 0, running: true } });
  assert.equal(stage.dataset.ring, 'break');
  sync({ focusRing: null });
  assert.equal(stage.dataset.ring, undefined);
  sync({ focusRing: { mode: 'focus', sessionId: 'x', plannedMs: 0, elapsedMs: 0, running: true } });
  assert.equal(stage.dataset.ring, undefined, '长度为 0 的会话不画环');
});

test('脚下的进度环的页面接线：环在宠物层里跟着宠物走，动画只由变量驱动，吸附时藏起来', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/pet.html'), 'utf8');
  assert.match(html, /<div class="pet-layer" id="petLayer">\s*<!--[^>]*-->\s*<div class="focus-ring" id="focusRing" aria-hidden="true">/, '环在 .pet-layer 里面，吸附与拖动时跟着走');
  assert.match(html, /\.stage\.is-docked \.focus-ring \{ opacity: 0; \}/);
  assert.match(html, /body\[data-motion="reduced"\] \.focus-ring \.ring-arc \{ animation-timing-function: steps\(var\(--ring-steps, 1\), end\); \}/);
  assert.match(html, /animation-duration: var\(--ring-total, 1s\); animation-delay: var\(--ring-delay, 0s\);/);
  assert.doesNotMatch(html, /focus-ring[^{]*\{[^}]*(?:pointer-events:\s*auto|cursor)/, '环不拦截点击');
});

test('reviewed Usagi click milestones use the real pointer/controller mapping and fireworks', async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { skin: 'usagi' } });
  await settleInit(); harness.frameBy(20, 1);
  const hit = harness.document._resolve('#petHit');
  const event = { isPrimary: true, button: 0, ctrlKey: false, pointerId: 27, screenX: 100, screenY: 100 };
  for (let count = 1; count <= 30; count += 1) {
    hit.dispatch('pointerdown', event); hit.dispatch('pointerup', event);
    if (count === 2) assert.equal(harness.runtime.sample().actionId, 'look-around');
    if (count === 20) {
      assert.equal(harness.runtime.sample().actionId, 'spin');
      assert.equal(harness.runtime.sample().overlayParticleCount, 0, 'Usagi contextual action owns the restrained radial fireworks');
    }
  }
  assert.equal(harness.runtime.sample().actionId, 'magic-trick');
  harness.frameBy(20, 10);
  assert.equal(harness.runtime.sample().expressionId, 'react.happy');
  harness.frameBy(50, 180);
  assert.equal(harness.runtime.sample().actionId, 'magic-trick');
  harness.frameBy(50, 25);
  assert.equal(harness.runtime.sample().actionId, null);
  harness.runtime.stop();
});

test('reviewed Usagi long press stays engaged at 6.6s and completes after release without a phantom click', async () => {
  for (const calm of [false, true]) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin: 'usagi',
      stimulationMode: calm ? 'low' : 'high', motionMode: calm ? 'reduced' : 'full' } });
    await settleInit(); harness.frameBy(20, 1);
    const hit = harness.document._resolve('#petHit');
    const event = { isPrimary: true, button: 0, ctrlKey: false, pointerId: 28, screenX: 100, screenY: 100 };
    hit.dispatch('pointerdown', event); assert.equal(harness.fireTimeoutByDelay(550), true);
    assert.equal(harness.runtime.sample().actionId, 'tail-wiggle');
    assert.equal(harness.runtime.sample().overlayParticleCount, calm ? 0 : 5);
    harness.frameBy(50, 132);
    assert.equal(harness.runtime.sample().expressionId, 'react.petted');
    assert.equal(harness.runtime.sample().presentationStatic, calm);
    hit.dispatch('pointerup', event); harness.frameBy(20, 2);
    assert.equal(harness.runtime.sample().actionId, 'tail-wiggle');
    assert.equal(harness.runtime.sample().expressionId, 'react.petted');
    harness.frameBy(50, 15);
    assert.equal(harness.runtime.sample().actionId, null, JSON.stringify({ calm, sample: harness.runtime.sample() }));
    harness.runtime.stop();
  }
});

test('activity mirror actual controller keeps declared poses, faces, loops and repeated sync stable for both forms', async () => {
  for (const skin of ['pink', 'usagi']) {
    const interactions = [];
    const harness = createHarness({ deterministicRandom: true, initialState: { skin },
      bridgeOverrides: { pet_interaction: value => { interactions.push(value); return Promise.resolve(null); } } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(50, count);
    try {
      frame(40);
      for (const category of ['music', 'coding', 'ai']) {
        const activity = petContent.MIRROR_ACTIVITIES[`mirror-${category}`];
        harness.bridge.handlers.sync({ activityMirror: category }); frame(3);
        assert.equal(harness.runtime.sample().sessionActivityId, activity.id, `${skin}/${category}`);
        assert.equal(harness.runtime.sample().expressionId, activity.expression, `${skin}/${category} declared face`);
        assert.equal(harness.runtime.sample().presentationSource, 'base', 'mirror cannot preempt manual feedback');
        assert.equal(harness.document._resolve('#activityLabel').textContent, `${activity.icon} ${activity.label}`);
        frame(25);
        const progress = harness.runtime.sample().actionProgress;
        harness.bridge.handlers.sync({ activityMirror: category }); frame();
        assert.ok(harness.runtime.sample().actionProgress > progress, 'same category refresh does not restart the pose');
        frame(Math.ceil(activity.durationMs / 50));
        assert.equal(harness.runtime.sample().sessionActivityId, activity.id, 'complete loop keeps semantic identity');
      }
      harness.bridge.handlers.sync({ activityMirror: null }); frame(3);
      assert.equal(harness.runtime.sample().sessionActivityId, null);
      assert.equal(harness.runtime.sample().expressionId, 'life.idle');
      harness.bridge.handlers.sync({ activityMirror: '__proto__' }); frame(3);
      assert.equal(harness.runtime.sample().sessionActivityId, null);
      assert.equal(harness.document._resolve('#activityLabel').textContent, '');
      assert.deepEqual(interactions, [], 'mirroring sends no interaction reward command');
    } finally { harness.runtime.stop(); }
  }
});

test('activity mirror actual controller yields to focus, rest, pause, and resumes only the latest category', async () => {
  const harness = createHarness({ deterministicRandom: true });
  await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
  const frame = (count = 1) => harness.frameBy(50, count);
  try {
    frame(40); harness.bridge.handlers.sync({ activityMirror: 'music' }); frame(2);
    harness.bridge.handlers.sync({ baseState: 'focused', activityMirror: 'ai' }); frame(40);
    assert.match(harness.runtime.sample().sessionActivityId, /^focus-/);
    assert.equal(harness.runtime.sample().expressionId, harness.runtime.sample().sessionActivityExpression);
    harness.bridge.handlers.sync({ activityMirror: 'coding' }); frame(2);
    assert.match(harness.runtime.sample().sessionActivityId, /^focus-/);
    harness.bridge.handlers.sync({ baseState: 'resting', activityMirror: 'music' }); frame(40);
    assert.match(harness.runtime.sample().sessionActivityId, /^rest-/);
    harness.bridge.handlers.sync({ baseState: 'idle', paused: true }); frame(40);
    assert.equal(harness.runtime.sample().expressionId, 'work.pause');
    harness.bridge.handlers.sync({ baseState: 'idle', paused: false, activityMirror: 'ai' }); frame(40);
    assert.equal(harness.runtime.sample().sessionActivityId, 'mirror-ai');
    assert.equal(harness.runtime.sample().expressionId, 'life.attentive');
    harness.bridge.handlers.sync({ baseState: 'focused', activityMirror: null }); frame(40);
    assert.match(harness.runtime.sample().sessionActivityId, /^focus-/);
    harness.bridge.handlers.sync({ baseState: 'idle' }); frame(40);
    assert.equal(harness.runtime.sample().sessionActivityId, null, 'off during focus stays off on return');
  } finally { harness.runtime.stop(); }
});

test('activity mirror actual controller coexists with petting, talking, feeding and drag cancellation', async () => {
  for (const skin of ['pink', 'usagi']) {
    const interactions = [], feeds = [];
    const feedState = { satiation: 60, foodInventory: { fish: 1 }, foodTickets: 6, basicMeal: { remaining: 3, eligible: false }, totalFeeds: 0 };
    const harness = createHarness({ deterministicRandom: true, initialState: { skin }, bridgeOverrides: {
      pet_interaction: value => { interactions.push(value); return Promise.resolve(null); },
      pet_getFeedState: () => Promise.resolve(feedState),
      pet_feed: value => { feeds.push(value); return Promise.resolve({ ok: true, gainedXp: 0, reaction: '好吃', animation: null }); }
    } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(50, count);
    const hit = harness.document._resolve('#petHit');
    const pointer = { isPrimary: true, button: 0, ctrlKey: false, pointerId: 81, screenX: 100, screenY: 100 };
    try {
      frame(40); harness.bridge.handlers.sync({ activityMirror: 'coding' }); frame(2);
      hit.dispatch('pointerdown', pointer); assert.equal(harness.fireTimeoutByDelay(550), true); frame(3);
      assert.equal(harness.runtime.sample().expressionId, 'react.petted');
      assert.equal(harness.runtime.sample().actionId, 'tail-wiggle');
      harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame(3);
      assert.equal(harness.runtime.sample().expressionId, 'react.petted', 'new mirror category cannot replace held petting');
      hit.dispatch('pointerup', pointer); frame(180);
      assert.equal(harness.runtime.sample().actionId, null);
      assert.equal(harness.runtime.sample().sessionActivityId, 'mirror-ai');
      assert.equal(harness.runtime.sample().expressionId, 'life.attentive');
      assert.equal(interactions.length, 0, 'existing long press feedback has no reward or phantom click command');

      harness.bridge.handlers.sync({ message: '现有对话反馈' }); frame(3);
      assert.equal(harness.runtime.sample().state, 'talking');
      assert.equal(harness.runtime.sample().presentationSource, 'interaction');
      harness.bridge.handlers.sync({ activityMirror: 'music' }); frame(3);
      assert.equal(harness.runtime.sample().state, 'talking');
      frame(100);
      assert.equal(harness.runtime.sample().expressionId, 'react.happy');

      harness.document._resolve('#feedQuick').dispatch('click', { stopPropagation() {} }); await settleInit();
      const fish = harness.document._resolve('#foodList').children.find(item => item.dataset.food === 'fish');
      assert.ok(fish && !fish.disabled); fish.dispatch('click', { stopPropagation() {} }); await settleInit();
      frame(2); assert.equal(harness.runtime.sample().expressionId, 'react.surprised');
      harness.bridge.handlers.sync({ activityMirror: 'coding' }); frame(9);
      assert.equal(harness.runtime.sample().expressionId, 'react.hungry');
      frame(17); assert.equal(harness.runtime.sample().expressionId, 'react.satisfied');
      frame(60); assert.equal(harness.runtime.sample().expressionId, 'work.deep-focus');
      assert.equal(feeds.length, 1, 'mirror updates never repeat the feed command');

      hit.dispatch('pointerdown', { ...pointer, pointerId: 82 });
      harness.clockState.now += 100;
      hit.dispatch('pointermove', { pointerId: 82, screenX: 120, screenY: 100 }); await settleInit();
      harness.clockState.now += 100;
      hit.dispatch('pointermove', { pointerId: 82, screenX: 140, screenY: 100 }); frame(3);
      assert.equal(harness.runtime.sample().state, 'dragged');
      assert.equal(harness.runtime.sample().expressionId, 'react.surprised');
      harness.bridge.handlers.sync({ activityMirror: null }); frame(2);
      assert.equal(harness.runtime.sample().state, 'dragged', 'switching mirror off cannot end the input gesture');
      hit.dispatch('pointercancel', { pointerId: 82 }); frame(80);
      assert.equal(harness.runtime.sample().state, 'idle');
      assert.equal(harness.runtime.sample().sessionActivityId, null);
      assert.equal(harness.runtime.sample().expressionId, 'life.idle');
      assert.equal(interactions.length, 0, 'cancelled drag adds no click command');
    } finally { harness.runtime.stop(); }
  }
});

test('activity mirror actual controller keeps calm mode static and hidden off transitions do not replay old activity', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(200, count);
    try {
      frame(10); harness.bridge.handlers.sync({ activityMirror: 'ai', motionMode: 'reduced' }); frame(2);
      assert.equal(harness.runtime.sample().presentationStatic, true);
      assert.equal(harness.runtime.sample().actionProgress, .5);
      frame(20); assert.equal(harness.runtime.sample().actionProgress, .5);
      harness.bridge.handlers.sync({ motionMode: 'full', stimulationMode: 'low' }); frame(2);
      assert.equal(harness.runtime.sample().presentationStatic, true);
      assert.equal(harness.runtime.sample().overlayParticleCount, 0);
      harness.document.hidden = true; harness.document.dispatch('visibilitychange');
      const before = harness.runtime.sample().animNow;
      harness.bridge.handlers.sync({ activityMirror: 'coding' });
      harness.bridge.handlers.sync({ activityMirror: null }); frame(10);
      assert.equal(harness.runtime.sample().animNow, before);
      harness.document.hidden = false; harness.document.dispatch('visibilitychange'); frame(3);
      assert.equal(harness.runtime.sample().sessionActivityId, null);
      assert.equal(harness.runtime.sample().expressionId, 'life.idle');
      assert.equal(harness.runtime.sample().eggActive, false);
      harness.bridge.handlers.sync({ activityMirror: 'music', stimulationMode: 'high' }); frame(3);
      assert.equal(harness.runtime.sample().sessionActivityId, 'mirror-music');
      assert.equal(harness.runtime.sample().expressionId, 'react.happy');
      assert.equal(harness.runtime.sample().presentationStatic, false);
    } finally { harness.runtime.stop(); }
  }
});

test('event mirror actual controller enters once across three loops and settles only after category null', async () => {
  for (const skin of ['pink', 'usagi']) {
    const interactions = [];
    const harness = createHarness({ deterministicRandom: true, initialState: { skin }, bridgeOverrides: {
      pet_interaction: value => { interactions.push(value); return Promise.resolve(null); }
    } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(200, count);
    try {
      frame(10);
      for (const category of ['music', 'ai']) {
        const duration = petContent.MIRROR_ACTIVITIES[`mirror-${category}`].durationMs;
        harness.bridge.handlers.sync({ activityMirror: category }); frame();
        assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'enter');
        assert.equal(harness.runtime.sample().mirrorPlayback.propOpacity, 0);
        frame(2);
        const entry = harness.runtime.sample().mirrorPlayback;
        assert.equal(entry.phase, 'enter');
        assert.ok(entry.propOpacity > 0 && entry.propOpacity < 1);
        harness.bridge.handlers.sync({ activityMirror: category }); frame(3);
        assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
        let previousElapsed = 0;
        while (harness.runtime.sample().mirrorPlayback.elapsedMs < duration * 3 + 200) {
          frame();
          const sample = harness.runtime.sample().mirrorPlayback;
          assert.equal(sample.id, `mirror-${category}`);
          assert.equal(sample.phase, 'loop', `${skin}/${category} never repeats setup`);
          assert.ok(sample.elapsedMs >= previousElapsed);
          previousElapsed = sample.elapsedMs;
          if (sample.elapsedMs % 30000 === 0) harness.bridge.handlers.sync({ activityMirror: category });
        }
        const lastProgress = harness.runtime.sample().mirrorPlayback.loopProgress;
        harness.bridge.handlers.sync({ activityMirror: null }); frame();
        assert.equal(harness.runtime.sample().sessionActivityId, null, 'category authority is already idle');
        assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'exit');
        assert.equal(harness.runtime.sample().mirrorPlayback.loopProgress, lastProgress);
        frame();
        assert.ok(harness.runtime.sample().mirrorPlayback.propOpacity < 1);
        frame(2);
        assert.equal(harness.runtime.sample().mirrorPlayback, null);
        frame(4);
        assert.equal(harness.runtime.sample().mirrorPlayback, null, 'settling cannot replay');
      }
      assert.deepEqual(interactions, [], 'context animation never sends a reward command');
    } finally { harness.runtime.stop(); }
  }
});

test('event mirror actual controller lets clicks and focus interrupt entry or exit without stale recovery', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(50, count);
    const hit = harness.document._resolve('#petHit');
    let pointerId = 200;
    const click = () => {
      const event = { isPrimary: true, button: 0, ctrlKey: false, pointerId: ++pointerId, screenX: 100, screenY: 100 };
      hit.dispatch('pointerdown', event); hit.dispatch('pointerup', event); frame();
    };
    try {
      frame(40); harness.bridge.handlers.sync({ activityMirror: 'music' }); frame(3);
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'enter');
      click();
      assert.equal(harness.runtime.sample().mirrorPlayback, null, 'ordinary click wins on its first frame');
      harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame(2);
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      frame(20);
      assert.equal(harness.runtime.sample().mirrorPlayback.id, 'mirror-ai');
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop', 'setup is not queued behind interaction');
      click();
      assert.equal(harness.runtime.sample().actionId, 'look-around');
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      frame(220);
      assert.equal(harness.runtime.sample().mirrorPlayback, null, 'manual speech also keeps priority until its own timeout');
      harness.fireTimeoutByDelay(5500); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
      harness.bridge.handlers.sync({ activityMirror: null }); frame(2);
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'exit');
      click();
      assert.equal(harness.runtime.sample().mirrorPlayback, null, 'click cancels the outgoing action');
      frame(220);
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      harness.bridge.handlers.sync({ activityMirror: 'music' }); frame(3);
      harness.bridge.handlers.sync({ baseState: 'focused' }); frame();
      assert.match(harness.runtime.sample().sessionActivityId, /^focus-/);
      assert.equal(harness.runtime.sample().mirrorPlayback, null, 'focus never waits for settling');
      harness.bridge.handlers.sync({ activityMirror: null, baseState: 'idle' }); frame(40);
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
    } finally { harness.runtime.stop(); }
  }
});

test('event mirror actual controller clears lifecycle across hide lock form and static policy changes', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(200, count);
    try {
      frame(10); harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame(6);
      harness.document.hidden = true; harness.document.dispatch('visibilitychange');
      const before = harness.runtime.sample().animNow;
      harness.bridge.handlers.sync({ activityMirror: null }); frame(10);
      assert.equal(harness.runtime.sample().animNow, before);
      harness.document.hidden = false; harness.document.dispatch('visibilitychange'); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      harness.bridge.handlers.sync({ activityMirror: 'music' }); frame(6);
      harness.bridge.handlers.sync({ activityMirror: null }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'exit');
      harness.bridge.handlers.sync({ skin: skin === 'pink' ? 'usagi' : 'pink' }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null, 'form change drops old character exit');
      harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame(2);
      harness.bridge.handlers.sync({ motionMode: 'reduced' }); frame();
      const reduced = harness.runtime.sample().mirrorPlayback;
      assert.equal(reduced.phase, 'loop');
      assert.equal(reduced.static, true);
      assert.equal(reduced.loopProgress, .5);
      frame(10); assert.deepEqual(harness.runtime.sample().mirrorPlayback, reduced);
      harness.bridge.handlers.sync({ motionMode: 'full', stimulationMode: 'low' }); frame(2);
      assert.deepEqual(harness.runtime.sample().mirrorPlayback, reduced);
      assert.equal(harness.runtime.sample().overlayParticleCount, 0);
      harness.bridge.handlers.sync({ stimulationMode: 'high' }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
      harness.bridge.handlers.sync({ screenLocked: true, activityMirror: null }); frame(10);
      harness.bridge.handlers.sync({ screenLocked: false }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
    } finally { harness.runtime.stop(); }
  }
});

test('event mirror actual controller does not inherit happy body entry but preserves essential happy feedback', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit();
    harness.fireTimeoutByDelay(3500); // The harness advances rAF and speech timers independently.
    const frame = (count = 1) => harness.frameBy(50, count);
    const bodyMatrix = () => {
      const call = harness.petContext._calls.find(value => value.source === 'drawImage' && !value.imageSrc);
      assert.ok(call, `${skin} paints the cached body`);
      return call.matrix;
    };
    const baselineY = () => {
      const stage = resolveFormStage(skin, 2);
      const idleBob = Math.round(Math.sin(harness.runtime.sample().animNow / (1000 / 60) * .15) * 2);
      return (stage.bodyOrigin.y + idleBob) * stage.deviceScale;
    };
    try {
      frame(40);
      for (const category of ['music', 'ai']) {
        harness.bridge.handlers.sync({ activityMirror: category });
        harness.petContext._reset(); frame();
        assert.equal(harness.runtime.sample().mirrorPlayback.propOpacity, 0);
        const matrix = bodyMatrix(), scale = resolveFormStage(skin, 2).deviceScale;
        assert.ok(Math.abs(matrix.a - scale) < 1e-9 && Math.abs(matrix.d - scale) < 1e-9,
          `${skin}/${category} starts without expression squash or beat scaling: ${JSON.stringify(matrix)}`);
        assert.ok(Math.abs(matrix.b) < 1e-9 && Math.abs(matrix.c) < 1e-9 && Math.abs(matrix.f - baselineY()) < 1e-9,
          `${skin}/${category} starts without expression rotation or vertical entry: ${JSON.stringify(matrix)}`);
        assert.equal(harness.runtime.sample().expressionId, petContent.MIRROR_ACTIVITIES[`mirror-${category}`].expression);
        frame(20);
      }
      harness.bridge.handlers.sync({ presentation: { eventId: `essential-happy-${skin}`,
        expressionId: 'react.happy', source: 'essential', ttlMs: 1500 } });
      harness.petContext._reset(); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(harness.runtime.sample().presentationSource, 'essential');
      assert.ok(bodyMatrix().f - baselineY() > 8, 'ordinary essential happy feedback retains its registered vertical entry');
    } finally { harness.runtime.stop(); }
  }
});

test('context emphasis actual controller shares speech priority, keeps one badge and resumes only the latest category', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit(); harness.fireTimeoutByDelay(3500);
    const frame = (count = 1) => harness.frameBy(50, count);
    const badge = harness.document._resolve('#contextBadge');
    const bubble = harness.document._resolve('#bubble');
    try {
      frame(40); harness.bridge.handlers.sync({ activityMirror: 'music' }); frame();
      assert.equal(bubble.textContent, '音乐陪你慢慢来');
      assert.equal(bubble.dataset.speechSource, 'context');
      assert.equal(badge.classList.contains('show'), false);
      assert.equal(harness.runtime.sample().mirrorPlayback.id, 'mirror-music');
      harness.fireTimeoutByDelay(2800); frame(20);
      assert.equal(badge.querySelector('.context-label').textContent, '音乐疗愈中');
      assert.equal(badge.classList.contains('show'), true);
      harness.bridge.handlers.sync({ message: '必要的原有消息' }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(badge.classList.contains('show'), false);
      harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame();
      assert.equal(bubble.textContent, '必要的原有消息');
      harness.fireTimeoutByDelay(4500); frame(100);
      assert.equal(harness.runtime.sample().mirrorPlayback.id, 'mirror-ai');
      assert.equal(badge.querySelector('.context-label').textContent, 'AI协作中');
      assert.equal(badge.classList.contains('show'), true);
      assert.equal(harness.fireTimeoutByDelay(2800), false, 'busy category arrival never queues a phrase');
      harness.bridge.handlers.sync({ activityMirror: 'ai' }); frame(650);
      assert.equal(harness.fireTimeoutByDelay(2800), false, 'a complete loop and sync never repeats a phrase');
      harness.bridge.handlers.dock({ edge: 'right' }); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(badge.classList.contains('show'), false);
      harness.bridge.handlers.dock({ edge: null }); frame();
      assert.equal(badge.classList.contains('show'), true);
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
      harness.bridge.handlers.sync({ activityMirror: null }); frame();
      assert.equal(badge.classList.contains('show'), false);
      assert.equal(bubble.classList.contains('show'), false);
    } finally { harness.runtime.stop(); }
  }
});

test('context emphasis actual controller yields special props and copy to night, hunger, menus and calm settings', async () => {
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit(); harness.fireTimeoutByDelay(3500);
    const frame = (count = 1) => harness.frameBy(200, count);
    const badge = harness.document._resolve('#contextBadge'), bubble = harness.document._resolve('#bubble');
    try {
      frame(10); harness.bridge.handlers.sync({ activityMirror: 'ai', stimulationMode: 'low' }); frame(5);
      assert.equal(badge.querySelector('.context-label').textContent, 'AI协作中');
      assert.equal(badge.classList.contains('show'), true);
      assert.equal(harness.runtime.sample().mirrorPlayback.static, true);
      assert.equal(bubble.classList.contains('show'), false);
      const late = new Date(harness.clockState.now); late.setHours(23, 0, 0, 0);
      harness.clockState.now = late.getTime(); frame();
      assert.equal(harness.runtime.sample().expressionId, 'life.drowsy');
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(badge.classList.contains('show'), false);
      late.setDate(late.getDate() + 1); late.setHours(2, 0, 0, 0); harness.clockState.now = late.getTime();
      for (const interval of harness.timers.intervals) interval(); frame();
      assert.equal(harness.runtime.sample().state, 'sleeping');
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      late.setHours(7, 0, 0, 0); harness.clockState.now = late.getTime();
      for (const interval of harness.timers.intervals) interval(); frame(2);
      assert.equal(badge.classList.contains('show'), true);
      harness.bridge.handlers.sync({ satiation: 10 });
      for (const interval of harness.timers.intervals) interval(); frame();
      assert.equal(harness.runtime.sample().state, 'hungry');
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(badge.classList.contains('show'), false);
      harness.bridge.handlers.sync({ satiation: 60 });
      for (const interval of harness.timers.intervals) interval(); frame(2);
      assert.equal(badge.classList.contains('show'), true);
      harness.document._resolve('#petHit').dispatch('contextmenu', { preventDefault() {} }); await settleInit(); frame();
      assert.equal(harness.runtime.sample().mirrorPlayback, null);
      assert.equal(badge.classList.contains('show'), false);
      harness.bridge.handlers.sync({ activityMirror: 'music' }); frame();
      assert.equal(bubble.classList.contains('show'), false, 'new context does not speak through a menu');
    } finally { harness.runtime.stop(); }
  }
});

test('concurrent mirror actual controller preserves all focus actions and bounded current extras across overlap/calm/rest', async () => {
  const concurrent = (music = false, ai = false, coding = false) => ({ v: 1, music, coding, ai });
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit(); harness.fireTimeoutByDelay(3500);
    const frame = (count = 1) => harness.frameBy(50, count);
    const sync = harness.bridge.handlers.sync;
    const badge = harness.document._resolve('#contextBadge'), bubble = harness.document._resolve('#bubble');
    try {
      frame(40);
      sync({ activityMirror: 'music', activityMirrorConcurrent: concurrent(true, true) }); frame();
      assert.equal(harness.runtime.sample().sessionActivityId, 'mirror-ai', 'new authoritative projection wins over legacy primary');
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['headphones', 'robot']);
      assert.equal(bubble.textContent, '音乐陪你理思路');
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'enter');
      harness.fireTimeoutByDelay(2800); frame(20);
      assert.equal(badge.querySelector('.context-label').textContent, '音乐 · AI协作');
      sync({ activityMirror: 'ai', activityMirrorConcurrent: concurrent(true, true) }); frame(2);
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
      assert.equal(harness.fireTimeoutByDelay(2800), false);
      sync({ baseState: 'focused' }); frame(40);
      const seen = new Set();
      for (let index = 0; index < 6; index++) {
        const sample = harness.runtime.sample();
        assert.match(sample.sessionActivityId, /^focus-/);
        assert.equal(sample.activityCombination.primary, sample.sessionActivityId);
        assert.deepEqual(sample.activityCombination.extras, ['headphones', 'robot']);
        assert.equal(sample.activityCombination.static, false);
        assert.equal(sample.mirrorPlayback, null);
        assert.equal(sample.presentationSource, 'session');
        assert.equal(badge.querySelector('.context-label').textContent, '专注 · 音乐 · AI');
        assert.equal(badge.style.opacity, '1');
        seen.add(sample.sessionActivityId);
        harness.document._resolve('#activityNext').dispatch('click', { stopPropagation() {} }); frame(2);
      }
      assert.equal(seen.size, 6);
      const selected = harness.runtime.sample().sessionActivityId;
      sync({ motionMode: 'reduced' }); frame(5);
      assert.equal(harness.runtime.sample().sessionActivityId, selected);
      assert.ok(harness.runtime.sample().activityCombination, JSON.stringify(harness.runtime.sample()));
      assert.equal(harness.runtime.sample().activityCombination.static, true);
      assert.equal(harness.runtime.sample().state, 'focused', 'calm does not become sleep/rest');
      assert.equal(harness.runtime.sample().actionProgress, .5);
      sync({ activityMirrorConcurrent: concurrent(false, true) }); frame(5);
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['robot']);
      assert.equal(badge.querySelector('.context-label').textContent, '专注 · AI');
      assert.equal(harness.fireTimeoutByDelay(2800), false, 'removal never repeats remaining phrase');
      sync({ baseState: 'resting' }); frame(40);
      assert.equal(harness.runtime.sample().activityCombination, null);
      assert.equal(badge.classList.contains('show'), false);
      sync({ activityMirror: 'ai', activityMirrorConcurrent: concurrent(), baseState: 'idle' }); frame(40);
      assert.equal(harness.runtime.sample().sessionActivityId, null, 'all-false stops even when legacy primary is stale');
      assert.equal(harness.runtime.sample().activityCombination, null);
      sync({ activityMirrorConcurrent: concurrent(true), motionMode: 'full' }); frame(2);
      assert.equal(harness.runtime.sample().sessionActivityId, 'mirror-music');
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['headphones']);
      assert.equal(bubble.textContent, '音乐陪你慢慢来');
    } finally { harness.runtime.stop(); }
  }
});

test('concurrent mirror actual controller suppresses extras through menu speech drag and hidden off without stale replay', async () => {
  const concurrent = (music = false, ai = false) => ({ v: 1, music, coding: false, ai });
  for (const skin of ['pink', 'usagi']) {
    const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
    await settleInit(); harness.fireTimeoutByDelay(3500);
    const frame = (count = 1) => harness.frameBy(50, count);
    const sync = harness.bridge.handlers.sync;
    const hit = harness.document._resolve('#petHit'), badge = harness.document._resolve('#contextBadge');
    try {
      frame(40); sync({ activityMirrorConcurrent: concurrent(true, true) }); frame(20);
      harness.fireTimeoutByDelay(2800); frame();
      hit.dispatch('contextmenu', { preventDefault() {} }); await settleInit(); frame();
      assert.equal(harness.runtime.sample().activityCombination, null);
      sync({ activityMirrorConcurrent: concurrent(false, true) }); frame(5);
      harness.document.dispatch('keydown', { key: 'Escape' }); frame(2);
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['robot']);
      assert.equal(harness.runtime.sample().mirrorPlayback.phase, 'loop');
      assert.equal(harness.fireTimeoutByDelay(2800), false);
      sync({ message: '已有消息优先' }); frame();
      assert.equal(harness.runtime.sample().activityCombination, null);
      sync({ activityMirrorConcurrent: concurrent(true) }); frame();
      harness.fireTimeoutByDelay(4500); frame(100);
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['headphones']);
      assert.equal(harness.fireTimeoutByDelay(2800), false);
      const pointer = { isPrimary: true, button: 0, ctrlKey: false, pointerId: 701, screenX: 100, screenY: 100 };
      hit.dispatch('pointerdown', pointer); harness.clockState.now += 100;
      hit.dispatch('pointermove', { pointerId: 701, screenX: 125, screenY: 100 }); await settleInit();
      harness.clockState.now += 100;
      hit.dispatch('pointermove', { pointerId: 701, screenX: 145, screenY: 100 }); frame(3);
      assert.equal(harness.runtime.sample().state, 'dragged');
      assert.equal(harness.runtime.sample().activityCombination, null);
      sync({ activityMirrorConcurrent: concurrent(false, true) }); frame(5);
      hit.dispatch('pointercancel', { pointerId: 701 }); frame(80);
      assert.deepEqual(harness.runtime.sample().activityCombination.extras, ['robot']);
      assert.equal(harness.fireTimeoutByDelay(2800), false);
      harness.document.hidden = true; harness.document.dispatch('visibilitychange');
      sync({ activityMirrorConcurrent: concurrent() }); frame(5);
      assert.equal(harness.runtime.sample().activityCombination, null);
      harness.document.hidden = false; harness.document.dispatch('visibilitychange'); frame(2);
      assert.equal(harness.runtime.sample().sessionActivityId, null);
      assert.equal(harness.runtime.sample().activityCombination, null);
      assert.equal(badge.classList.contains('show'), false);
    } finally { harness.runtime.stop(); }
  }
});


function advanceSessionActivityNaturally(harness) {
  const previous = harness.runtime.sample().sessionActivityId;
  for (let elapsed = 0; elapsed < 180000; elapsed += 250) {
    harness.frameBy(250);
    if (harness.runtime.sample().sessionActivityId !== previous) return;
  }
  assert.fail(`session activity did not naturally advance: ${previous}`);
}
for (const skin of ['pink', 'usagi']) test(`canonical star orbit preserves 12 natural activities and truthful focus combinations: ${skin}`, async () => {
  const harness = createHarness({ deterministicRandom: true, initialState: { skin } });
  try {
    await settleInit(); harness.fireTimeoutByDelay(3500);
    const seen = new Set(), status = harness.document.getElementById('sessionStatus');
    for (const baseState of ['focused', 'resting']) {
      const phase = baseState === 'focused' ? 'focus' : 'break';
      harness.bridge.handlers.sync({ baseState, stimulationMode: 'low', motionMode: 'reduced',
        activityMirrorConcurrent: { v: 1, music: true, coding: true, ai: true },
        sessionDisplay: { sessionId: phase, kind: phase, mode: phase, phase, reason: null,
          plannedMs: 600000, elapsedMs: 120000, running: true } });
      harness.frameBy(250, 12);
      for (let index = 0; index < 6; index++) {
        const sample = harness.runtime.sample(), activity = petContent.SESSION_ACTIVITIES[sample.sessionActivityId];
        seen.add(activity.id);
        assert.equal(harness.document.getElementById('stage').dataset.sessionPhase, phase);
        assert.equal(status.getAttribute('tabindex'), '0');
        assert.match(harness.document.getElementById('activityNext').getAttribute('aria-label'), new RegExp(activity.label));
        if (baseState === 'focused') {
          assert.equal(sample.activityCombination.primary, activity.id);
          assert.deepEqual(sample.activityCombination.extras, ['headphones', 'robot']);
          const name = harness.document.getElementById('contextBadge').getAttribute('aria-label');
          for (const label of ['音乐', 'AI', '编程']) assert.ok(name.includes(label), name);
        }
        advanceSessionActivityNaturally(harness);
      }
    }
    assert.equal(seen.size, 12);
  } finally { harness.runtime.stop(); }
});
