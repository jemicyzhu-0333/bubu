'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_EFFECT_VISUALS,
  EFFECT_RENDER_TYPES,
  resolveActionEffectVisual
} = require('../src/core/pet-effect-visuals.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');

// 这批测试钉住“动作特效”的语义映射。历史缺陷：renderer 用一串 if/else 推断粒子 type，
// 只覆盖少数几种，其余 11 种 effect 全部落到默认的金色 ✦，于是“每个动作都冒同样的十字星”。

test('每个行为声明的 effect 都在视觉表里登记（否则会默默回退成金色 ✦）', () => {
  for (const action of Object.values(PET_ACTIONS)) {
    const visual = resolveActionEffectVisual(action.effect);
    if (action.effect === 'none') { assert.equal(visual, null); continue; }
    assert.ok(visual, `行为 ${action.id} 的 effect "${action.effect}" 没有登记视觉映射`);
  }
});

test('登记的每种 type 都必须是 renderer 覆盖层实现的画笔，且带非空配色', () => {
  const supported = new Set(EFFECT_RENDER_TYPES);
  for (const [effect, visual] of Object.entries(ACTION_EFFECT_VISUALS)) {
    assert.ok(supported.has(visual.type), `effect "${effect}" 的 type "${visual.type}" 没有对应画笔`);
    assert.ok(Array.isArray(visual.colors) && visual.colors.length > 0, `effect "${effect}" 缺少配色`);
  }
});

test('语义不同的 effect 不再共用“十字星”：只有 stars 映射到 star 画笔', () => {
  for (const [effect, visual] of Object.entries(ACTION_EFFECT_VISUALS)) {
    if (visual.type === 'star') assert.equal(effect, 'stars', `effect "${effect}" 不应回退成十字星`);
  }
  // 反例守卫：这些曾经全是 ✦ 的 effect，现在各自有区别于 star 的画笔。
  for (const effect of ['hearts', 'leaves', 'rainbow', 'petals', 'sparkles', 'glimmer', 'halo', 'zzz', 'flash']) {
    assert.notEqual(resolveActionEffectVisual(effect).type, 'star', `effect "${effect}" 仍是十字星`);
  }
});

test('未登记或缺省的 effect 不发粒子（返回 null，而不是回退默认星）', () => {
  assert.equal(resolveActionEffectVisual('nonexistent-effect'), null);
  assert.equal(resolveActionEffectVisual(undefined), null);
  assert.equal(resolveActionEffectVisual(''), null);
});

test('安静类特效（光环/困倦/热气）标记 calm，走稀疏发射器', () => {
  for (const effect of ['halo', 'zzz', 'steam', 'glimmer']) {
    assert.equal(resolveActionEffectVisual(effect).calm, true, `effect "${effect}" 应标记为 calm`);
  }
  // 庆祝/演出类不应是 calm，否则会被稀疏化。
  for (const effect of ['stars', 'notes', 'hearts', 'sparkles']) {
    assert.notEqual(resolveActionEffectVisual(effect).calm, true, `effect "${effect}" 不应是 calm`);
  }
});
