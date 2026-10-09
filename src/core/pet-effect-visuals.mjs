'use strict';

// 动作特效的语义映射。每个行为在 content/behaviors.mjs 里声明一个 effect 名，
// 这张表把它翻译成 renderer 覆盖层能画的粒子视觉。历史缺陷：renderer 里用
// 一串 if/else 推断 type，只覆盖了少数几种，其余 11 种 effect（hearts、leaves、
// rainbow、petals、sparkles、sparks、glimmer、halo、stars、zzz、flash）全部
// 落到默认的金色 ✦，于是“每个动作都冒同样的十字星”。现在改为表驱动：
//   ① 每个 effect 必须显式登记，未登记一律不发粒子（而不是默默变成星）；
//   ② type 决定 renderer 用哪支画笔，同一支画笔可被多个语义相近的 effect 复用；
//   ③ calm 的 effect（打坐光环、困倦 zzz、热气）走稀疏发射器并向上轻飘，
//      不与庆祝类同频，避免安静动作也像放烟花。
// 本模块是纯数据 + 纯查询：不读 DOM、不发 IPC、不依赖 Canvas。

const petEffectVisualsApi = (() => {

// renderer 覆盖层真正实现的画笔集合。表里的 type 必须都在这里，
// 否则 test/pet-action-effects.test.js 失败——防止“加了 effect 却没有画笔”。
const EFFECT_RENDER_TYPES = Object.freeze([
  'heart', 'note', 'sparkle', 'spark', 'star', 'ring',
  'petal', 'leaf', 'rainbow', 'flash', 'z',
  'sweat', 'bubble', 'puff', 'crumb', 'letter', 'thread', 'trail'
]);

const ACTION_EFFECT_VISUALS = Object.freeze({
  hearts: Object.freeze({ type: 'heart', colors: Object.freeze(['#ffd5e0', '#f7768e', '#ff9db0']) }),
  notes: Object.freeze({ type: 'note', colors: Object.freeze(['#f7768e', '#e0af68', '#bb9af7']) }),
  sparkles: Object.freeze({ type: 'sparkle', colors: Object.freeze(['#ffffff', '#fff2c4', '#ffe066']) }),
  glimmer: Object.freeze({ type: 'sparkle', colors: Object.freeze(['#e8faff', '#c8f0ff', '#ffffff']), calm: true }),
  sparks: Object.freeze({ type: 'spark', colors: Object.freeze(['#ff9e64', '#e0af68', '#ffd166']) }),
  stars: Object.freeze({ type: 'star', colors: Object.freeze(['#ffd166', '#e0af68', '#fff2c4']) }),
  halo: Object.freeze({ type: 'ring', colors: Object.freeze(['#ffe9a8', '#fff6d6']), calm: true }),
  petals: Object.freeze({ type: 'petal', colors: Object.freeze(['#ffd0e0', '#f7a8c4', '#ffe3ee']) }),
  leaves: Object.freeze({ type: 'leaf', colors: Object.freeze(['#9ece6a', '#528b41', '#c8f08a']) }),
  rainbow: Object.freeze({ type: 'rainbow', colors: Object.freeze(['#f7768e', '#e0af68', '#9ece6a', '#7dcfff', '#bb9af7']) }),
  flash: Object.freeze({ type: 'flash', colors: Object.freeze(['#ffffff', '#fff2c4', '#7dcfff']) }),
  impact: Object.freeze({ type: 'flash', colors: Object.freeze(['#ffd166', '#ff7a5c', '#ffffff']) }),
  zzz: Object.freeze({ type: 'z', colors: Object.freeze(['#bb9af7', '#c0caf5']), calm: true }),
  sweat: Object.freeze({ type: 'sweat', colors: Object.freeze(['#7dcfff', '#a9d6ff']) }),
  bubbles: Object.freeze({ type: 'bubble', colors: Object.freeze(['rgba(200,220,255,0.75)', 'rgba(170,214,255,0.7)']) }),
  steam: Object.freeze({ type: 'bubble', colors: Object.freeze(['rgba(220,225,235,0.6)', 'rgba(200,210,225,0.55)']), calm: true }),
  dust: Object.freeze({ type: 'puff', colors: Object.freeze(['#c9a37a', '#8a5a2a', '#e0c29a']) }),
  puffs: Object.freeze({ type: 'puff', colors: Object.freeze(['#d7dbe6', '#a9b1d6', '#eef1f8']) }),
  crumbs: Object.freeze({ type: 'crumb', colors: Object.freeze(['#e0af68', '#c07f26']) }),
  code: Object.freeze({ type: 'letter', colors: Object.freeze(['#7dcfff', '#9ece6a']), glyphs: Object.freeze(['0', '1', '⌁', '{', '}']) }),
  letters: Object.freeze({ type: 'letter', colors: Object.freeze(['#e0af68', '#f7768e']), glyphs: Object.freeze(['A', '字', '·', '?']) }),
  thread: Object.freeze({ type: 'thread', colors: Object.freeze(['#f7768e', '#e06c75']) }),
  trail: Object.freeze({ type: 'trail', colors: Object.freeze(['#c0caf5', '#7dcfff']) })
});

function resolveActionEffectVisual(effect) {
  return Object.prototype.hasOwnProperty.call(ACTION_EFFECT_VISUALS, effect)
    ? ACTION_EFFECT_VISUALS[effect]
    : null;
}

return Object.freeze({
  EFFECT_RENDER_TYPES,
  ACTION_EFFECT_VISUALS,
  resolveActionEffectVisual
});

})();

export default petEffectVisualsApi;
export const EFFECT_RENDER_TYPES = petEffectVisualsApi.EFFECT_RENDER_TYPES;
export const ACTION_EFFECT_VISUALS = petEffectVisualsApi.ACTION_EFFECT_VISUALS;
export const resolveActionEffectVisual = petEffectVisualsApi.resolveActionEffectVisual;
