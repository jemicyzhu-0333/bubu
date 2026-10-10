'use strict';

// 桌宠像素舞台的几何契约与“道具不许被画布裁掉”的回归守卫。
//
// 0.1.2 之前，宠物 canvas 光栅只有 70×70，身体 66×66 居中后每边只剩 2px。
// drawPetActionDetails() 里有 23 处绘制越过了画布边缘（其中 3 处完全不可见），
// 表现为“动作行为时局部小面积被遮挡”。这里把余量变成可校验的契约：
// 谁新加一个伸得更远的道具，npm run check 就会失败，而不是等肉眼发现缺一只手。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PET_ART,
  PET_ART_BLEED,
  PET_CSS_PER_ART_PIXEL,
  PET_HIT_CSS_SIZE,
  resolvePetStage,
  snapToPetDevicePixel,
  petArtSafeArea
} = require('../src/core/pet-stage.mjs');

const ROOT = path.join(__dirname, '..');
const petSource = ['runtime', 'controller', 'renderer', 'compositor', 'scene', 'effects'].map(file => fs.readFileSync(
  path.join(ROOT, 'src/surfaces/pet', file + '.mjs'), 'utf8'
)).join('\n');
const petActionSource = fs.readFileSync(path.join(ROOT, 'src/core/pet-action-art.mjs'), 'utf8');
const petHtml = fs.readFileSync(path.join(ROOT, 'src/renderer/pet.html'), 'utf8');
const petActionArt = require('../src/core/pet-action-art.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { SESSION_ACTIVITIES } = require('../src/content/session-activities.mjs');

function sourceBetween(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `无法在源码中定位 ${from} .. ${to}`);
  return source.slice(start, end);
}

// ---------- 表达式取极值 ----------
// 动作坐标是相位、进度、朝向的函数。这里在完整定义域上采样求极值，
// 不依赖“作者记得自己写了多大的振幅”。
const SAMPLE_ENV = (() => {
  const rows = [];
  for (const handLift of [-4, -2, 0, 2, 4]) {
    for (const facing of [1, -1]) {
      for (let step = 0; step <= 64; step++) {
        const t = step / 64;
        rows.push({
          handLift,
          facing,
          progress: t,
          actionT: t,
          phase: t * Math.PI * 2,
          frame: step * 7,
          // 0.1.3 起常驻动画按真实时间采样：legacyFrames = animNow / (1000/60)，
          // 定义域与 frame 相同（连续、无上界），沿用同一采样网格求振幅。
          legacyFrames: step * 7,
          bob: Math.round(Math.sin(step * 0.15) * 2)
        });
      }
    }
  }
  return rows;
})();

const SAMPLE_KEYS = ['handLift', 'facing', 'progress', 'actionT', 'phase', 'frame', 'legacyFrames', 'bob'];

