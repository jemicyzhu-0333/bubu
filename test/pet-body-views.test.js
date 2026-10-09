'use strict';

// 四视图身体网格的几何契约。这道护栏防止两类回归：
//   ① three-quarter 退回“正面克隆”（历史上它只是 front 缩 0.94，几乎和正面一样）；
//   ② profile 退回“压扁的正面单眼球”（不是真正侧身）。
// 契约：front 关于 x=16 严格镜像；three-quarter 与 profile 是非镜像的“转身/侧身”，
// 且三者互不相同；所有视图都是 33×33、只用已知字形。

const test = require('node:test');
const assert = require('node:assert/strict');

const { BODY_VARIANTS } = require('../src/core/pet-art.mjs');

const VIEWS = ['front', 'three-quarter', 'profile', 'back'];
const isMirrored = grid => grid.every(row => [...row].every((ch, x) => ch === row[32 - x]));
const asText = grid => grid.join('\n');
const span = (grid, y) => {
  const xs = [...grid[y]].map((ch, x) => (ch !== '.' ? x : -1)).filter(x => x >= 0);
  return xs.length ? [xs[0], xs[xs.length - 1]] : null;
};
const width = (grid, y) => {
  const s = span(grid, y);
  return s ? s[1] - s[0] + 1 : 0;
};
const topRowOf = (grid, fromX, toX) => {
  for (let y = 0; y < 33; y += 1) {
    for (let x = fromX; x <= toX; x += 1) if (grid[y][x] !== '.') return y;
  }
  return -1;
};

test('每个视图身体网格都是 33×33，且只用已知字形', () => {
  for (const view of VIEWS) {
    const grid = BODY_VARIANTS[view];
    assert.ok(Array.isArray(grid), `${view} 变体应存在`);
    assert.equal(grid.length, 33, `${view} 应为 33 行`);
    for (const row of grid) {
      assert.equal(row.length, 33, `${view} 每行应为 33 列`);
      assert.ok([...row].every(ch => '.1234'.includes(ch)), `${view} 只允许 .1234 字形`);
    }
  }
});

test('front 严格镜像；three-quarter 与 profile 是非镜像的转身/侧身', () => {
  assert.ok(isMirrored(BODY_VARIANTS.front), 'front 应关于 x=16 严格镜像');
  assert.ok(!isMirrored(BODY_VARIANTS['three-quarter']), 'three-quarter 应为非镜像（真正转身）');
  assert.ok(!isMirrored(BODY_VARIANTS.profile), 'profile 应为非镜像（真正侧身）');
});

test('转身/侧身/背面都不是正面的克隆，且侧身不同于三分之四', () => {
  const front = asText(BODY_VARIANTS.front);
  assert.notEqual(asText(BODY_VARIANTS['three-quarter']), front, 'three-quarter 不应等于 front');
  assert.notEqual(asText(BODY_VARIANTS.profile), front, 'profile 不应等于 front');
  assert.notEqual(asText(BODY_VARIANTS.back), front, 'back 不应等于 front');
  assert.notEqual(
    asText(BODY_VARIANTS.profile),
    asText(BODY_VARIANTS['three-quarter']),
    'profile 与 three-quarter 应不同'
  );
});

test('转身轮廓不得被“压扁”：yaw 旋转几乎不改变圆身体的轮廓宽度', () => {
  // 旧实现把正面 sprite 的远侧横向压缩 0.52 当作转身，于是三分之四只剩 ~0.76 宽，
  // 读起来是“被踩扁的正面”而不是转身。离线 3D 模型实测：椭球身体做 yaw 旋转时
  // 轮廓宽度比 = 三分之四 0.963、侧身 0.86。所以“转身”必须靠明暗/耳朵/五官位置表达。
  const front = BODY_VARIANTS.front;
  const tq = BODY_VARIANTS['three-quarter'];
  const profile = BODY_VARIANTS.profile;
  const row = 12;   // 腿腰最宽处，且高于尾巴，不会被尾巴拉宽
  const frontWidth = width(front, row);
  assert.equal(frontWidth, 33, '正面应在该行撑满 33 列');
  assert.ok(width(tq, row) / frontWidth >= 0.88,
    `三分之四轮廓应接近正面宽度（实测 ${width(tq, row)}/${frontWidth}），不得退回压扁写法`);
  assert.ok(width(profile, row) / frontWidth >= 0.72,
    `侧身轮廓不得窄于 0.72（实测 ${width(profile, row)}/${frontWidth}）`);
  assert.ok(width(profile, row) < width(tq, row),
    '侧身看的是较浅的深度轴，应比三分之四窄');
});

