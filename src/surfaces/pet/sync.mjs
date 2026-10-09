'use strict';

function clampUnit(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function normalizeGaze(data = {}) {
  return Object.freeze({
    x: clampUnit(data.x),
    y: clampUnit(data.y),
    near: data.near === true,
    sameDisplay: data.sameDisplay === true
  });
}

const CANONICAL_FIELDS = Object.freeze([
  'skin', 'theme', 'work', 'energyLevel', 'level', 'appearanceItemIds',
  'stimulationMode', 'motionMode', 'petActivityMode', 'dnd', 'paused',
  'baseState', 'focusRing', 'sessionDisplay', 'satiation', 'foodInventory', 'totalFeeds', 'basicMeal', 'foodTickets'
]);
const RUNTIME_FIELDS = Object.freeze(['screenLocked', 'devMode', 'activityMirror', 'activityMirrorConcurrent']);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const revisionOf = value => Number.isSafeInteger(value?.contextRevision) && value.contextRevision >= 0
  ? value.contextRevision : null;

// Arrival ownership is separate from canonical publication ordering. Hydration
// can repair missed canonical fields, but never clear an independent later fact.
function createPetContextOwner() {
  let arrival = 0;
  let revision = -1;
  let liveRevision = -1;
  const fields = new Map();
  const independent = new Map();
  function claimIndependent(data) {
    const at = ++arrival;
    for (const key of [...CANONICAL_FIELDS, ...RUNTIME_FIELDS]) {
      if (has(data, key)) independent.set(key, at);
    }
  }
  function live(input = {}) {
    const data = input.forcedState && input.forcedState !== 'celebrating'
      && !input.baseState && !input.transientState
      ? { ...input, baseState: input.forcedState } : input;
    const at = ++arrival;
    const incoming = revisionOf(data);
    const accepted = incoming === null || incoming > revision
      || (incoming === revision && incoming > liveRevision);
    const output = { ...data };
    for (const key of CANONICAL_FIELDS) {
      if (!has(data, key)) continue;
      if (accepted) {
        fields.set(key, at);
        if (incoming === null) independent.set(key, at);
        else independent.delete(key);
      } else delete output[key];
    }
    if (!accepted && output.forcedState !== 'celebrating') delete output.forcedState;
    for (const key of RUNTIME_FIELDS) if (has(data, key)) independent.set(key, at);
    if (incoming !== null && accepted) { revision = incoming; liveRevision = incoming; }
    return output;
  }
  function hydrate(snapshot, ticket) {
    if (!snapshot || typeof snapshot !== 'object') return {};
    const data = { ...snapshot };
    if (has(snapshot, 'state')) data.baseState = snapshot.state;
    if (snapshot.energy && has(snapshot.energy, 'level')) data.energyLevel = snapshot.energy.level;
    const incoming = revisionOf(snapshot);
    const newer = incoming !== null && incoming > revision;
    const output = {};
    for (const key of CANONICAL_FIELDS) {
      if (!has(data, key) || (independent.get(key) || 0) > ticket) continue;
      if (incoming !== null && incoming < revision) continue;
      if (!newer && (fields.get(key) || 0) > ticket) continue;
      output[key] = data[key];
      fields.set(key, ++arrival);
    }
    for (const key of RUNTIME_FIELDS) {
      if (has(data, key) && (independent.get(key) || 0) <= ticket) output[key] = data[key];
    }
    if (incoming !== null) revision = Math.max(revision, incoming);
    return output;
  }
  return Object.freeze({ live, hydrate, claimIndependent, beginHydration: () => arrival });
}

function createPetSync({ client, onSync, onDock, onPeek, onCue, onFeedState, onGaze, onDevtools, onSelfMeal } = {}) {
  if (!client || typeof client.onPetSync !== 'function') throw new TypeError('pet sync client is required');
  const ownership = createPetContextOwner();
  const callbacks = { onSync, onDock, onPeek, onCue, onFeedState, onGaze, onDevtools, onSelfMeal };
  const subscriptions = [];
  let connected = false;
  let disposed = false;
  const release = unsubscribe => {
    // One failed transport cleanup must not retain the other owned listeners.
    try { unsubscribe(); } catch { /* callback guards remain terminal */ }
  };
  const register = (method, callback) => {
    if (disposed || typeof callback !== 'function' || typeof client[method] !== 'function') return;
    const unsubscribe = client[method](value => { if (!disposed) return callback(value); });
    if (typeof unsubscribe !== 'function') return;
    if (disposed) release(unsubscribe);
    else subscriptions.push(unsubscribe);
  };

  function subscribe() {
    register('onPetSync', value => {
      callbacks.onSync?.(ownership.live(value || {}));
      if (!disposed && value?.selfMeal) callbacks.onSelfMeal?.(value.selfMeal);
    });
    register('onPetDock', value => callbacks.onDock?.(value || null));
    register('onPetPeek', value => callbacks.onPeek?.(value || null));
    register('onPetCue', value => callbacks.onCue?.(value));
    register('onPetFeedState', value => {
      ownership.claimIndependent(value || {});
      callbacks.onFeedState?.(value);
    });
    register('onPetGaze', value => callbacks.onGaze?.(normalizeGaze(value)));
    register('onPetDevtools', value => callbacks.onDevtools?.(value || {}));
  }

  function connect() {
    if (!connected && !disposed) {
      connected = true;
      try { subscribe(); } catch (error) { dispose(); throw error; }
    }
    return Object.freeze({ connected: connected && !disposed });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of subscriptions.splice(0)) release(unsubscribe);
  }

  return Object.freeze({ connect, dispose, normalizeGaze,
    beginHydration: () => disposed ? null : ownership.beginHydration(),
    hydrate: (snapshot, ticket) => {
      if (!disposed) return callbacks.onSync?.(ownership.hydrate(snapshot, ticket));
    },
    claimIndependent: data => { if (!disposed) ownership.claimIndependent(data); }
  });
}

export { createPetSync, createPetContextOwner, normalizeGaze, clampUnit };
export default Object.freeze({ createPetSync, normalizeGaze, clampUnit });