function expressionRange(expression) {
  let evaluate;
  try {
    evaluate = new Function(...SAMPLE_KEYS, 'Math', `return (${expression});`);
  } catch (_) {
    return null;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const row of SAMPLE_ENV) {
    let value;
    try {
      value = evaluate(...SAMPLE_KEYS.map(key => row[key]), Math);
    } catch (_) {
      return null;
    }
    if (!Number.isFinite(value)) return null;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : { min, max };
}

test('像素舞台几何：身体居中、四周留余量、美术像素落在整数设备像素上', () => {
  assert.equal(PET_ART.cell * PET_ART.columns, PET_ART.bodySize);

  const retina = resolvePetStage({ devicePixelRatio: 2 });
  assert.equal(retina.artWidth, PET_ART.bodySize + PET_ART_BLEED * 2);
  assert.equal(retina.bodyOrigin.x, PET_ART_BLEED);
  assert.equal(retina.bodyOrigin.y, PET_ART_BLEED);
  // 身体中心必须是舞台中心，否则旋转轴心会偏。
  assert.equal(retina.bodyOrigin.x + PET_ART.bodySize / 2, retina.bodyCenter.x);
  // 视觉尺寸与 0.1.0 完全一致：66 美术像素 × 1.5 = 99 CSS px。
  assert.equal(retina.bodyCssSize, PET_ART.bodySize * PET_CSS_PER_ART_PIXEL);
  assert.equal(retina.deviceScale, 3);
  assert.equal(retina.rasterWidth, retina.artWidth * 3);

  for (const devicePixelRatio of [1, 1.25, 1.5, 2, 2.5, 3]) {
    const stage = resolvePetStage({ devicePixelRatio });
    assert.ok(Number.isInteger(stage.deviceScale) && stage.deviceScale >= 1,
      `dpr=${devicePixelRatio} 的美术像素缩放必须是正整数，否则格子边缘会落在半个设备像素上`);
    assert.ok(Number.isInteger(stage.rasterWidth) && Number.isInteger(stage.rasterHeight));
    // CSS 尺寸与 dpr 无关：换显示器不会让宠物忽大忽小。
    assert.equal(stage.cssWidth, stage.artWidth * PET_CSS_PER_ART_PIXEL);
    // Source grid stays integral; final smooth downsampling prevents contour
    // rows from popping as the animated sprite rotates on fractional DPI.
    assert.ok(stage.rasterWidth >= stage.cssWidth * devicePixelRatio,
      `dpr=${devicePixelRatio} cannot upscale a low-resolution animation`);
  }

  assert.throws(() => resolvePetStage({ devicePixelRatio: 0 }), RangeError);
  assert.throws(() => resolvePetStage({ bleed: -1 }), RangeError);
  assert.throws(() => resolvePetStage({ bleed: 1.5 }), RangeError);
});

test('位移量化把动作偏移吸附到整数设备像素', () => {
  assert.equal(snapToPetDevicePixel(24.4, 3), 24 + 1 / 3);
  assert.equal(snapToPetDevicePixel(24, 3), 24);
  // 量化后 × deviceScale 必须是整数，这正是“不产生半透明接缝”的充分条件。
  for (const scale of [1, 2, 3, 4]) {
    for (const raw of [0, 0.5, 1.24, -2.37, 57.91]) {
      const snapped = snapToPetDevicePixel(raw, scale);
      assert.ok(Number.isInteger(Math.round(snapped * scale * 1e6) / 1e6),
        `deviceScale=${scale} 时 ${raw} 量化后没有落在整数设备像素上`);
      assert.ok(Math.abs(snapped - raw) <= 0.5 / scale + 1e-9, '量化不能把动作挪动超过半个设备像素');
    }
  }
  assert.throws(() => snapToPetDevicePixel(Number.NaN, 3), TypeError);
  assert.throws(() => snapToPetDevicePixel(1, 0), RangeError);
});

test('四肢与道具的全部绘制都落在安全区内，不会被画布边缘裁掉', () => {
  const safe = petArtSafeArea(resolvePetStage({ devicePixelRatio: 2 }));
  const details = sourceBetween(petActionSource, 'function petActionDrawDetails', '// 只有必须在 220×220 overlay');
  const violations = [], sampled = new Set();
  let label;
  const context = {
    globalAlpha: 1, fillStyle: '#000',
    save() {}, restore() {}, translate() {}, scale() {},
    fillRect(x, y, width, height) {
      if (![x,y,width,height].every(Number.isFinite)) violations.push(`${label}: non-finite paint`);
      else if (x < safe.left || y < safe.top || x + width > safe.right || y + height > safe.bottom) {
        violations.push(`${label}: [${x},${y},${width},${height}] exceeds stage bleed`);
      }
    }
  };
  const actions = [...Object.values(PET_ACTIONS), ...Object.values(SESSION_ACTIVITIES)];
  // Run the real painters, including generated SVG runs and coupled limbs.
  // Counting source-code petRect calls stopped covering the extracted tools.
  for (const action of actions) for (const view of ['front','three-quarter','profile','back']) {
    sampled.add(`${action.id}/${view}`);
    for (let step = 0; step <= 32; step += 1) {
      label = `${action.id}/${view}/${step}`;
      petActionArt.drawActionDetails(context, action, step / 32, ['#000','#111','#f7768e','#dc5069'], {
        bodySize: 66, offX: 0, offY: 0, layer: 'all', view
      });
    }
  }
  assert.equal(sampled.size, actions.length * 4);
  assert.deepEqual(violations, []);
  assert.doesNotMatch(details,
    /context\.(?:arc|moveTo|lineTo|quadraticCurveTo|bezierCurveTo|strokeRect|fillText)\s*\(/,
    '四肢和道具只允许走像素矩形画笔，不得回退到抗锯齿矢量或字体图形');
});

test('每帧的身体位移不会把身体本体推出画布', () => {
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const drawPet = sourceBetween(petSource, 'function drawPet(', 'pctx.clearRect(0, 0, size, size)');

  const offsets = [...drawPet.matchAll(/off([XY])\s*([+-])=\s*([^;]+);/g)];
  assert.ok(offsets.length >= 3, `只解析到 ${offsets.length} 处 renderer 身体位移，扫描器与源码已经脱节`);

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const [, axis, sign, expression] of offsets) {
    // 特殊动作位移由下方对共享 action layer 的全量数值扫描覆盖。
    if (expression.trim().startsWith('actionOffset.')) continue;
    if (expression.trim().startsWith('bodyStateOffset(')) {
      // The extracted production module is sampled across its actual states;
      // source-text expression evaluation no longer represents these branches.
      const { bodyStateOffset } = require('../src/surfaces/pet/body-presentation.mjs');
      for (const state of ['idle','sleeping','resting','celebrating','walking','dragged'])
        for (const formId of ['dango','usagi']) for (const calmVisual of [false,true])
          for (let frame = 0; frame <= 400; frame++) {
            const value = bodyStateOffset({ state, formId, calmVisual, legacyFrames: frame / 2,
              bob: calmVisual ? 0 : Math.round(Math.sin(frame / 2 * .15) * 2) });
            assert.ok(Number.isFinite(value));minY = Math.min(minY, value);maxY = Math.max(maxY, value);
          }
      continue;
    }
    const range = expressionRange(expression);
    assert.ok(range, `无法求值的身体位移表达式：${expression}`);
    const low = sign === '+' ? range.min : -range.max;
    const high = sign === '+' ? range.max : -range.min;
    if (axis === 'X') { minX = Math.min(minX, low); maxX = Math.max(maxX, high); }
    else { minY = Math.min(minY, low); maxY = Math.max(maxY, high); }
  }

  const actions = [...Object.values(PET_ACTIONS), ...Object.values(SESSION_ACTIVITIES)];
  for (const action of actions) {
    for (const facing of [-1, 1]) {
      for (let step = 0; step <= 128; step++) {
        const offset = petActionArt.bodyOffset(action, step / 128, {
          bodySize: stage.bodySize,
          facing,
          calmVisual: false
        });
        assert.ok(Number.isFinite(offset.x) && Number.isFinite(offset.y), `${action.id} 产生了非有限位移`);
        minX = Math.min(minX, offset.x);
        maxX = Math.max(maxX, offset.x);
        minY = Math.min(minY, offset.y);
        maxY = Math.max(maxY, offset.y);
      }
    }
  }

  // 位移是互斥分支，所以按单个分支的最大值检查即可。
  assert.ok(stage.bodyOrigin.x + minX >= 0,
    `身体最多向左位移 ${(-minX).toFixed(1)}，超过了 ${stage.bodyOrigin.x} 的余量`);
  assert.ok(stage.bodyOrigin.y + minY >= 0,
    `身体最多向上位移 ${(-minY).toFixed(1)}，超过了 ${stage.bodyOrigin.y} 的余量`);
  assert.ok(stage.bodyOrigin.x + maxX + stage.bodySize <= stage.artWidth,
    `身体最多向右位移 ${maxX.toFixed(1)}，会被画布右缘裁掉`);
  assert.ok(stage.bodyOrigin.y + maxY + stage.bodySize <= stage.artHeight,
    `身体最多向下位移 ${maxY.toFixed(1)}，会被画布下缘裁掉`);
});

test('特殊动作按身体尺寸缩放，手持镜像留在身体绘制层', () => {
  const mirror = PET_ACTIONS['mirror-meet'];
  assert.equal(petActionArt.actionUnit(66), 1);
  assert.equal(petActionArt.actionUnit(99), 1.5);
  assert.equal(petActionArt.bodyOffset(mirror, .25, { bodySize: 66 }).x, 0);
  assert.equal(petActionArt.bodyOffset(mirror, .25, { bodySize: 99 }).x, 0);
  assert.equal(petActionArt.bodyOffset(PET_ACTIONS.moonwalk, .125, { bodySize: 99 }).x, 10.5);
  const calls = [];
  const context = {
    globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {}, fillRect() {},
    drawImage(...args) { calls.push(args); }
  };
  const normal = petActionArt.drawActionDetails(context, mirror, .25, ['#000','#111','#f7768e','#dc5069'], { bodySize: 66 });
  const large = petActionArt.drawActionDetails(context, mirror, .25, ['#000','#111','#f7768e','#dc5069'], { bodySize: 99 });
  assert.equal(large.maxX, normal.maxX * 1.5);
  assert.equal(large.maxY, normal.maxY * 1.5);
  petActionArt.drawActionOverlay(context, mirror, .25);
  assert.deepEqual(calls, [], 'mirror must not clone a second full-size pet canvas');
});

test('活动脸（眼 + 嘴）的位姿范围落在像素舞台安全区内', () => {
  const petFace = require('../src/core/pet-face.mjs');
  const petExpression = require('../src/core/pet-expression.mjs');
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const safe = petArtSafeArea(stage);
  const cell = PET_ART.cell;
  // 注视偏移上限 3 美术像素（与 core/pet-expression.js 的 face.eyeOffsetX/Y 范围一致）。
  const maxEyeOffset = 3;

  // 眼区：左右眼锚点 + 眼网格尺寸 + 注视偏移。宽高分开取，眼网格不再假设是正方。
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const anchor of [petFace.EYE_ANCHORS.left, petFace.EYE_ANCHORS.right]) {
    minX = Math.min(minX, anchor.gridX * cell - maxEyeOffset);
    maxX = Math.max(maxX, (anchor.gridX + petFace.EYE_GRID_WIDTH) * cell + maxEyeOffset);
    minY = Math.min(minY, anchor.gridY * cell - maxEyeOffset);
    maxY = Math.max(maxY, (anchor.gridY + petFace.EYE_GRID_HEIGHT) * cell + maxEyeOffset);
  }
  // 嘴区：锚点 + 嘴网格尺寸。高度从 pet-face.js 取定值，不再写死 3 行。
  minX = Math.min(minX, petFace.MOUTH_ANCHOR.gridX * cell);
  maxX = Math.max(maxX, (petFace.MOUTH_ANCHOR.gridX + petFace.MOUTH_GRID_WIDTH) * cell);
  minY = Math.min(minY, petFace.MOUTH_ANCHOR.gridY * cell);
  maxY = Math.max(maxY, (petFace.MOUTH_ANCHOR.gridY + petFace.MOUTH_GRID_HEIGHT) * cell);

  assert.ok(minX >= safe.left, `脸最左 ${minX} 越过安全区 ${safe.left}`);
  assert.ok(maxX <= safe.right, `脸最右 ${maxX} 越过安全区 ${safe.right}`);
  assert.ok(minY >= safe.top, `脸最上 ${minY} 越过安全区 ${safe.top}`);
  assert.ok(maxY <= safe.bottom, `脸最下 ${maxY} 越过安全区 ${safe.bottom}`);
});

