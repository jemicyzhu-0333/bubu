'use strict';

// core/pet-face.js 的单测：16 眼形 / 9 嘴形像素 mask 的完整性、有界性，
// 以及与 pet-expression 白名单的一一对应。

const test = require('node:test');
const assert = require('node:assert/strict');

const petFace = require('../src/core/pet-face.mjs');
const petExpression = require('../src/core/pet-expression.mjs');
const petArt = require('../src/core/pet-art.mjs');
const { PET_ART } = require('../src/core/pet-stage.mjs');

const {
  EYE_MASKS,
  MOUTH_MASKS,
  EYE_ANCHORS,
  EYE_GRID_WIDTH,
  EYE_GRID_HEIGHT,
  MOUTH_ANCHOR,
  MOUTH_GRID_WIDTH,
  MOUTH_GRID_HEIGHT,
  EYE_CHAR_ROLE,
  MOUTH_CHAR_ROLE
} = petFace;

test('眼形恰好 16 种、嘴形恰好 9 种，且与表达白名单一一对应', () => {
  assert.equal(Object.keys(EYE_MASKS).length, 16);
  assert.equal(Object.keys(MOUTH_MASKS).length, 9);
  assert.deepEqual(Object.keys(EYE_MASKS).sort(), [...petExpression.EYE_MASKS].sort());
  assert.deepEqual(Object.keys(MOUTH_MASKS).sort(), [...petExpression.MOUTH_MASKS].sort());
});

test('眼形 mask 是 5×5 正方网格，字符全部已知', () => {
  // 正方形是刻意的：扁网格画出来的眼睛会读成“眯眼/凶”，而不是圆润。
  assert.equal(EYE_GRID_WIDTH, 5);
  assert.equal(EYE_GRID_HEIGHT, 5);
  assert.equal(EYE_GRID_WIDTH, EYE_GRID_HEIGHT);
  for (const [name, grid] of Object.entries(EYE_MASKS)) {
    assert.equal(grid.length, EYE_GRID_HEIGHT, `${name} 行数`);
    for (const row of grid) {
      assert.equal(row.length, EYE_GRID_WIDTH, `${name} 列数`);
      for (const ch of row) {
        assert.ok(ch === '.' || EYE_CHAR_ROLE[ch], `${name} 含未知字符 "${ch}"`);
      }
    }
  }
});

test('嘴形 mask 为等宽等高网格，字符全部已知', () => {
  assert.equal(MOUTH_GRID_WIDTH, 7);
  assert.equal(MOUTH_GRID_HEIGHT, 4);
  for (const [name, grid] of Object.entries(MOUTH_MASKS)) {
    assert.equal(grid.length, MOUTH_GRID_HEIGHT, `${name} 行数`);
    for (const row of grid) {
      assert.equal(row.length, MOUTH_GRID_WIDTH, `${name} 列数`);
      for (const ch of row) {
        assert.ok(ch === '.' || MOUTH_CHAR_ROLE[ch], `${name} 含未知字符 "${ch}"`);
      }
    }
  }
});

test('眼形互不相同、嘴形互不相同', () => {
  const eyeKeys = Object.values(EYE_MASKS).map(grid => grid.join('/'));
  assert.equal(new Set(eyeKeys).size, eyeKeys.length, '眼形必须可区分');
  const mouthKeys = Object.values(MOUTH_MASKS).map(grid => grid.join('/'));
  assert.equal(new Set(mouthKeys).size, mouthKeys.length, '嘴形必须可区分');
});

test('五官比例受约束：眼睛不许再去抢身体和嘴的地盘', () => {
  // 这条断言是一次真实退化的化石。眼形曾经只有 3×3，为了让 32 个动作彼此可辨，
  // 唯一的手段就是把眼睛摊大到 5×4 —— 单眼占到身宽 22%、双眼将近一半，而嘴还
  // 留在 5×3。看上去就是“眼睛巨大、身体和嘴都小了”。
  //
  // 真正的解法是提高分辨率而不是放大形状：身体网格从 22 格变成 33 格之后，单眼
  // 占比降回 18%，可用格子反而从 9 涨到 36。所以这里钉住的是比例关系，不是尺寸
  // 本身 —— 谁想再靠“把眼睛画大”来提升辨识度，会在这里失败。
  assert.ok(EYE_GRID_WIDTH / PET_ART.columns <= 0.2,
    `单眼占身宽 ${(EYE_GRID_WIDTH / PET_ART.columns * 100).toFixed(1)}%，超过 20% 就会压掉其他五官`);
  assert.ok(MOUTH_GRID_WIDTH > EYE_GRID_WIDTH,
    '嘴必须比单只眼睛宽，否则五官读起来是失衡的');

  // 两眼之间必须留出比单眼更宽的间距，否则五官会挤成一团。
  const eyeGap = EYE_ANCHORS.right.gridX - (EYE_ANCHORS.left.gridX + EYE_GRID_WIDTH);
  assert.ok(eyeGap >= EYE_GRID_WIDTH, `两眼间距 ${eyeGap} 格不应小于单眼宽 ${EYE_GRID_WIDTH} 格`);
});

