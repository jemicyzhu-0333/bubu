'use strict';

// 表情轮播器：按场景注册表（content/expression-scenarios.mjs）挑选表情。
//
// 纯逻辑：时间与随机数都由调用方注入，不读 DOM、不设定时器。
// - base 场景：home ↔ 变体 交替；变体按权重抽取，并避开最近出现过的变体
//   （池子足够大时），保证不会在两张脸之间来回打转。场景切换即重置回 home。
// - event 场景：每次事件按权重抽取，避开同场景上一次的结果。
// - calm=true（减少动效 / 低刺激 / 勿扰）时 base 固定 home，不轮播。
// 未知场景或表情缺失时回退到调用方给的 fallback，绝不抛错。

function createExpressionRotation({ scenarios, random = Math.random, has = () => true } = {}) {
  let baseKey = null;
  let baseCurrent = null;
  let baseUntil = 0;
  let baseAtHome = true;
  const variantHistory = [];
  const lastEvent = new Map();

  const span = (range, rnd) => range[0] + (range[1] - range[0]) * rnd();

  function weighted(entries, rnd) {
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    let cursor = rnd() * total;
    for (const entry of entries) {
      cursor -= entry.weight;
      if (cursor < 0) return entry;
    }
    return entries[entries.length - 1];
  }

  function chooseVariant(scenario) {
    const usable = scenario.variants.filter(v => has(v.id));
    if (!usable.length) return null;
    // 记忆窗口 = 池大小 - 1：每个变体都会在一轮内出现，不会被两张脸垄断。
    const memory = Math.max(0, usable.length - 1);
    const recent = variantHistory.slice(-memory);
    const fresh = usable.filter(v => !recent.includes(v.id));
    const picked = weighted(fresh.length ? fresh : usable, random);
    variantHistory.push(picked.id);
    if (variantHistory.length > 16) variantHistory.shift();
    return picked;
  }

  function resolveBase(key, now, { fallback = 'life.idle', calm = false } = {}) {
    const scenario = scenarios[key];
    if (!scenario || scenario.kind !== 'base' || !has(scenario.home)) {
      baseKey = null;
      return fallback;
    }
    if (key !== baseKey) {
      baseKey = key;
      baseAtHome = true;
      baseCurrent = scenario.home;
      baseUntil = now + span(scenario.homeHoldMs, random);
      variantHistory.length = 0;
    }
    if (calm) {
      baseAtHome = true;
      baseCurrent = scenario.home;
      return scenario.home;
    }
    if (now >= baseUntil) {
      const next = baseAtHome ? chooseVariant(scenario) : null;
      if (next) {
        baseAtHome = false;
        baseCurrent = next.id;
        baseUntil = now + span(next.holdMs, random);
      } else {
        baseAtHome = true;
        baseCurrent = scenario.home;
        baseUntil = now + span(scenario.homeHoldMs, random);
      }
    }
    return baseCurrent;
  }

  function pickEvent(key, fallback) {
    const scenario = scenarios[key];
    if (!scenario || scenario.kind !== 'event') return fallback;
    const usable = scenario.pool.filter(v => has(v.id));
    if (!usable.length) return has(scenario.fallback) ? scenario.fallback : fallback;
    const previous = lastEvent.get(key);
    const fresh = usable.length > 1 ? usable.filter(v => v.id !== previous) : usable;
    const picked = weighted(fresh, random).id;
    lastEvent.set(key, picked);
    return picked;
  }

  // 其他呈现接管（互动、彩蛋、镜像、活动）时调用：之后重新从 home 开始计时，
  // 保证“打断结束先回到本场景的常态表情”。
  function restart() { baseKey = null; }

  return Object.freeze({ resolveBase, pickEvent, restart, currentBaseScenario: () => baseKey });
}

export { createExpressionRotation };