test('renderer 只从 pet-stage 取几何，并把身体画成一次贴图', () => {
  // 身体不能再退回“每帧 484 次 fillRect”：那是接缝的来源。
  const drawPetBody = sourceBetween(petSource, 'function drawPetBody(', 'function drawPet(');
  assert.match(drawPetBody, /petSprites\.acquire\(/, '身体必须走 sprite 缓存');
  assert.match(drawPetBody, /formArt\.drawBodySprite\(pctx, sprite/, '身体必须通过形态合成器一次贴出');

  const drawPet = sourceBetween(petSource, 'function drawPet(', 'function drawScene(');
  assert.doesNotMatch(drawPet, /MONSTER_GRID/, '网格绘制应留在 sprite 里，不在主绘制循环');
  assert.match(drawPet, /const geo = runtimeState\.petStageGeo;/);
  assert.match(drawPet, /offX = snap\(offX\);/, '身体原点必须量化到整数设备像素');
  assert.match(drawPet, /offY = snap\(offY\);/);

  // 位移必须全部经过量化包装，否则会重新出现半透明接缝。
  const transform = sourceBetween(petActionSource, 'function petActionApplyBodyTransform(', 'function petActionDrawDetails');
  assert.doesNotMatch(transform, /context\.translate\(/,
    'petActionApplyBodyTransform 必须使用注入的量化 translate，不能直接调 context.translate');
  assert.match(transform, /translate\(/);
  assert.match(drawPet, /formArt\.applyMotionTransform\([\s\S]*?translate:\s*petTranslate/,
    'renderer 必须把量化位移器注入形态动作适配层');

  // 光栅按设备像素比设置，且插值关闭。
  assert.match(petSource, /petCanvas\.width = geo\.rasterWidth;/);
  assert.match(petSource, /pctx\.setTransform\(geo\.deviceScale, 0, 0, geo\.deviceScale, 0, 0\)/);
  assert.match(petSource, /\(resolution: \$\{window\.devicePixelRatio \|\| 1\}dppx\)/,
    '换显示器后设备像素比会变，必须重算光栅');
});

test('画布负责出图、命中框负责交互，交互面积与吸附可见矩形一致', () => {
  const stage = resolvePetStage({ devicePixelRatio: 2 });

  // 画布铺满整个宠物层，尺寸来自 pet-stage，不再是散落的 105px 字面量。
  assert.match(petHtml, new RegExp(`\\.pet-layer\\s*\\{[\\s\\S]*?width:\\s*${stage.cssWidth}px;\\s*height:\\s*${stage.cssHeight}px`));
  assert.match(petHtml, new RegExp(`#petCanvas\\s*\\{[\\s\\S]*?width:\\s*${stage.cssWidth}px;\\s*height:\\s*${stage.cssHeight}px`));
  assert.match(petHtml, /#petCanvas\s*\{[\s\S]*?pointer-events:\s*none/,
    '画布扩容后不能同时是命中区，否则点到空气也会互动');

  // 命中框仍是 105×105，与 main.js 的 PET_VISUAL_SIZE / 吸附计算保持同一口径。
  assert.equal(stage.hitCssSize, PET_HIT_CSS_SIZE);
  assert.match(petHtml, new RegExp(`\\.pet-hit\\s*\\{[\\s\\S]*?left:\\s*${stage.hitCssOffset}px;\\s*top:\\s*${stage.hitCssOffset}px`));
  assert.match(petHtml, new RegExp(`\\.pet-hit\\s*\\{[\\s\\S]*?width:\\s*${stage.hitCssSize}px;\\s*height:\\s*${stage.hitCssSize}px`));
  assert.match(petHtml, /\.pet-hit\s*\{[\s\S]*?pointer-events:\s*auto/);

  // 无障碍语义随命中框迁移，画布退化为纯装饰。
  assert.match(petHtml, /<canvas id="petCanvas"[^>]*aria-hidden="true"/);
  assert.match(petHtml, /id="petHit"[^>]*role="button"[^>]*tabindex="0"/);
  assert.match(petHtml, /id="petHit"[^>]*aria-controls="commandMenu"/);
  assert.match(petHtml, /\.pet-hit:focus-visible/);

  // 吸附、peek、按压的位移统一作用在宠物层，画布与命中框不会各走一套。
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    assert.match(petHtml, new RegExp(`\\.stage\\.dock-${edge}:not\\(\\.peek\\):not\\(\\.menu-open\\) \\.pet-layer`));
  }
  assert.match(petHtml, /\.stage\.peek \.pet-layer/);
  assert.match(petHtml, /\.pet-layer\.pressed \{ transform: scale\(0\.94\); \}/);
  assert.doesNotMatch(petHtml, /#petCanvas\.(dragging|pressed)\b/,
    '位移与按压反馈不应再挂在画布上');

  assert.match(petHtml, /type="module"[^>]*src="\.\.\/surfaces\/pet\/entry\.mjs"/);
  assert.match(petHtml, /src="\.\.\/surfaces\/pet\/entry\.mjs"/);
});