test('three-quarter 远耳在右侧：只从头顶探出、更小且全为暗部', () => {
  // 几何依据（离线 3D 模型，32°）：左耳 z'=+0.35 朝向镜头，右耳 z'=-0.34 已转到
  // 身体后面。所以远耳是右边那只：起点更低、面积更小、没有亮色填充。
  const grid = BODY_VARIANTS['three-quarter'];
  const nearTop = topRowOf(grid, 0, 15);
  const farTop = topRowOf(grid, 17, 32);
  assert.equal(nearTop, 0, '近耳（左）应顶到第 0 行');
  assert.ok(farTop > nearTop, `远耳（右）应低于近耳（实测 near=${nearTop} far=${farTop}）`);

  let nearCells = 0, farCells = 0, farBright = 0;
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 16; x += 1) if (grid[y][x] !== '.') nearCells += 1;
    for (let x = 17; x < 33; x += 1) {
      if (grid[y][x] !== '.') farCells += 1;
      if (grid[y][x] === '2') farBright += 1;
    }
  }
  assert.ok(farCells > 0, '远耳应仍然可见（从头顶探出一撮）');
  assert.ok(farCells < nearCells, `远耳应小于近耳（实测 far=${farCells} near=${nearCells}）`);
  assert.equal(farBright, 0, '远耳不得有亮色填充，否则不读作“转到身体后面”');
});

test('three-quarter 后退的是左侧腰身（而不是右侧）', () => {
  // 深度实测：脸 z'=+0.89（最近，已摆向右）、左侧身体边缘 z'=+0.15（掠射）。
  // 所以大面积后退的是左侧 —— 尽管被挡住的耳朵在右侧。两者不同侧，别拍脑袋改。
  const grid = BODY_VARIANTS['three-quarter'];
  for (let y = 12; y <= 20; y += 1) {
    const [left, right] = span(grid, y);
    assert.equal(grid[y][left + 1], '3', `第 ${y} 行左轮廓内侧应为暗部（后退侧）`);
    assert.equal(grid[y][right - 1], '2', `第 ${y} 行右轮廓内侧应仍为亮色（脸所在的近侧）`);
  }
});

test('profile 尾巴在身后探出，且耳朵落在头上不悬空', () => {
  const grid = BODY_VARIANTS.profile;
  // 尾巴：腰部后方（左）探出到贴近第 0 列，而头部那几行仍缩在里面。
  const tailRows = [19, 20, 21].map(y => span(grid, y)[0]);
  const headRows = [10, 11, 12].map(y => span(grid, y)[0]);
  assert.ok(Math.min(...tailRows) <= 1, `尾巴应探出到左缘（实测 ${Math.min(...tailRows)}）`);
  assert.ok(Math.min(...headRows) >= 3, `头部不应与尾巴同宽（实测 ${Math.min(...headRows)}）`);
  // 耳朵必须一直长到头顶：耳区每一行都不能是空行，否则耳朵会读成飘在头上方的色块。
  const headTop = topRowOf(grid, 0, 32);
  for (let y = headTop; y <= 6; y += 1) {
    assert.ok(span(grid, y), `第 ${y} 行不得为空，否则耳朵与头之间出现空隙`);
  }
});

