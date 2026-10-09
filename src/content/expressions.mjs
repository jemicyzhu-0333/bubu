'use strict';

const focusPixExpressionsApi = (() => {

// I’m ADHDer 的 32 套原创像素表情配置。
//
// 这是语义合同，不是对任何上游项目编号或视觉数据的翻译。每一项都是闭合、
// 有限、可验证的纯数据：不引用 DOM、不使用计时器、不产生随机数、不写业务
// 状态。本文件提供完整的语义、静态位姿、进入与循环策略，
// 供 core/pet-expression.mjs 校验与采样；实际绘制由形态画笔负责。
//
// 分组数量：life 8、work 10、react 8、system 6，合计恰好 32，且全部唯一。

// 默认眨眼：温和、不频繁。
const CALM_BLINK = Object.freeze({ minMs: 3600, maxMs: 7200, doubleChance: 0.08 });
const SOFT_BLINK = Object.freeze({ minMs: 2800, maxMs: 6000, doubleChance: 0.06 });
const QUIET_BLINK = Object.freeze({ minMs: 4800, maxMs: 8800, doubleChance: 0.04 });

function expr(spec) {
  return Object.freeze({
    id: spec.id,
    group: spec.group,
    label: spec.label,
    accent: spec.accent || 'none',
    face: Object.freeze(Object.assign({
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      eyeInsetX: 0,
      openness: 1
    }, spec.face)),
    body: Object.freeze(Object.assign({
      tone: 'normal',
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotateDeg: 0
    }, spec.body)),
    blink: Object.freeze(spec.blink || CALM_BLINK),
    loops: Object.freeze(spec.loops || []),
    enter: Object.freeze(spec.enter || { durationMs: 0 }),
    static: Object.freeze({
      face: Object.freeze({
        eyes: spec.static && spec.static.eyes ? spec.static.eyes : spec.face.eyes,
        mouth: spec.static && spec.static.mouth ? spec.static.mouth : spec.face.mouth
      })
    })
  });
}

const EXPRESSIONS = Object.freeze([
  // ---------- 生命周期（8） ----------
  expr({
    id: 'life.idle', group: 'life', label: '普通待机',
    face: { eyes: 'neutral', mouth: 'neutral', gaze: { enabled: true, maxX: 2, maxY: 1 } },
    // 待机眨眼沿用 0.1.2 调好的节奏（约 667–2333ms 一次），保证帧率无关迁移后观感不变。
    blink: Object.freeze({ minMs: 667, maxMs: 2333, doubleChance: 0.08 }),
    loops: [{ primitive: 'breath', amplitude: 1, periodMs: 3200 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'life.wake', group: 'life', label: '启动或睡眠恢复',
    face: { eyes: 'half', mouth: 'neutral' },
    body: { y: -1 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 420, frames: [
      { atMs: 0, y: 2, scaleY: 0.94 },
      { atMs: 200, y: 0, scaleY: 1 }
    ] }
  }),
  expr({
    id: 'life.sleep', group: 'life', label: '深夜或主动睡眠',
    face: { eyes: 'closed', mouth: 'closed', openness: 0 },
    accent: 'sleep-zzz',
    body: { y: 2, scaleY: 0.96 },
    blink: QUIET_BLINK,
    loops: [{ primitive: 'breath', amplitude: 0.6, periodMs: 4200 }],
    enter: { durationMs: 0 },
    static: { eyes: 'closed', mouth: 'closed' }
  }),
  expr({
    id: 'life.drowsy', group: 'life', label: '夜间待机或打哈欠',
    face: { eyes: 'droopy', mouth: 'wavy', openness: 0.45 },
    accent: 'drowsy-zzz',
    body: { y: 2, scaleX: 0.98, scaleY: 0.95 },
    blink: { minMs: 1800, maxMs: 3600, doubleChance: 0.2 },
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'life.space', group: 'life', label: '安静发呆',
    face: { eyes: 'neutral', mouth: 'talk', eyeOffsetX: 1 },
    blink: QUIET_BLINK,
    // 发呆时目光游移 + 身体轻轻摇摆（sway 走旋转通道，驱动身体的 tilt）。
    loops: [
      { primitive: 'look-around', amplitude: 0.8, periodMs: 5200 },
      { primitive: 'sway', amplitude: 1, periodMs: 3400 }
    ],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'life.peek', group: 'life', label: '吸附后探头',
    face: { eyes: 'curious', mouth: 'neutral', gaze: { enabled: true, maxX: 2, maxY: 0 } },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 260 }
  }),
  expr({
    id: 'life.return', group: 'life', label: '中断后回到任务',
    face: { eyes: 'focused', mouth: 'smile' },
    body: { y: -1 },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 360, frames: [
      { atMs: 0, y: 1 },
      { atMs: 180, y: -1 }
    ] }
  }),
  expr({
    id: 'life.attentive', group: 'life', label: '用户靠近或准备互动',
    face: { eyes: 'wide', mouth: 'neutral', openness: 1, gaze: { enabled: true, maxX: 2, maxY: 1 } },
    body: { scaleX: 1.04, scaleY: 1.04 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 200 }
  }),

  // ---------- 执行（10） ----------
  expr({
    id: 'work.ready', group: 'work', label: '已选 Now 尚未启动',
    face: { eyes: 'determined', mouth: 'closed' },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'work.starting', group: 'work', label: '两分钟启动或会话进入',
    face: { eyes: 'curious', mouth: 'closed' },
    body: { y: -1, scaleX: 1.02 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 380 }
  }),
  expr({
    id: 'work.focus', group: 'work', label: '正常专注会话',
    face: { eyes: 'focused', mouth: 'neutral' },
    blink: QUIET_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'work.deep-focus', group: 'work', label: '长时间持续专注',
    face: { eyes: 'half', mouth: 'closed', openness: 0.7 },
    blink: QUIET_BLINK,
    loops: [{ primitive: 'breath', amplitude: 0.5, periodMs: 4400 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'work.pause', group: 'work', label: '会话暂停',
    face: { eyes: 'sleepy', mouth: 'talk' },
    body: { scaleY: 0.97 },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 300 }
  }),
  expr({
    id: 'work.resume', group: 'work', label: '暂停后继续',
    face: { eyes: 'wide', mouth: 'smile' },
    body: { y: -1 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 320, frames: [
      { atMs: 0, y: 1, scaleY: 0.96 },
      { atMs: 160, y: -1, scaleY: 1 }
    ] }
  }),
  expr({
    id: 'work.rest', group: 'work', label: '休息会话',
    face: { eyes: 'content', mouth: 'smile' },
    blink: CALM_BLINK,
    loops: [{ primitive: 'breath', amplitude: 0.9, periodMs: 3800 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'work.switch', group: 'work', label: '用户明确切换任务',
    face: { eyes: 'curious', mouth: 'talk', eyeOffsetX: 1 },
    blink: SOFT_BLINK,
    loops: [{ primitive: 'look-around', amplitude: 1, periodMs: 2400 }],
    enter: { durationMs: 300 }
  }),
  expr({
    id: 'work.waiting', group: 'work', label: '等待用户确认落点或方案',
    face: { eyes: 'waiting', mouth: 'neutral', gaze: { enabled: true, maxX: 2, maxY: 1 } },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 0 },
    static: { eyes: 'waiting', mouth: 'neutral' }
  }),
  expr({
    id: 'work.wrap-up', group: 'work', label: '收尾或启动回顾',
    face: { eyes: 'focused', mouth: 'talk', eyeOffsetX: -1 },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),

  // ---------- 互动（8） ----------
  expr({
    id: 'react.happy', group: 'react', label: '普通点击或击掌',
    face: { eyes: 'smile', mouth: 'open' },
    blink: SOFT_BLINK,
    loops: [{ primitive: 'beat', amplitude: 1, periodMs: 1200 }],
    enter: { durationMs: 240 }
  }),
  expr({
    id: 'react.satisfied', group: 'react', label: '喂食、放下或完成一步',
    face: { eyes: 'content', mouth: 'closed' },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 280 }
  }),
  expr({
    id: 'react.surprised', group: 'react', label: '拿起、拖动或意外彩蛋',
    // 被拿起/拖动时的“呆萌惊讶”：圆瞳 + 大高光 + 小圆 O 嘴 + 眼睛微微上抬看向被捏的点；
    // 拖动时眼睛还会看向拖动方向（由渲染器用拖动速度驱动注视目标）。
    face: { eyes: 'surprised', mouth: 'surprised', openness: 1, eyeOffsetY: -1, gaze: { enabled: true, maxX: 3, maxY: 1 } },
    body: { scaleY: 1.05 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 180 }
  }),
  expr({
    id: 'react.petted', group: 'react', label: '长按抚摸',
    face: { eyes: 'shy', mouth: 'smile' },
    body: { scaleX: 1.03, scaleY: 0.98 },
    blink: SOFT_BLINK,
    loops: [{ primitive: 'breath', amplitude: 1.2, periodMs: 2200 }],
    enter: { durationMs: 300 }
  }),
  expr({
    id: 'react.encouraging', group: 'react', label: '请求策略或重新开始',
    face: { eyes: 'smile', mouth: 'smile' },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'react.hungry', group: 'react', label: '宠物饱食度低',
    face: { eyes: 'pleading', mouth: 'wavy', eyeInsetX: 2, eyeOffsetY: -1 },
    body: { y: 1, scaleX: 0.94, scaleY: 1.03 },
    blink: { minMs: 2200, maxMs: 4200, doubleChance: 0.18 },
    loops: [{ primitive: 'breath', amplitude: 1, periodMs: 2600 }],
    enter: { durationMs: 220 },
    static: { eyes: 'pleading', mouth: 'wavy' }
  }),
  expr({
    id: 'react.relieved', group: 'react', label: '主动结束或暂停后',
    face: { eyes: 'content', mouth: 'open' },
    blink: CALM_BLINK,
    loops: [{ primitive: 'breath', amplitude: 1, periodMs: 3400 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'react.celebrate', group: 'react', label: '已提交的完成事实',
    face: { eyes: 'sparkle', mouth: 'grin' },
    body: { y: -2 },
    blink: SOFT_BLINK,
    loops: [{ primitive: 'beat', amplitude: 1.4, periodMs: 900 }],
    enter: { durationMs: 260 },
    static: { eyes: 'sparkle', mouth: 'grin' }
  }),

  // ---------- 系统（6） ----------
  expr({
    id: 'system.thinking', group: 'system', label: '本地策略选择或拆解准备',
    face: { eyes: 'focused', mouth: 'open', eyeOffsetY: -1 },
    blink: SOFT_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'system.searching', group: 'system', label: '确有检索或读取步骤',
    face: { eyes: 'curious', mouth: 'smile' },
    blink: SOFT_BLINK,
    loops: [{ primitive: 'look-around', amplitude: 1.2, periodMs: 1600 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'system.processing', group: 'system', label: 'AI 拆解请求进行中',
    face: { eyes: 'waiting', mouth: 'closed' },
    blink: CALM_BLINK,
    loops: [{ primitive: 'beat', amplitude: 0.7, periodMs: 1400 }],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'system.unavailable', group: 'system', label: 'Provider 或能力明确不可用',
    face: { eyes: 'sleepy', mouth: 'neutral' },
    blink: QUIET_BLINK,
    loops: [],
    enter: { durationMs: 0 },
    static: { eyes: 'sleepy', mouth: 'neutral' }
  }),
  expr({
    id: 'system.restricted', group: 'system', label: '等待授权或策略门禁',
    face: { eyes: 'surprised', mouth: 'neutral', gaze: { enabled: true, maxX: 2, maxY: 1 } },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 0 }
  }),
  expr({
    id: 'system.stopped', group: 'system', label: '用户取消或中止请求',
    face: { eyes: 'closed', mouth: 'neutral' },
    blink: CALM_BLINK,
    loops: [],
    enter: { durationMs: 220 }
  })
]);

const EXPECTED_GROUP_COUNTS = Object.freeze({ life: 8, work: 10, react: 8, system: 6 });
const EXPECTED_TOTAL = 32;
const EXPECTED_EXPRESSION_IDS = Object.freeze([
  'life.idle', 'life.wake', 'life.sleep', 'life.drowsy', 'life.space', 'life.peek',
  'life.return', 'life.attentive',
  'work.ready', 'work.starting', 'work.focus', 'work.deep-focus', 'work.pause',
  'work.resume', 'work.rest', 'work.switch', 'work.waiting', 'work.wrap-up',
  'react.happy', 'react.satisfied', 'react.surprised', 'react.petted',
  'react.encouraging', 'react.hungry', 'react.relieved', 'react.celebrate',
  'system.thinking', 'system.searching', 'system.processing', 'system.unavailable',
  'system.restricted', 'system.stopped'
]);

// 打包校验：恰好 32 个、全部唯一、分组数量符合合同。失败抛错，供启动与测试使用。
function assertExpressionLibrary(expressions = EXPRESSIONS) {
  const ids = expressions.map(item => item.id);
  if (ids.length !== EXPECTED_TOTAL) {
    throw new RangeError(`expression library must contain exactly ${EXPECTED_TOTAL} entries, got ${ids.length}`);
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new RangeError('expression ids must be unique');
  const expected = new Set(EXPECTED_EXPRESSION_IDS);
  if (ids.some(id => !expected.has(id)) || EXPECTED_EXPRESSION_IDS.some(id => !unique.has(id))) {
    throw new RangeError('expression id contract must match the documented 32 semantic IDs');
  }
  const groupCounts = {};
  for (const item of expressions) {
    if (item.group !== item.id.split('.')[0]) {
      throw new TypeError(`expression ${item.id} group does not match its namespace`);
    }
    groupCounts[item.group] = (groupCounts[item.group] || 0) + 1;
  }
  for (const [group, count] of Object.entries(EXPECTED_GROUP_COUNTS)) {
    if (groupCounts[group] !== count) {
      throw new RangeError(`expression group "${group}" must contain ${count} entries, got ${groupCounts[group] || 0}`);
    }
  }
  return Object.freeze({
    total: ids.length,
    groupCounts: Object.freeze({ ...groupCounts })
  });
}

const EXPRESSION_LIBRARY_STATS = Object.freeze(assertExpressionLibrary());

return Object.freeze({
  EXPRESSIONS,
  EXPECTED_TOTAL,
  EXPECTED_GROUP_COUNTS,
  EXPECTED_EXPRESSION_IDS,
  assertExpressionLibrary,
  EXPRESSION_LIBRARY_STATS
});

})();

export default focusPixExpressionsApi;
export const EXPRESSIONS = focusPixExpressionsApi.EXPRESSIONS;
export const EXPECTED_TOTAL = focusPixExpressionsApi.EXPECTED_TOTAL;
export const EXPECTED_GROUP_COUNTS = focusPixExpressionsApi.EXPECTED_GROUP_COUNTS;
export const EXPECTED_EXPRESSION_IDS = focusPixExpressionsApi.EXPECTED_EXPRESSION_IDS;
export const assertExpressionLibrary = focusPixExpressionsApi.assertExpressionLibrary;
export const EXPRESSION_LIBRARY_STATS = focusPixExpressionsApi.EXPRESSION_LIBRARY_STATS;
