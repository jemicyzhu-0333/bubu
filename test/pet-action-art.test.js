'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const petActionArt = require('../src/core/pet-action-art.mjs');
const petArt = require('../src/core/pet-art.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');

function createLayerContext() {
  let offsetX = 0;
  let offsetY = 0;
  const stack = [];
  const calls = [];
  const context = {
    fillStyle: '#000',
    imageSmoothingEnabled: true,
    save() { stack.push({ offsetX, offsetY }); },
    restore() {
      const state = stack.pop();
      if (state) ({ offsetX, offsetY } = state);
    },
    setTransform() { offsetX = 0; offsetY = 0; },
    translate(x, y) { offsetX += x; offsetY += y; },
    scale() {},
    rotate() {},
    clearRect() {},
    fillRect(x, y, width, height) {
      calls.push({ color: this.fillStyle, x: x + offsetX, y: y + offsetY, width, height });
    }
  };
  return { context, calls };
}

function createSurface(recording) {
  return { getContext: () => recording.context };
}

const stage = resolvePetStage();
const { x: offX, y: offY } = stage.bodyOrigin;

test('雨伞主柄在身体后层，front 层只保留握持手部', () => {
  const action = PET_ACTIONS['umbrella-dance'];
  const palette = petArt.PALETTES.pink;
  const back = createLayerContext();
  const front = createLayerContext();

  petActionArt.paintActionLayer(createSurface(back), action, 0.5, palette, { stage, layer: 'back', offX, offY });
  petActionArt.paintActionLayer(createSurface(front), action, 0.5, palette, { stage, layer: 'front', offX, offY });

  assert.ok(back.calls.some(call => call.x >= offX + 68 && call.x <= offX + 73 && call.y <= offY + 44),
    'back 层应包含身体右侧的雨伞主柄');
  assert.ok(front.calls.some(call => call.x >= offX + 65 && call.x <= offX + 76 && call.y >= offY + 22 && call.y <= offY + 40),
    'front 层应包含与伞柄对齐的手掌');
  assert.equal(front.calls.some(call => call.x >= offX + 68 && call.x <= offX + 73 && call.y < offY + 22), false,
    'front 层不能再绘制贯穿头部的整根伞柄');
  const grip = createLayerContext();
  petActionArt.paintActionLayer(createSurface(grip), { ...action, prop: 'none' }, 0.5, palette, {
    stage, layer: 'front', offX, offY
  });
  assert.deepEqual(front.calls, grip.calls, 'front 层必须只包含握持动作，不能残留旧位置的第二根伞柄');
});

test('雨伞整体旋转保持为轻微摇摆，不会把角色掰斜', () => {
  const rotations = [];
  const context = { rotate(value) { rotations.push(value); }, translate() {}, scale() {} };
  for (let sample = 0; sample <= 128; sample += 1) {
    petActionArt.applyBodyTransform(context, PET_ACTIONS['umbrella-dance'], sample / 128, {
      calmVisual: false,
      size: stage.artWidth,
      bodySize: stage.bodySize,
      translate() {}
    });
  }
  assert.equal(rotations.length, 129);
  assert.ok(rotations.every(rotation => Math.abs(rotation) <= 0.035 + Number.EPSILON));
  assert.ok(rotations.some(rotation => rotation >= 0.035 - Number.EPSILON));
  assert.ok(rotations.some(rotation => rotation <= -0.035 + Number.EPSILON));
  rotations.length = 0;
  petActionArt.applyBodyTransform(context, PET_ACTIONS['umbrella-dance'], 0.125, { calmVisual: true });
  assert.deepEqual(rotations, [], '静态降级不能残留雨伞摇摆');
});

test('哈欠动作不在表达引擎的嘴部区域叠画第二张嘴', () => {
  for (let sample = 0; sample <= 32; sample += 1) {
    for (const layer of ['back', 'front']) {
      const recording = createLayerContext();
      petActionArt.paintActionLayer(createSurface(recording), PET_ACTIONS.yawn, sample / 32, petArt.PALETTES.pink, {
        stage, layer, offX, offY
      });
      const mouthPaint = recording.calls.filter(call =>
        call.x < offX + 42 && call.x + call.width > offX + 24 &&
        call.y < offY + 50 && call.y + call.height > offY + 34);
      assert.deepEqual(mouthPaint, [], `phase=${sample / 32} layer=${layer} 不能覆盖活动脸的嘴部`);
    }
  }
});