test('眼与嘴的每一格都落在身体实心像素上，不越出轮廓', () => {
  const { columns, rows } = PET_ART;
  // 上界从 PET_ART 推导，不写字面量：网格尺寸变了这里要跟着动，
  // 而写死的 22 只会在改分辨率时静默失效。
  for (const anchor of [EYE_ANCHORS.left, EYE_ANCHORS.right]) {
    assert.ok(anchor.gridX >= 0 && anchor.gridX + EYE_GRID_WIDTH <= columns);
    assert.ok(anchor.gridY >= 0 && anchor.gridY + EYE_GRID_HEIGHT <= rows);
  }
  assert.ok(MOUTH_ANCHOR.gridX >= 0 && MOUTH_ANCHOR.gridX + MOUTH_GRID_WIDTH <= columns);
  assert.ok(MOUTH_ANCHOR.gridY >= 0 && MOUTH_ANCHOR.gridY + MOUTH_GRID_HEIGHT <= rows);

  // 在网格内还不够：身体是圆的，四角是空的。眼睛如果落到透明区，
  // 会在身体外面凭空出现一块深色，而那在小尺寸下很容易被当成“脸歪了”。
  const body = petArt.MONSTER_GRID;
  const solid = (x, y) => {
    const row = body[y];
    return typeof row === 'string' ? row[x] !== '.' && row[x] !== ' ' : false;
  };
  for (const anchor of [EYE_ANCHORS.left, EYE_ANCHORS.right]) {
    for (let y = anchor.gridY; y < anchor.gridY + EYE_GRID_HEIGHT; y += 1) {
      for (let x = anchor.gridX; x < anchor.gridX + EYE_GRID_WIDTH; x += 1) {
        assert.ok(solid(x, y), `眼睛格 (${x},${y}) 必须落在身体上`);
      }
    }
  }
  for (let y = MOUTH_ANCHOR.gridY; y < MOUTH_ANCHOR.gridY + MOUTH_GRID_HEIGHT; y += 1) {
    for (let x = MOUTH_ANCHOR.gridX; x < MOUTH_ANCHOR.gridX + MOUTH_GRID_WIDTH; x += 1) {
      assert.ok(solid(x, y), `嘴格 (${x},${y}) 必须落在身体上`);
    }
  }
});

test('五官关于身体中心线左右对称', () => {
  const { columns } = PET_ART;
  // 两眼互为镜像，否则整张脸看起来是偏的。
  assert.equal(EYE_ANCHORS.left.gridX, columns - (EYE_ANCHORS.right.gridX + EYE_GRID_WIDTH));
  assert.equal(EYE_ANCHORS.left.gridY, EYE_ANCHORS.right.gridY);
  // 嘴的中心必须压在身体中心线上。
  assert.equal(MOUTH_ANCHOR.gridX + MOUTH_GRID_WIDTH / 2, columns / 2);

  // 锚点居中不代表实际墨迹居中。waiting/chew 曾经分别向右、向左偏，
  // 两者组合后在 Retina 截图上相差约 9 设备像素，但旧测试仍会通过。
  const assertRowsCentered = (masks, width, kind) => {
    const expectedCenter = (width - 1) / 2;
    for (const [name, grid] of Object.entries(masks)) {
      grid.forEach((row, rowIndex) => {
        const columns = [...row]
          .map((glyph, column) => glyph === '.' ? null : column)
          .filter(column => column !== null);
        if (columns.length === 0) return;
        const center = columns.reduce((sum, column) => sum + column, 0) / columns.length;
        assert.equal(center, expectedCenter, `${kind} ${name} 第 ${rowIndex} 行墨迹偏离中心`);
      });
    }
  };
  assertRowsCentered(EYE_MASKS, EYE_GRID_WIDTH, '眼形');
  assertRowsCentered(MOUTH_MASKS, MOUTH_GRID_WIDTH, '嘴形');
});

test('身体网格自身是 33×33 且严格左右镜像', () => {
  const body = petArt.MONSTER_GRID;
  assert.equal(body.length, PET_ART.rows);
  for (const [y, row] of body.entries()) {
    assert.equal(row.length, PET_ART.columns, `身体第 ${y} 行列数`);
    assert.equal(row, [...row].reverse().join(''), `身体第 ${y} 行必须左右镜像`);
  }
});

test('validateFaceMasks 通过且统计正确', () => {
  const stats = petFace.validateFaceMasks();
  assert.equal(stats.eyeCount, 16);
  assert.equal(stats.mouthCount, 9);
});
