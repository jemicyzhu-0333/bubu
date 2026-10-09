'use strict';

import { VIEW_LAYOUTS } from '../content/companion/dango-body.mjs';

// I’m ADHDer 原创团子兽的活动脸：16 种眼形 + 9 种嘴形。
//
// mask 使用身体的 33×33 网格坐标（每格 = cell×cell 美术像素）：
//   - 眼形 5×5，锚在左眼 (7,10) / 右眼 (21,10)；
//   - 嘴形 7×4，锚在 (13,18)。
// 字符语义：'.' 透明，'X' 深色轮廓，'W' 小高光/口内，'A' 舌或强调色。
//
// 上一版用 6×6 眼和 9×5 嘴，并在 wide/surprised 中大面积反转黑白。
// 在 99 CSS px 身体上，它们会读成“白眼 + 张大嘴”，角色更像表情图标而不是宠物。
// 现在把五官收回幼态比例：大头身、小圆眼、低位小嘴和稳定光源。

const EYE_ANCHORS = VIEW_LAYOUTS.front.eyeAnchors;
const EYE_GRID_WIDTH = 5;
const EYE_GRID_HEIGHT = 5;

const MOUTH_ANCHOR = VIEW_LAYOUTS.front.mouthAnchor;
const MOUTH_GRID_WIDTH = 7;
const MOUTH_GRID_HEIGHT = 4;

// 圆眼统一使用深色眼球和左上角小高光。wide/surprised 也不再使用大面积白眼；
// 惊讶(surprised)走“圆瞳 + 左上 2 格高光”的呆萌路线：靠一块更大的高光把眼睛点亮，
// 再配小圆 O 嘴表达“被吓一跳”，而不是把眼睛铺成实心方块（那样读起来机械、像故障）。
const petFaceEyes = Object.freeze({
  neutral:   Object.freeze(['.XXX.', 'XWXXX', 'XXXXX', 'XXXXX', '.XXX.']),
  curious:   Object.freeze(['.XXX.', 'XWWXX', 'XXXXX', 'XXXWX', '.XXX.']),
  shy:       Object.freeze(['.XXX.', 'XXXXX', 'XXWXX', 'XXXXX', '.XXX.']),
  wide:      Object.freeze(['XXXXX', 'XWXXX', 'XXXXX', 'XXXXX', '.XXX.']),
  surprised: Object.freeze(['.XXX.', 'XWWXX', 'XWXXX', 'XXXXX', '.XXX.']),
  // 弧线末端向下、中心向上，读作笑眼 ⌒，不会读成皱眉。
  smile:     Object.freeze(['.....', '..X..', '.X.X.', 'X...X', '.....']),
  content:   Object.freeze(['.....', '.....', '.XXX.', 'X...X', '.....']),
  focused:   Object.freeze(['.....', '.....', 'XXXXX', 'XWXXX', '.XXX.']),
  half:      Object.freeze(['.....', '.....', '.....', 'XXXXX', '.XXX.']),
  closed:    Object.freeze(['.....', '.....', '.XXX.', '.....', '.....']),
  sleepy:    Object.freeze(['.....', '.....', '.....', '.XXX.', 'X...X']),
  // 低垂眼、恳求眼、坚定眼和星光眼扩宽情绪底层词汇，不再只靠嘴形区分。
  droopy:    Object.freeze(['XXXXX', 'XWXXX', '.XXX.', '..X..', '.....']),
  pleading:  Object.freeze(['.XXX.', 'XWXXX', 'XXXWX', 'XXXXX', '.XXX.']),
  determined: Object.freeze(['X...X', '.XXX.', 'XXXXX', 'XWXXX', '.XXX.']),
  sparkle:   Object.freeze(['..X..', '.XWX.', 'XWWWX', '.XWX.', '..X..']),
  // 等待感来自低垂上睑与靠内高光，眼球轮廓仍压在各自 5×5 区域中心；
  // 不能把整只眼睛右移，否则与居中的嘴组合后整张脸会读成歪斜。
  waiting:   Object.freeze(['.XXX.', 'XWXXX', 'XXXXX', 'XXXXX', '..X..'])
});