test('困倦辅助符号在身体上方分开排列，不会覆盖脸部', () => {
  const calls = [];
  const context = {
    globalAlpha: 1,
    fillStyle: '#000',
    save() {},
    restore() {},
    fillRect(x, y, width, height) { calls.push({ x, y, width, height }); }
  };
  petArt.drawExpressionAccent(context, 'drowsy-zzz', 0, { offX: 36, offY: 36, calmVisual: true, color: '#bb9af7' });
  assert.equal(calls.length, 10, '困倦状态应绘制两个完整 Z 符号');
  assert.ok(calls.every(call => call.y + call.height <= 36), '困倦符号应位于身体上方');
  assert.ok(calls.some(call => call.x >= 84 && call.x < 90));
  assert.ok(calls.some(call => call.x >= 93 && call.x < 99));
});

test('击掌的伙伴手是圆乎乎的肉垫爪（趾垫+掌垫），不是五指人手', () => {
  const action = PET_ACTIONS['high-five'];
  assert.equal(action.prop, 'high-five');
  const palette = petArt.PALETTES.pink;
  const front = createLayerContext();
  petActionArt.paintActionLayer(createSurface(front), action, 0.5, palette, {
    stage, layer: 'front', offX, offY
  });
  assert.ok(front.calls.length > 0, 'front 层应画出伙伴的爪子');

  const accent = '#e0af68';
  // 招牌“爪印”特征：三颗竖排的 2×2 趾垫 + 一块掌垫，而不是五根手指。
  const toeBeans = front.calls.filter(call =>
    call.color === accent && call.width === 2 && call.height === 2);
  assert.equal(toeBeans.length, 3, '应有三颗趾垫（爪印特征），而不是五根手指');
  assert.equal(new Set(toeBeans.map(call => call.x)).size, 1, '三颗趾垫竖直排成一列');
  const beanYs = toeBeans.map(call => call.y).sort((a, b) => a - b);
  assert.ok(beanYs[1] - beanYs[0] === 4 && beanYs[2] - beanYs[1] === 4, '趾垫等距分布');
  const palmPads = front.calls.filter(call =>
    call.color === accent && call.width === 4 && call.height === 4);
  assert.equal(palmPads.length, 1, '应有一块掌垫');

  // 圆乎乎的爪轮廓：中段鼓成圆弧（最宽 ≥16），读作圆爪而非方手/机械爪。
  const pawOutline = front.calls.filter(call => call.color === palette[1] && call.width >= 10);
  assert.ok(Math.max(...pawOutline.map(call => call.width)) >= 16, '爪掌中段应鼓成圆弧（最宽处 ≥16）');
});

test('tail-wiggle 的尾巴根埋进身体、向后上方上扬、圆绒尾梢无深色方核', () => {
  const action = PET_ACTIONS['tail-wiggle'];
  assert.equal(action.prop, 'tail');
  const palette = petArt.PALETTES.pink;
  const outline = palette[1];
  const body = palette[2];

  const back = createLayerContext();
  petActionArt.paintActionLayer(createSurface(back), action, 0.125, palette, {
    stage, layer: 'back', offX, offY
  });
  const front = createLayerContext();
  petActionArt.paintActionLayer(createSurface(front), action, 0.125, palette, {
    stage, layer: 'front', offX, offY
  });

  assert.ok(back.calls.length > 0, '尾巴画在身体后层');
  assert.equal(front.calls.length, 0, '尾巴不出现在 front 层（不挡脸/穿身）');

  // 尾根埋进身体：根部方块落在身体右下轮廓内，接缝随后被身体贴图盖住。
  assert.ok(back.calls.some(call =>
    call.x >= offX + 42 && call.x <= offX + 58 && call.y >= offY + 44 && call.y <= offY + 58),
    '尾根应埋进身体，而不是与身体脱节');
  // 尾梢向后上方扬起：存在落在身体上方偏后的方块（y≤offY+30 且 x≥offX+74）。
  assert.ok(back.calls.some(call => call.y <= offY + 30 && call.x >= offX + 74),
    '尾巴应向后上方平滑上扬');
  // 圆绒尾梢用身体同色，不放深色方核（旧版尾梢像旗子/火柴）。
  assert.ok(back.calls.some(call => call.color === body && call.y <= offY + 30 && call.x >= offX + 74),
    '尾梢是身体同色的圆绒球');
  assert.ok(back.calls.every(call => call.color === outline || call.color === body),
    '尾巴只用轮廓色与身体色，无突兀的深色方核或杂色');
});
