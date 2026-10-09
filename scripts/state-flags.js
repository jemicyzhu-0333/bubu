'use strict';

// 渲染侧每个特性都靠 `dirty.X` 决定要不要重绘，而 X 的词表由 src/core/state-channel.mjs
// 独占。读侧写错一个名字不会有任何报错：buildStateDelta 只校验生产侧传进来的旗标（未声明
// 的直接抛错），读到的 undefined 永远为假——那个特性从此不再重绘，而增量里的字段一直在
// 正常送达，日志和测试都看不出异常。生产侧已有运行时校验，所以这层判据只管读侧。
function dirtyFlagReads(source) {
  return new Set([...source.matchAll(/\bdirty\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
}

module.exports = { dirtyFlagReads };
