'use strict';

// 开发表达画廊的纯状态控制器。每张卡片拥有独立的播放起点和静态开关，
// 全局按钮只是逐卡调用同一接口；这里不读取 DOM，也不拥有动画循环。

function petGalleryCreateController(expressionIds, options = {}) {
  if (!Array.isArray(expressionIds) || expressionIds.length === 0) {
    throw new TypeError('expressionIds must be a non-empty array');
  }
  const ids = [...expressionIds];
  if (ids.some(id => typeof id !== 'string' || id.length === 0) || new Set(ids).size !== ids.length) {
    throw new TypeError('expressionIds must contain unique non-empty strings');
  }
  const now = typeof options.now === 'function' ? options.now : () => performance.now();
  const states = new Map(ids.map(id => [id, { startedAt: now(), static: false }]));

  function requireState(id) {
    const state = states.get(id);
    if (!state) throw new RangeError(`unknown expression: ${id}`);
    return state;
  }

  function play(id, at = now()) {
    const state = requireState(id);
    state.startedAt = at;
    state.static = false;
    return snapshot(id, at);
  }

  function freeze(id, at = now()) {
    const state = requireState(id);
    state.static = true;
    return snapshot(id, at);
  }

  function playAll(at = now()) {
    for (const id of ids) play(id, at);
    return snapshots(at);
  }

  function freezeAll(at = now()) {
    for (const id of ids) freeze(id, at);
    return snapshots(at);
  }

  function snapshot(id, at = now()) {
    const state = requireState(id);
    return Object.freeze({
      id,
      static: state.static,
      startedAt: state.startedAt,
      elapsedMs: state.static ? 0 : Math.max(0, at - state.startedAt)
    });
  }

  function snapshots(at = now()) {
    return ids.map(id => snapshot(id, at));
  }

  return Object.freeze({
    ids: () => [...ids],
    play,
    freeze,
    playAll,
    freezeAll,
    snapshot,
    snapshots
  });
}

const petGalleryApi = Object.freeze({ createController: petGalleryCreateController });

export default petGalleryApi;
export const createController = petGalleryApi.createController;
