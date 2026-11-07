// Unified action descriptor registry: one descriptor coordinates every
// channel of an action. Channels are themselves registered, so adding a new
// channel (e.g. sound) is one registerChannel call plus a test.

const DEFAULT_CHANNELS = Object.freeze({
  body: { required: true, validate: track => typeof track.clip === 'string' && track.clip.length > 0 },
  expression: { validate: track => typeof track.expression === 'string' },
  accessory: { validate: track => ['keep', 'hide', 'pose'].includes(track.mode ?? 'keep') },
  prop: { validate: track => typeof track.id === 'string' && ['hand.l', 'hand.r', 'world'].includes(track.socket) },
  particle: { validate: track => typeof track.effect === 'string' && (track.max ?? 1) >= 1 && (track.max ?? 1) <= 4 }
});
const INTERRUPTS = new Set(['pointer', 'hide', 'lock', 'reduced-motion', 'wardrobe', 'dispose']);
const ID = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;

export function createActionRegistry({ channels = DEFAULT_CHANNELS } = {}) {
  const channelTable = new Map(Object.entries(channels));
  const actions = new Map();

  function registerChannel(name, spec) {
    if (!ID.test(name) || channelTable.has(name)) throw new TypeError(`action channel invalid or duplicate: ${name}`);
    if (typeof spec?.validate !== 'function') throw new TypeError(`action channel ${name} needs validate()`);
    if (actions.size) throw new Error('register channels before actions');
    channelTable.set(name, Object.freeze({ ...spec }));
  }

  function register(descriptor) {
    const { id, durationMs, channels: tracks = {}, interruptBy = [...INTERRUPTS], views = ['three-quarter'] } = descriptor ?? {};
    if (!ID.test(id ?? '')) throw new TypeError(`action id invalid: ${id}`);
    if (actions.has(id)) throw new Error(`action already registered: ${id}`);
    if (!(Number.isFinite(durationMs) && durationMs > 0)) throw new TypeError(`${id}: durationMs must be positive`);
    for (const name of Object.keys(tracks)) if (!channelTable.has(name)) throw new TypeError(`${id}: unknown channel ${name}`);
    for (const [name, spec] of channelTable) {
      const track = tracks[name];
      if (track === undefined) { if (spec.required) throw new TypeError(`${id}: channel ${name} is required`); continue; }
      if (!spec.validate(track)) throw new TypeError(`${id}: channel ${name} track invalid`);
    }
    for (const reason of interruptBy) if (!INTERRUPTS.has(reason)) throw new TypeError(`${id}: unknown interrupt ${reason}`);
    const frozen = Object.freeze({ id, durationMs, views: Object.freeze([...views]),
      interruptBy: Object.freeze([...interruptBy]),
      channels: Object.freeze(Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, Object.freeze({ ...v })]))) });
    actions.set(id, frozen);
    return frozen;
  }

  // Plan = the per-channel tracks a single owner applies; no channel is written by two owners.
  function plan(id, { view = 'three-quarter' } = {}) {
    const action = actions.get(id);
    if (!action) return { ok: false, reason: 'unknown-action' };
    if (!action.views.includes(view)) return { ok: false, reason: 'view-unsupported', fallback: action.views[0] };
    return { ok: true, action, tracks: [...channelTable.keys()].filter(c => action.channels[c]).map(c => ({ channel: c, ...action.channels[c] })) };
  }

  const interrupts = (id, reason) => actions.get(id)?.interruptBy.includes(reason) ?? false;
  return Object.freeze({ registerChannel, register, plan, interrupts, get: id => actions.get(id),
    list: () => [...actions.keys()], channels: () => [...channelTable.keys()] });
}
export const ACTION_INTERRUPTS = Object.freeze([...INTERRUPTS]);
