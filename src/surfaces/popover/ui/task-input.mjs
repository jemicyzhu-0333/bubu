'use strict';

// 输入边界是共享 contract 的一份定义,由 popover.html 作为 classic script 先加载。
// 这一行是这个文件的浏览器入口:全局查找留在使用它的模块里,组合根不必知道
// 这些数字是从页面全局来的。
import { LIMITS } from '../../../capabilities/work/contract/task-limits.mjs';

const popoverTaskInputLimits = LIMITS;

// 面板里关于"任务输入"的那几条边界,以及它们对人说的话。
//
// 之前这几个数字在面板顶上又写了一份(MAX_TAGS / MAX_TAG_LENGTH /
// MAX_TASK_STEPS / TASK_ESTIMATE_*),与主进程规范化任务用的 LIMITS 靠人眼对齐。
// 分叉的表现不是报错,而是"面板说还能加,主进程把这一步吃掉了"。现在两边读同一
// 份 contract,这一层只负责把数字翻成提示语。
//
// 这些提示语都以"输入仍然保留"收尾,这是产品语义而不是文案偏好:超出边界时把
// 人写的东西清掉,等于用一次数据丢失来惩罚一次手误。
function createPopoverTaskInput({ $, limits = popoverTaskInputLimits } = {}) {
  if (typeof $ !== 'function') throw new TypeError('popover task input requires $');
  if (!limits || !Number.isFinite(limits.STEPS) || !Number.isFinite(limits.TAGS)) {
    throw new TypeError('popover task input requires the shared task limits');
  }

  // 中英文逗号都算分隔符:输入法没切回来不该让整串标签变成一个。
  function parseTagList(raw) {
    if (typeof raw !== 'string') return [];
    const tags = [];
    for (const piece of raw.split(/[,，]/)) {
      const tag = piece.trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  function tagInputError(raw) {
    const tags = parseTagList(raw);
    if (tags.some(tag => tag.length > limits.TAG)) {
      return `每个标签最多 ${limits.TAG} 个字符；输入仍然保留。`;
    }
    if (tags.length > limits.TAGS) {
      return `每个任务最多 ${limits.TAGS} 个标签；输入仍然保留。`;
    }
    return null;
  }

  function estimateInputError(selector) {
    const input = $(selector);
    if (!input || !input.value.trim()) return null;
    const minutes = Number(input.value);
    if (!Number.isInteger(minutes)
        || minutes < limits.ESTIMATE_MINUTES_MIN || minutes > limits.ESTIMATE_MINUTES_MAX) {
      return `估时必须是 ${limits.ESTIMATE_MINUTES_MIN}–${limits.ESTIMATE_MINUTES_MAX} 的整数分钟；输入仍然保留。`;
    }
    return null;
  }

  // 两处重复间隔校验之前各写一份 1–365。区间是共享的,尾巴不是:创建表单要额外
  // 告诉人"当前输入不会丢",编辑弹层里输入本来就还在,不必多说一句。
  function recurrenceIntervalError(interval, { keepsInput = false } = {}) {
    if (Number.isInteger(interval) && interval >= 1 && interval <= limits.RECURRENCE_INTERVAL_MAX) {
      return null;
    }
    const range = `1–${limits.RECURRENCE_INTERVAL_MAX}`;
    return keepsInput
      ? `重复间隔必须是 ${range} 的整数；当前输入不会丢。`
      : `重复间隔必须是 ${range} 的整数。`;
  }

  // 步骤标题是单行的:textarea 只是为了能换行显示长标题,Enter 不该在里面留下
  // 一个看不见的 \n,再让主进程把它规范化掉。粘进来的多行同理,就地压成空格,
  // 并且把光标留在原处——否则每粘一次都要重新找位置。
  function bindStepTitleField(field, onChange) {
    if (!field) return field;
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    field.addEventListener('input', event => {
      const flattened = event.target.value.replace(/[\r\n]+/g, ' ');
      if (flattened !== event.target.value) {
        const caret = event.target.selectionStart;
        event.target.value = flattened;
        event.target.setSelectionRange(caret, caret);
      }
      onChange(event.target.value);
    });
    return field;
  }

  return Object.freeze({
    limits,
    parseTagList,
    tagInputError,
    estimateInputError,
    recurrenceIntervalError,
    bindStepTitleField
  });
}


export { createPopoverTaskInput };
