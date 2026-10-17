'use strict';

// Presentation-only story beats. Existing session durations (30–48 seconds)
// remain the timing authority; no timer, reward or persisted state is added.
// The source activity also owns its view: changing tools never snaps the silhouette.
function sequence(stages, hold = 0.5) {
  return Object.freeze({ hold, stages: Object.freeze(stages.map(([until, label, motion, prop, expression, cycles = 1]) =>
    Object.freeze({ until, label, motion, prop, expression, cycles }))) });
}
const COMPANION_ACTIVITY_STORIES = Object.freeze({
  'focus-read': sequence([
    [.12, '翻开书页', 'organize', 'book', 'work.starting'],
    [.42, '逐行阅读', 'read', 'book', 'work.focus', 3],
    [.55, '记下发现', 'write', 'document', 'work.wrap-up'],
    [.84, '回看书页', 'read', 'book', 'work.focus', 3],
    [1, '捧着书歇会', 'breathe', 'book', 'react.satisfied']
  ]),
  'focus-type': sequence([
    [.12, '想好第一句', 'daydream', 'keyboard', 'work.starting'],
    [.38, '左手起稿', 'type', 'keyboard', 'work.focus', 3],
    [.50, '停下校对', 'browse', 'laptop', 'work.switch'],
    [.82, '继续输入', 'type', 'keyboard', 'work.deep-focus', 3],
    [1, '检查并收好', 'organize', 'notes', 'react.satisfied']
  ]),
  'focus-write': sequence([
    [.12, '摊开纸张', 'organize', 'document', 'work.starting'],
    [.28, '想一想', 'daydream', 'document', 'life.space'],
    [.52, '写下第一段', 'write', 'document', 'work.focus', 3],
    [.64, '回读一遍', 'read', 'document', 'work.switch'],
    [.86, '补上细节', 'write', 'document', 'work.deep-focus', 2],
    [1, '整理完成', 'organize', 'notes', 'react.satisfied']
  ]),
  'focus-browse': sequence([
    [.14, '打开小电脑', 'organize', 'laptop', 'work.starting'],
    [.43, '慢慢浏览', 'browse', 'laptop', 'work.focus', 3],
    [.61, '记录一条', 'write', 'notes', 'work.wrap-up', 2],
    [.85, '返回核对', 'browse', 'laptop', 'work.switch', 2],
    [1, '停下浏览', 'breathe', 'laptop', 'react.satisfied']
  ]),
  'focus-charts': sequence([
    [.15, '铺开图表', 'organize', 'chart', 'work.starting'],
    [.42, '查看趋势', 'trade', 'chart', 'work.focus', 3],
    [.57, '对照便签', 'read', 'notes', 'work.switch'],
    [.82, '标记变化', 'write', 'chart', 'work.deep-focus', 2],
    [1, '核对收尾', 'trade', 'chart', 'work.wrap-up']
  ]),
  'focus-notes': sequence([
    [.15, '摊开便签', 'organize', 'notes', 'work.starting'],
    [.34, '逐张读过', 'read', 'notes', 'work.focus', 2],
    [.55, '分成小叠', 'organize', 'notes', 'work.wrap-up', 2],
    [.76, '补一行字', 'write', 'notes', 'work.focus', 2],
    [1, '轻轻放好', 'organize', 'notes', 'react.satisfied']
  ]),
  'rest-daydream': sequence([
    [.17, '慢慢呼气', 'breathe', 'none', 'react.relieved'],
    [.43, '看看身旁', 'look', 'none', 'life.space', 2],
    [.77, '安静发呆', 'daydream', 'none', 'life.space', 2],
    [1, '回过神来', 'stretch', 'none', 'work.rest']
  ]),
  'rest-nap': sequence([
    [.15, '拍拍枕头', 'organize', 'pillow', 'work.rest'],
    [.27, '打个哈欠', 'stretch', 'pillow', 'life.drowsy'],
    [.77, '抱着枕头睡', 'doze', 'pillow', 'life.sleep', 4],
    [.87, '慢慢醒来', 'daydream', 'pillow', 'life.wake'],
    [1, '伸展放松', 'stretch', 'none', 'react.relieved']
  ], .55),
  'rest-tea': sequence([
    [.16, '双手捧杯', 'carry', 'cup', 'work.rest'],
    [.31, '吹散热气', 'breathe', 'cup', 'work.rest'],
    [.65, '小口慢喝', 'sip', 'cup', 'react.satisfied', 3],
    [.82, '捧着杯子歇会', 'daydream', 'cup', 'life.space'],
    [1, '放低杯子歇会', 'organize', 'cup', 'react.relieved']
  ]),
  'rest-stretch': sequence([
    [.15, '站稳呼气', 'breathe', 'none', 'work.rest'],
    [.43, '双臂向上', 'stretch', 'none', 'react.relieved', 2],
    [.66, '轻轻左右摆', 'sway', 'none', 'work.rest', 2],
    [.84, '放松小手', 'stretch', 'none', 'react.relieved'],
    [1, '慢慢站好', 'breathe', 'none', 'work.rest']
  ]),
  'rest-window': sequence([
    [.17, '转向窗边', 'look', 'none', 'life.attentive'],
    [.45, '跟着云看', 'look', 'none', 'life.space', 2],
    [.74, '安静坐一会', 'daydream', 'none', 'life.space', 2],
    [1, '向窗外挥手', 'wave', 'none', 'react.happy']
  ]),
  'rest-plant': sequence([
    [.14, '看看小苗', 'look', 'plant', 'life.attentive'],
    [.32, '扶好花盆', 'organize', 'plant', 'work.focus'],
    [.60, '一点点浇水', 'water', 'watering-can', 'react.encouraging', 3],
    [.74, '停下等水落', 'breathe', 'plant', 'work.rest'],
    [.89, '观察新叶', 'look', 'plant', 'life.attentive'],
    [1, '轻轻挥手', 'wave', 'plant', 'react.satisfied']
  ])
});
export { COMPANION_ACTIVITY_STORIES };
