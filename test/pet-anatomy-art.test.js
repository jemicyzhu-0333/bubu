'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const petAnatomyArt = require('../src/core/pet-anatomy-art.mjs');
const { BODY_ANCHORS } = require('../src/content/companion/dango-body.mjs');
const { BODY_VARIANTS } = require('../src/core/pet-art.mjs');
const { derivePetView } = require('../src/core/pet-appearance.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');

function createDrawingContext() {
  const rectangles = [];
  const pixels = new Set();
  return {
    rectangles,
    pixels,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    set fillStyle(_value) {},
    fillRect(left, top, width, height) {
      rectangles.push({ x: left, y: top, width, height });
      for (let pixelY = top; pixelY < top + height; pixelY += 1) {
        for (let pixelX = left; pixelX < left + width; pixelX += 1) pixels.add(`${pixelX}:${pixelY}`);
      }
    }
  };
}

test('动作手臂从身体根部连续延伸，并在 front/profile/back 维持可见侧', () => {
  const action = PET_ACTIONS['high-five'];
  const front = petAnatomyArt.armPoses(action, 0.5, 'front');
  const profile = petAnatomyArt.armPoses(action, 0.5, 'profile');
  const back = petAnatomyArt.armPoses(action, 0.5, 'back');

  assert.equal(front.length, 1);
  assert.deepEqual(front[0].points[0], Object.values(BODY_ANCHORS.front['shoulder-right']));
  assert.equal(profile.length, 1);
  assert.equal(profile[0].side, 'right');
  assert.deepEqual(profile[0].points[0], Object.values(BODY_ANCHORS.profile['shoulder-right']));
  assert.ok(profile[0].points.at(-1)[0] <= 66);
  assert.deepEqual(back[0].points[0], Object.values(BODY_ANCHORS.back['shoulder-left']));
  assert.equal(front[0].style, 'open');
});

test('look-around 举着望远镜张望：双手托住镜筒，不再是没有手扶的贴脸蓝眼镜', () => {
  // 旧版 look 运动没有任何 armPoses 分支，binoculars 道具于是悬在脸上没有手扶，读起来像贴图错误。
  const look = petAnatomyArt.armPoses(PET_ACTIONS['look-around'], 0.5, 'front');
  assert.equal(look.length, 2, 'look-around 应有左右两只手托望远镜');
  assert.ok(look.some(pose => pose.side === 'left') && look.some(pose => pose.side === 'right'), '左右各一只手');
  // 手掌抬到镜筒高度（y 28–40，贴近眼部），而不是垂在身体两侧（y≈ 45–55）。
  assert.ok(look.every(pose => {
    const handY = pose.points.at(-1)[1];
    return handY >= 28 && handY <= 40;
  }), '双手应抬到镜筒高度托住望远镜');
});

test('look-around 用正面视图：双手对称、对准双眼的面部道具不能走三分之四', () => {
  // 三分之四下双眼摆向转身侧、间距从 28 art px 压到 18，而望远镜的两只镜筒是固定对称的；
  // 两者对不上时中间那道桥正好盖在左眼上，读作“脸上糊了一块蓝矩形”的贴图错误。
  assert.equal(derivePetView({ action: PET_ACTIONS['look-around'], state: 'idle' }), 'front');
});

test('转身不得把手臂拽进身体：外伸的手在三分之四下仍然外伸，层归属不变', () => {
  // 旧实现把远侧手臂按 0.52 压向中线，为的是迁就同样错误的“把正面压扁 0.52”身体网格。
  // 身体网格改成手绘定稿（轮廓宽度比 0.94）后，这个补偿反而把跳舞的左手从 art x -3
  // 拽到 14：落点进入躯干跨度后又被判成 front 层，读作“贴在脸颊上的一块褐色块”。
  for (const motion of ['dance', 'stretch', 'box']) {
    const action = PET_ACTIONS[motion] || { motion };
    const front = petAnatomyArt.armPoses(action, 0.25, 'front');
    const tq = petAnatomyArt.armPoses(action, 0.25, 'three-quarter');
    assert.equal(tq.length, front.length, `${motion} 三分之四不应丢手臂`);
    for (let index = 0; index < front.length; index += 1) {
      const frontHand = front[index].points.at(-1)[0];
      const tqHand = tq[index].points.at(-1)[0];
      assert.equal(tq[index].layer, front[index].layer, `${motion} 手臂层归属不得因转身翻面`);
      if (frontHand < 6 || frontHand > 60) {
        assert.ok(
          tqHand < 6 || tqHand > 60,
          `${motion} 外伸的手（front x=${frontHand}）不得在转身后被拽进躯干（x=${tqHand}）`
        );
      }
    }
  }
});

