'use strict';

// Task effort, inference and duration share one closed set of energy bands.
const ENERGY_BANDS = Object.freeze(['low', 'medium', 'high']);

// 关键词权重表（中文/英文兼容）
const HIGH_ENERGY_KEYWORDS = [
  '写', '设计', '开发', '编码', '重构', '架构', '方案', '规划', '策划',
  '学习', '研究', '调研', '思考', '推理', '分析', '深度',
  '面试', '答辩', '演讲', '汇报', '述职', '谈判', '开会讨论',
  '创作', '画', '作曲', '写作', '论文', '博客',
  'design', 'implement', 'refactor', 'architect', 'research', 'learn', 'analyze', 'write'
];

const MEDIUM_ENERGY_KEYWORDS = [
  '整理', '归档', '总结', '梳理', '复盘',
  '回复', '沟通', '协调', '跟进', '对齐',
  '修', '调', '优化', '完善', '调试',
  '看', '读', '浏览', '预习', '复习',
  'review', 'organize', 'summarize', 'reply', 'fix', 'debug', 'read'
];

const LOW_ENERGY_KEYWORDS = [
  '打卡', '签到', '点赞', '发送', '提交', '上传', '下载',
  '喝水', '吃', '拿', '取', '买', '订', '预约',
  '看一眼', '瞄一眼', '刷', '删除', '清理',
  '发消息', '发邮件', '回消息',
  'submit', 'send', 'upload', 'click', 'ping'
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferEnergy(title) {
  const text = typeof title === 'string' ? title : '';
  const t = text.toLowerCase();
  let highScore = 0, medScore = 0, lowScore = 0;
  for (const kw of HIGH_ENERGY_KEYWORDS) if (t.includes(kw.toLowerCase())) highScore += 2;
  for (const kw of MEDIUM_ENERGY_KEYWORDS) if (t.includes(kw.toLowerCase())) medScore += 1;
  for (const kw of LOW_ENERGY_KEYWORDS) if (t.includes(kw.toLowerCase())) lowScore += 2;

  // 长度只作为很弱的启发式，不把“写得详细”误判成必然困难。
  if (text.length > 25) highScore += 1;
  else if (text.length > 0 && text.length < 8) lowScore += 1;

  if (/\d+\s*(小时|hour|h)/i.test(t)) highScore += 2;
  if (/\d+\s*(分钟|min|m)/i.test(t) && !/\d{2,}\s*分钟/i.test(t)) medScore += 1;

  const scores = { high: highScore, medium: medScore + 0.5, low: lowScore };
  const max = Math.max(scores.high, scores.medium, scores.low);
  if (max === scores.high) return 'high';
  if (max === scores.low) return 'low';
  return 'medium';
}

function suggestDuration(title, energy) {
  const t = typeof title === 'string' ? title.toLowerCase() : '';
  const hourMatch = t.match(/(\d+)\s*(小时|hour|h)/i);
  if (hourMatch) return clamp(parseInt(hourMatch[1], 10) * 60, 1, 480);
  const minMatch = t.match(/(\d+)\s*(分钟|min|m)/i);
  if (minMatch) return clamp(parseInt(minMatch[1], 10), 1, 480);
  return { high: 45, medium: 25, low: 10 }[energy] || 25;
}

// 任务自带的档位是用户可编辑字段，能存进去什么并没有校验，所以读的时候必须自己
// 兜底：认不出来就按标题重新推断。调用方直接读 task.energy 的话，一个错字就会被
// 下游当成合法档位悄悄当作 medium 处理。
function taskEnergyBand(task) {
  const declared = task && task.energy;
  return ENERGY_BANDS.includes(declared) ? declared : inferEnergy(task && task.title);
}

function estimatedMinutes(task) {
  // Schema 8 exposes a user-editable `estimateMinutes`; `suggestedMin` remains
  // the rule-derived fallback. Each candidate is tried in turn instead of being
  // picked by a single ternary, so an empty estimate falls through to the rule
  // rather than skipping straight to a keyword guess.
  for (const candidate of [
    task && task.estimateMinutes,
    task && task.estimatedMin,
    task && task.suggestedMin,
    task && task.durationMinutes
  ]) {
    if (candidate === null || candidate === undefined) continue;
    const explicit = finiteNumber(candidate);
    if (explicit !== null && explicit > 0) return clamp(Math.round(explicit), 1, 480);
  }
  const energy = task && task.energy ? task.energy : inferEnergy(task && task.title);
  return suggestDuration(task && task.title, energy);
}

module.exports = {
  ENERGY_BANDS,
  inferEnergy,
  suggestDuration,
  estimatedMinutes,
  taskEnergyBand,
  clamp,
  finiteNumber
};