// 脚部契约。旧的手绘稿在这里出了两类错：三分之四把两只脚做成 11 对 5 格并在近脚里
// 多出一段暗台阶（底部读成三个形状）；profile 把后脚做成尾巴底下一个距前脚四格远的小桩。
const footRuns = (grid, y) => {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= 33; x += 1) {
    const solid = x < 33 && grid[y][x] !== '.';
    if (solid && start < 0) start = x;
    if (!solid && start >= 0) { runs.push({ from: start, to: x - 1, width: x - start }); start = -1; }
  }
  return runs;
};

test('每个视图的底部都是两只可识别的脚，而不是一块大板加一个小桩', () => {
  for (const view of ['front', 'three-quarter', 'profile']) {
    const grid = BODY_VARIANTS[view];
    // 在脚缝所在的行（第 29 行）应恰好分成两段，且两段宽度不得相差超过 1.6 倍。
    const runs = footRuns(grid, 29);
    assert.equal(runs.length, 2, `${view} 第 29 行应恰好是两只脚（实测 ${runs.length} 段）`);
    const [near, far] = runs[0].width >= runs[1].width ? runs : [runs[1], runs[0]];
    assert.ok(
      near.width / far.width <= 1.6,
      `${view} 两只脚宽度比 ${near.width}:${far.width} 太悬殊，会读成大板加小桩`
    );
    // 脚缝已经分开之后的行（29–30），一只脚内部不得再出现轮廓墙：同一段轮廓里出现两块
    // 被轮廓隔开的主体，就会读成额外的形状（旧三分之四就是这样在近脚里夹出一颗孤立粉色
    // 像素块）。第 28 行不在这个范围内 —— 那里的内部轮廓正是脚缝的上沿，是合法的。
    for (let y = 29; y <= 30; y += 1) {
      for (const { from, to } of footRuns(grid, y)) {
        let fillSegments = 0;
        for (let x = from; x <= to; x += 1) {
          const isFill = grid[y][x] === '2' || grid[y][x] === '3';
          const prevWasFill = x > from && (grid[y][x - 1] === '2' || grid[y][x - 1] === '3');
          if (isFill && !prevWasFill) fillSegments += 1;
        }
        assert.ok(
          fillSegments <= 1,
          `${view} 第 ${y} 行 ${from}-${to} 这只脚内部有轮廓墙（${fillSegments} 块被隔开的主体）`
        );
      }
    }
  }
});

test('转身时脚缝移向朝向侧，近脚（左）不小于远脚（右）', () => {
  // 双脚在 z>0，做 yaw 旋转后整对向右移，同时远脚因进一步远离而略小。
  const frontRuns = footRuns(BODY_VARIANTS.front, 29);
  const tqRuns = footRuns(BODY_VARIANTS['three-quarter'], 29);
  const gapOf = runs => (runs[0].to + runs[1].from) / 2;
  assert.ok(
    gapOf(tqRuns) > gapOf(frontRuns),
    `转身后脚缝应右移（front ${gapOf(frontRuns)} → 3/4 ${gapOf(tqRuns)}）`
  );
  assert.ok(
    tqRuns[0].width >= tqRuns[1].width,
    `近脚（左，${tqRuns[0].width}）不得小于远脚（右，${tqRuns[1].width}）`
  );
});

test('profile 双脚是前后站姿：后脚在后且脚底高一行', () => {
  const grid = BODY_VARIANTS.profile;
  const bottomOf = (fromX, toX) => {
    for (let y = 32; y >= 0; y -= 1) {
      for (let x = fromX; x <= toX; x += 1) if (grid[y][x] !== '.') return y;
    }
    return -1;
  };
  const [rear, frontFoot] = footRuns(grid, 29);
  assert.ok(rear.to < frontFoot.from, '后脚应在前脚之后（朝右）');
  assert.ok(
    bottomOf(rear.from, rear.to) < bottomOf(frontFoot.from, frontFoot.to),
    '后脚的脚底应比前脚高一行，才读作站在远处'
  );
  // 尾巴下方（x ≤ 8）不得再出现独立的脚形：那是旧版那个读作假腿的小桩。
  for (let y = 29; y <= 30; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      assert.equal(grid[y][x], '.', `profile 第 ${y} 行第 ${x} 列应为空（尾巴下不能有小桩）`);
    }
  }
});
