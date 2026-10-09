'use strict';
const { inferEnergy, suggestDuration } = require('./task-demand');
const { buildDeterministicProposal } = require('../../../core/breakdown-proposal');
const { buildDeterministicEnrich } = require('../../../core/enrich-proposal');
const { selectStrategy } = require('../../../core/strategy-registry');
const { STRATEGIES } = require('../../../content/strategies');

function breakdownTask(title) {
  const cleaned = title.trim();
  const verbMatches = cleaned.match(/^(写|做|完成|准备|整理|学习|读|设计|开发|修|清理|回复|发送|联系|安排|规划|复习|调试|优化|重构|测试|部署|录|画|想|研究|调研|翻译)/);
  const verb = verbMatches ? verbMatches[1] : '开始';
  const templates = {
    '写': [{title:'打开文档 / 新建文件',done:false},{title:'列出想写的 3 个要点（不用完美）',done:false},{title:'选一个要点，写 3 句话',done:false},{title:'继续写 10 分钟，不管好不好',done:false},{title:'快速通读一遍，标记待改的地方',done:false}],
    '学习': [{title:'打开学习资料 / 视频',done:false},{title:'看 / 读第一小节',done:false},{title:'合上，用自己的话总结 1 句',done:false},{title:'看下一节',done:false},{title:'记下今天最有意思的 1 个点',done:false}],
    '整理': [{title:'划定要整理的范围',done:false},{title:'把明显要扔的先扔掉',done:false},{title:'把剩下的分成 3 堆',done:false},{title:'归位其中一堆',done:false},{title:'收工，剩下的下次再说',done:false}],
    '设计': [{title:'找 3 个参考',done:false},{title:'画一版粗糙草稿（丑没关系）',done:false},{title:'选出最喜欢的部分',done:false},{title:'基于草稿做一版细化',done:false},{title:'自检一遍',done:false}],
    '开发': [{title:'拉最新代码 / 打开项目',done:false},{title:'写出接口 / 函数签名（不用实现）',done:false},{title:'实现最简单的一条路径',done:false},{title:'手动测试一下',done:false},{title:'写个最小的单测或 commit',done:false}]
  };
  return templates[verb] || [
    { title: '打开需要的东西', done: false },
    { title: `${verb}最小的一小块`, done: false },
    { title: '继续做 10 分钟不管好坏', done: false },
    { title: '快速自检', done: false },
    { title: '收尾并保存', done: false }
  ];
}

function deterministicBreakdownProposal(payload) {
  return buildDeterministicProposal(breakdownTask(payload.title));
}

// The deterministic enrich answer is built from the same local rules the app
// already trusts for energy and duration, so switching AI off produces a real
// suggestion instead of an empty form with an apology.
function deterministicEnrichProposal(payload) {
  const title = typeof payload.title === 'string' ? payload.title : '';
  const energy = inferEnergy(title);
  return buildDeterministicEnrich({
    steps: breakdownTask(title),
    energy,
    estimateMinutes: suggestDuration(title, energy)
  });
}

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function deterministicUnstickProposal(payload = {}) {
  const title = boundedText(payload.title, 100);
  const unfinished = Array.isArray(payload.steps)
    ? payload.steps.filter(step => step && !step.done && boundedText(step.title, 60)).slice(0, 3)
    : [];
  // Task effort is not a current self-report. A local strategy uses a neutral
  // band until the person explicitly supplies a current state.
  const energyBand = 'medium';
  const selected = selectStrategy(STRATEGIES, {
    phase: 'pre-start',
    energyBand,
    explicitRequest: true,
    task: {
      title,
      nextAction: unfinished[0] ? boundedText(unfinished[0].title, 60) : null,
      estimateMinutes: 0
    },
    rng: () => 0
  });
  const visibleAction = STRATEGIES.find(strategy => strategy.id === 'start-visible-action');
  const strategy = selected.strategy || visibleAction || STRATEGIES[0];
  return {
    nextAction: boundedText(strategy.staticFallback, 60),
    why: boundedText(strategy.detail, 80),
    fallbackAction: boundedText((visibleAction || strategy).staticFallback, 60),
    splitSteps: unfinished.map(step => boundedText(step.title, 60))
  };
}

function transcriptUserMessages(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .filter(message => message && message.role !== 'assistant')
    .map(message => boundedText(message.content, 2000))
    .filter(Boolean);
}

function deterministicClarifyProposal(payload = {}) {
  const messages = transcriptUserMessages(payload.transcript);
  const title = boundedText(messages[0] || '开始当前任务', 100);
  const energy = inferEnergy(title);
  const estimateMinutes = Math.max(5, suggestDuration(title, energy));
  const notes = boundedText(messages.slice(1).join('\n'), 1000) || null;
  return {
    status: 'ready',
    proposal: {
      title,
      steps: buildDeterministicProposal(breakdownTask(title)).steps,
      estimateMinutes,
      energy,
      notes
    }
  };
}

module.exports = {
  breakdownTask,
  deterministicBreakdownProposal,
  deterministicEnrichProposal,
  deterministicUnstickProposal,
  deterministicClarifyProposal
};