test('每个视图的肩根都落在该视图的身体像素上，不悬在轮廓外的空处', () => {
  // 这是手臂与身体网格之间真正的契约，而不是某个魔术压缩系数：肩根必须压在身体上。
  // 身体网格每格 = 2 art px，所以 art 坐标除 2 取整就是网格坐标。
  for (const view of ['front', 'three-quarter', 'profile', 'back']) {
    const grid = BODY_VARIANTS[view];
    for (const motion of ['dance', 'stretch', 'box', 'wave', 'drum', 'high-five']) {
      const action = PET_ACTIONS[motion] || { motion };
      for (const pose of petAnatomyArt.armPoses(action, 0.25, view)) {
        const [shoulderX, shoulderY] = pose.points[0];
        const glyph = grid[Math.floor(shoulderY / 2)]?.[Math.floor(shoulderX / 2)];
        assert.ok(
          glyph && glyph !== '.',
          `${view}/${motion} 肩根 art(${shoulderX},${shoulderY}) 应落在身体上，实际字形=${glyph}`
        );
      }
    }
  }
});

test('手掌保持脚部式圆弧轮廓，不绘制外伸手指', () => {
  const context = createDrawingContext();
  petAnatomyArt.drawAnatomyLayer(context, PET_ACTIONS.wave, 0.5, ['#000', '#111', '#f7768e'], {
    bodySize: 66,
    layer: 'front'
  });

  assert.ok(context.rectangles.length > 0);
  assert.equal(context.rectangles.some(rect => rect.y < 14), false);
  assert.equal(context.rectangles.some(rect => rect.width === 3 && rect.height === 5), false);
  for (const [offsetY, radius] of [[-4, 2], [-3, 3], [-2, 4]]) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      assert.equal(context.pixels.has(`${67 + offsetX}:${18 + offsetY}`), Math.abs(offsetX) <= radius);
    }
  }
});

test('内收/敲击/舞蹈类动作的手臂随 progress 连续变化，不再是固定姿态', () => {
  // 旧版 read/type/carry/picnic 等的手臂全程固定，动起来“卡卡的”。
  // 扫描一个完整周期（避开在正弦零点采样造成的假静止），要求手掌落点至少有 3 个不同位置。
  const movers = ['read-book', 'type-keyboard', 'drum-solo', 'dance', 'shadow-box',
    'knit-scarf', 'snack-picnic', 'wave', 'high-five', 'carry-energy'];
  for (const id of movers) {
    const action = PET_ACTIONS[id];
    assert.ok(action, `缺少行为夹具 ${id}`);
    const positions = new Set();
    for (let index = 0; index < 24; index += 1) {
      const progress = index / 24;
      for (const pose of petAnatomyArt.armPoses(action, progress, 'front')) {
        const [handX, handY] = pose.points.at(-1);
        positions.add(`${Math.round(handX)}:${Math.round(handY)}`);
      }
    }
    assert.ok(positions.size >= 3, `${id} 的手臂几乎不动（仅 ${positions.size} 个落点）`);
  }
});

test('dig-treasure 在刨土阶段双爪扎向身前地面，宝箱翻出后收手', () => {
  const action = PET_ACTIONS['dig-treasure'];
  assert.equal(action.motion, 'dig', 'dig-treasure 必须走 dig 运动');

  // 刨土阶段（progress < 0.7）：左右两只脚掌式圆爪（mitten）都扎向身体下方的地面。
  const digging = petAnatomyArt.armPoses(action, 0.1, 'front');
  assert.equal(digging.length, 2, '刨土阶段应有左右两只手在挖');
  assert.ok(digging.every(pose => pose.style === 'mitten'), '挖掘用圆爪而非张开五指');
  assert.ok(digging.every(pose => pose.points.at(-1)[1] >= 54),
    '双爪落点应扎向身体下方的地面（y≥54）');
  assert.ok(digging.some(pose => pose.side === 'left') && digging.some(pose => pose.side === 'right'),
    '左右手各一只');

  // 翻出阶段（progress ≥ 0.7，含静态帧 staticProgress=0.75）：收手，让宝箱独占画面。
  assert.deepEqual(petAnatomyArt.armPoses(action, 0.8, 'front'), [], '宝箱翻出后不再画手臂');
  assert.deepEqual(petAnatomyArt.armPoses(action, action.staticProgress, 'front'), [],
    '静态帧（宝箱已翻出）不画手臂');

  // 侧身视角（dig 属于 profile 运动）仍保留朝向地面的那只挖掘爪。
  const profile = petAnatomyArt.armPoses(action, 0.1, 'profile');
  assert.equal(profile.length, 1, 'profile 只保留可见侧的一只挖掘爪');
  assert.ok(profile[0].points.at(-1)[1] >= 54, '侧身挖掘爪同样扎向地面');

  // 刨土有节奏：扫刨土阶段一圈，双爪落点应出现多个不同深度（交替下挖），不是死姿势。
  const depths = new Set();
  for (let index = 0; index < 24; index += 1) {
    const progress = (index / 24) * 0.7;
    for (const pose of petAnatomyArt.armPoses(action, progress, 'front')) {
      depths.add(Math.round(pose.points.at(-1)[1]));
    }
  }
  assert.ok(depths.size >= 3, `挖掘深度应随节奏变化，实际仅 ${depths.size} 种`);
});
