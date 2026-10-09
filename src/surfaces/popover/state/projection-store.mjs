'use strict';

function createPopoverProjectionStore({ client, stateChannel } = {}) {
  if (!client || typeof client.getState !== 'function' || typeof client.onStateDiff !== 'function') {
    throw new TypeError('popover projection store requires a scoped client');
  }
  if (!stateChannel || typeof stateChannel.applyStateDelta !== 'function') {
    throw new TypeError('popover projection store requires a state channel');
  }

  let state = null;
  let unsubscribe = null;
  let disposed = false;
  let readGeneration = 0;
  let latestRead = null;
  const listeners = new Set();

  function notify(change) {
    for (const listener of [...listeners]) listener(change);
  }

  function freezeProjection(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) freezeProjection(nested);
    return Object.freeze(value);
  }

  function reload(initial = false) {
    const generation = ++readGeneration;
    latestRead = (async () => {
      const next = await client.getState();
      if (disposed) return;
      // A reopen caller must wait for the superseding gap/reopen read, not
      // interpret a discarded response as fresh authorization for cached actions.
      if (generation !== readGeneration) return latestRead;
      if (state && next.revision < state.revision) return state;
      state = freezeProjection(next);
      notify({ state, dirty: { all: true }, initial });
      return state;
    })();
    return latestRead;
  }

  async function handleStateDiff(message) {
    if (disposed) return;
    if (!state) {
      await reload();
      if (disposed || !state) return;
    }
    const applied = stateChannel.applyStateDelta(state, message);
    if (!applied.applied) {
      if (applied.reason !== 'stale-revision') await reload();
      return;
    }
    state = freezeProjection(applied.state);
    notify({ state, dirty: message.dirty || {}, initial: false });
  }

  async function start() {
    if (disposed) throw new Error('popover projection store is disposed');
    if (!unsubscribe) unsubscribe = client.onStateDiff(handleStateDiff);
    await reload(true);
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('projection listener must be a function');
    if (disposed) throw new Error('popover projection store is disposed');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.clear();
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
  }

  return Object.freeze({ start, subscribe, dispose, refresh: () => reload(), getState: () => state });
}


export { createPopoverProjectionStore };