// 闭嘴类只占 1–2 行，张嘴类才使用完整 4 行。因此中性/专注不再长期带着
// “张嘴发呆”神情，开心/惊讶仍保留足够的幅度对比。
const petFaceMouths = Object.freeze({
  neutral:   Object.freeze(['.......', '..XXX..', '.......', '.......']),
  smile:     Object.freeze(['X.....X', '.X...X.', '..XXX..', '.......']),
  open:      Object.freeze(['.XXXXX.', 'XWWWWWX', '.XAAAX.', '..XXX..']),
  talk:      Object.freeze(['..XXX..', '..XWX..', '..XXX..', '.......']),
  surprised: Object.freeze(['.......', '..XXX..', '..XWX..', '..XXX..']),
  // 咀嚼用上下不等宽表达口型变化，但每一行都围绕嘴区中心列对齐。
  chew:      Object.freeze(['.......', '..XXX..', '.XAAAX.', '..XXX..']),
  closed:    Object.freeze(['.......', '.XXXXX.', '.......', '.......']),
  wavy:      Object.freeze(['.......', '.X...X.', '..X.X..', '...X...']),
  grin:      Object.freeze(['X.....X', '.XXXXX.', 'XWWWWWX', '.XXXXX.'])
});

const EYE_CHAR_ROLE = Object.freeze({ X: 'eye', W: 'highlight', A: 'accent' });
const MOUTH_CHAR_ROLE = Object.freeze({ X: 'outline', W: 'inner', A: 'accent' });

function validateFaceMasks() {
  for (const [name, grid] of Object.entries(petFaceEyes)) {
    if (!Array.isArray(grid) || grid.length !== EYE_GRID_HEIGHT) {
      throw new TypeError(`eye mask ${name} must be ${EYE_GRID_HEIGHT} rows`);
    }
    for (const row of grid) {
      if (typeof row !== 'string' || row.length !== EYE_GRID_WIDTH) {
        throw new TypeError(`eye mask ${name} rows must be ${EYE_GRID_WIDTH} chars`);
      }
      for (const ch of row) {
        if (!Object.prototype.hasOwnProperty.call(EYE_CHAR_ROLE, ch) && ch !== '.') {
          throw new TypeError(`eye mask ${name} has unknown char "${ch}"`);
        }
      }
    }
  }
  for (const [name, grid] of Object.entries(petFaceMouths)) {
    if (!Array.isArray(grid) || grid.length !== MOUTH_GRID_HEIGHT) {
      throw new TypeError(`mouth mask ${name} must be ${MOUTH_GRID_HEIGHT} rows`);
    }
    for (const row of grid) {
      if (typeof row !== 'string' || row.length !== MOUTH_GRID_WIDTH) {
        throw new TypeError(`mouth mask ${name} rows must be ${MOUTH_GRID_WIDTH} chars`);
      }
      for (const ch of row) {
        if (!Object.prototype.hasOwnProperty.call(MOUTH_CHAR_ROLE, ch) && ch !== '.') {
          throw new TypeError(`mouth mask ${name} has unknown char "${ch}"`);
        }
      }
    }
  }
  return Object.freeze({ eyeCount: Object.keys(petFaceEyes).length, mouthCount: Object.keys(petFaceMouths).length });
}

const FACE_MASK_STATS = Object.freeze(validateFaceMasks());

const petFaceApi = Object.freeze({
  EYE_MASKS: petFaceEyes,
  MOUTH_MASKS: petFaceMouths,
  EYE_ANCHORS,
  VIEW_LAYOUTS,
  EYE_GRID_WIDTH,
  EYE_GRID_HEIGHT,
  MOUTH_ANCHOR,
  MOUTH_GRID_WIDTH,
  MOUTH_GRID_HEIGHT,
  EYE_CHAR_ROLE,
  MOUTH_CHAR_ROLE,
  FACE_MASK_STATS,
  validateFaceMasks
});



export default petFaceApi;
export const EYE_MASKS = petFaceApi.EYE_MASKS;
export const MOUTH_MASKS = petFaceApi.MOUTH_MASKS;
export { VIEW_LAYOUTS, EYE_ANCHORS, EYE_GRID_WIDTH, EYE_GRID_HEIGHT, MOUTH_ANCHOR, MOUTH_GRID_WIDTH, MOUTH_GRID_HEIGHT, EYE_CHAR_ROLE, MOUTH_CHAR_ROLE, FACE_MASK_STATS, validateFaceMasks };
