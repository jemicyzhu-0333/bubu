'use strict';

function createSessionActivityController(options = {}) {
  const rotations = options.rotations || {};
  const activities = options.activities || {};
  // 轮换的推进与进度只能读单调时钟，否则校时会让一段活动被跳过或倒放。
  const clock = options.clock || { now: () => Date.now() };
  // 入口活动是另一件事：它只回答“这一段会话从哪个活动开始”，需要的是
  // 一个会变的种子。单调时钟从 0 起算，拿它当种子会让刚启动的第一分钟内
  // 每次开始专注都从同一个活动进入。不传时沿用 clock，行为与以前一致。
  const entryClock = options.entryClock || clock;
  // Focus and rest always rotate; any other mode with a rotation (the activity mirror) is active too.
  const activeModes = new Set(['focused', 'resting', ...Object.keys(rotations)]);
  let mode = 'idle';
  let index = 0;
  let startedAt = clock.now();

  function idsFor(nextMode = mode) {
    return Array.isArray(rotations[nextMode])
      ? rotations[nextMode].filter(id => activities[id] && activities[id].state === nextMode)
      : [];
  }

  // 入口按分钟轮转；种子不可用时失败关闭到第一个活动，而不是产生 NaN 下标。
  function entryIndex(count) {
    if (count <= 0) return 0;
    const minute = Math.floor(Number(entryClock.now()) / 60_000);
    return Number.isFinite(minute) ? Math.abs(minute) % count : 0;
  }

  function setMode(nextMode, at = clock.now()) {
    const normalized = activeModes.has(nextMode) ? nextMode : 'idle';
    if (normalized === mode) return current(at);
    mode = normalized;
    startedAt = at;
    index = entryIndex(idsFor().length);
    return current(at);
  }

  function advance(at = clock.now()) {
    const ids = idsFor();
    if (!ids.length) return null;
    index = (index + 1) % ids.length;
    startedAt = at;
    return activities[ids[index]];
  }

  function current(at = clock.now()) {
    const ids = idsFor();
    if (!ids.length) return null;
    let activity = activities[ids[index % ids.length]];
    let remaining = Math.max(0, at - startedAt);
    // Activities have different durations. Skip full rotations in O(1), then
    // consume the actual durations and preserve the current beat's remainder.
    // A delayed frame must not restart a 48-second story at its first pose.
    const cycleMs = ids.reduce((sum, id) => sum + activities[id].durationMs, 0);
    if (Number.isFinite(remaining) && cycleMs > 0 && remaining >= cycleMs) {
      const skipped = Math.floor(remaining / cycleMs) * cycleMs;
      startedAt += skipped;
      remaining -= skipped;
    }
    for (let count = 0; count < ids.length && remaining >= activity.durationMs; count += 1) {
      remaining -= activity.durationMs;
      startedAt += activity.durationMs;
      index = (index + 1) % ids.length;
      activity = activities[ids[index]];
    }
    return activity;
  }

  function progress(at = clock.now()) {
    const activity = current(at);
    if (!activity) return 0;
    return Math.max(0, Math.min(1, (at - startedAt) / activity.durationMs));
  }

  function snapshot(at = clock.now()) {
    const activity = current(at);
    return activity ? { mode, activity, startedAt, progress: progress(at) } : null;
  }

  return { setMode, advance, current, progress, snapshot };
}

const sessionActivityApi = { createSessionActivityController };



export default sessionActivityApi;
export { createSessionActivityController };
