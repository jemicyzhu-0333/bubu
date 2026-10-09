'use strict';

// 任务输入的那些硬边界,一份定义。
//
// 这些数字既要在主进程规范化任务时生效,也要在面板里变成提示语("每个任务最多
// 8 个标签")和 disabled 状态。之前它们在两侧各写一份:task-model 的 LIMITS 与
// popover.js 顶上的 MAX_TAGS / MAX_TASK_STEPS / TASK_ESTIMATE_*,靠人眼对齐。
// 分叉的表现不是报错,而是"面板说还能加,主进程把这一步吃掉了"——一次静默的
// 数据丢失,而不是一条可以修的错误。
//
// 与 session-duration 同一套单一定义:两边都直接读这一个 ESM 文件,主进程
// require 具名导出,面板 import。页面只有一个 type="module" 入口,没有 classic
// script,也没有 window 上的副本。
//
// 持久层刻意比这里宽松:一条 500 字的旧标题、一份 150 步的旧清单必须无损迁移
// 过来。截断已经存进去的数据是丢失,不是修复,所以 PERSISTED_TITLE 与这里的
// TITLE 是两个不同的问题,不要合并。
const LIMITS = Object.freeze({
  TITLE: 100,
  DESCRIPTION: 1000,
  STEPS: 100,
  STEP_TITLE: 200,
  TAGS: 8,
  TAG: 20,
  ESTIMATE_MINUTES_MIN: 1,
  ESTIMATE_MINUTES_MAX: 24 * 60,
  RECURRENCE_INTERVAL_MAX: 365,
  SERIES: 200,
  PERSISTED_TITLE: 500,
  BLOCKER: 80,
  NEXT_ACTION: 200,
  ARCHIVE_REASON: 80
});


export default { LIMITS };
export { LIMITS };
