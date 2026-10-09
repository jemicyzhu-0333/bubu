'use strict';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const TERMINAL = new Set(['completed', 'cancelled', 'rejected']);
const MAX_RECENT_TERMINAL_DECISIONS = 64;
const CANCELLATION_REASONS = new Set([
  'not-visible', 'menu-open', 'dragging', 'dnd', 'sensitive-foreground',
  'activity-off', 'quiet-mode', 'focus', 'low-stimulation',
  'reduce-motion', 'missing-content', 'interaction', 'presentation-priority'
]);

function createPetPlayer(options = {}) {
  // Envelope validity is a wall-clock fact, while playback is visual elapsed
  // time. Keeping the clocks explicit prevents NTP/manual clock changes from
  // skipping or rewinding an animation.
  const envelopeClock = options.envelopeClock || { now: () => Date.now() };
  const playbackClock = options.playbackClock || envelopeClock;
  const acknowledge = typeof options.acknowledge === 'function' ? options.acknowledge : () => {};
  const onStart = typeof options.onStart === 'function' ? options.onStart : () => {};
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
  const onCancel = typeof options.onCancel === 'function' ? options.onCancel : () => {};
  const content = new Map((options.manifest && options.manifest.cues || []).map(cue => [cue.id, cue]));
  // Delivery is at-least-once. Keep a bounded renderer-local terminal ledger
  // so a delayed retry cannot restart an animation after it already finished.
  // This is deliberately ephemeral: the main-process Director owns durable
  // recovery and never replays pending work after an app restart.
  const recentTerminalDecisions = new Map();
  let current = null;

  function ack(decisionId, status) {
    acknowledge({ decisionId, status });
  }

  function rememberTerminal(decisionId, status) {
    if (!SAFE_ID.test(decisionId || '') || !TERMINAL.has(status)) return;
    recentTerminalDecisions.delete(decisionId);
    recentTerminalDecisions.set(decisionId, status);
    while (recentTerminalDecisions.size > MAX_RECENT_TERMINAL_DECISIONS) {
      recentTerminalDecisions.delete(recentTerminalDecisions.keys().next().value);
    }
  }

  function replayTerminal(decisionId) {
    const status = recentTerminalDecisions.get(decisionId);
    if (!status) return null;
    ack(decisionId, status);
    return { ok: true, duplicate: true, terminal: true, status };
  }

  function cancelCurrent(reason = 'cancelled', report = true) {
    if (!current) return false;
    const previous = current;
    current = null;
    rememberTerminal(previous.envelope.decisionId, 'cancelled');
    onCancel(previous, reason);
    if (report) ack(previous.envelope.decisionId, 'cancelled');
    return true;
  }

  function reject(envelope, reason) {
    if (envelope && typeof envelope.decisionId === 'string') {
      rememberTerminal(envelope.decisionId, 'rejected');
      ack(envelope.decisionId, 'rejected');
    }
    return { ok: false, reason };
  }

  function completeCurrent() {
    if (!current) return false;
    const completed = current;
    current = null;
    rememberTerminal(completed.envelope.decisionId, 'completed');
    onComplete(completed);
    ack(completed.envelope.decisionId, 'completed');
    return true;
  }

  function resolveCue(envelope, context) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { error: 'invalid-envelope' };
    const keys = Object.keys(envelope);
    const allowed = ['version', 'decisionId', 'cueId', 'familyId', 'issuedAt', 'expiresAt', 'variant'];
    if (keys.some(key => !allowed.includes(key))) return { error: 'unknown-envelope-field' };
    if (envelope.version !== 1
        || !SAFE_ID.test(envelope.decisionId || '')
        || !SAFE_ID.test(envelope.cueId || '')
        || !SAFE_ID.test(envelope.familyId || '')
        || !SAFE_ID.test(envelope.variant || '')
        || !Number.isSafeInteger(envelope.issuedAt)
        || !Number.isSafeInteger(envelope.expiresAt)
        || envelope.expiresAt <= envelope.issuedAt
        || envelope.expiresAt > envelope.issuedAt + 60_000) return { error: 'invalid-envelope' };
    const cue = content.get(envelope.cueId);
    if (!cue || cue.familyId !== envelope.familyId) return { error: 'unknown-cue' };
    let variant = cue.variants.find(item => item.id === envelope.variant);
    if (!variant) return { error: 'unknown-variant' };
    if (context && context.reduceMotion && !variant.static) {
      variant = cue.variants.find(item => item.static) || variant;
    }
    return { cue, variant };
  }

  function presentCue(envelope, context = {}) {
    if (envelope && envelope.cancel === true) {
      const keys = Object.keys(envelope);
      const valid = keys.length === 4
        && keys.every(key => ['version', 'decisionId', 'cancel', 'reason'].includes(key))
        && envelope.version === 1
        && SAFE_ID.test(envelope.decisionId || '')
        && CANCELLATION_REASONS.has(envelope.reason);
      if (!valid) return { ok: false, reason: 'invalid-cancellation' };
      const duplicate = replayTerminal(envelope.decisionId);
      if (duplicate) return { ...duplicate, cancelled: true };
      if (current && current.envelope.decisionId === envelope.decisionId) cancelCurrent(envelope.reason || 'policy-change');
      return { ok: true, cancelled: true };
    }
    const duplicate = envelope && SAFE_ID.test(envelope.decisionId || '')
      ? replayTerminal(envelope.decisionId)
      : null;
    if (duplicate) return duplicate;
    // Renderer-side gates close the delivery race between a local interaction
    // and the main-process context update. A queued autonomous cue must never
    // replace a newer user/session presentation merely because its envelope
    // was already in flight.
    if (context.visible === false) return reject(envelope, 'not-visible');
    if (context.menuOpen === true) return reject(envelope, 'menu-open');
    if (context.dragging === true) return reject(envelope, 'dragging');
    if (context.dnd === true) return reject(envelope, 'dnd');
    if (context.lowStimulation === true) return reject(envelope, 'low-stimulation');
    if (context.presentationBlocked === true) return reject(envelope, 'presentation-priority');
    const resolved = resolveCue(envelope, context);
    if (resolved.error) return reject(envelope, resolved.error);
    const now = envelopeClock.now();
    if (now >= envelope.expiresAt) return reject(envelope, 'expired');
    if (current && current.envelope.decisionId === envelope.decisionId) {
      ack(envelope.decisionId, current.startedAt === null ? 'received' : 'started');
      return { ok: true, duplicate: true };
    }
    if (current && resolved.cue.priority <= current.cue.priority) return reject(envelope, 'lower-priority');
    if (current) cancelCurrent('preempted');
    current = { envelope: { ...envelope }, cue: resolved.cue, variant: resolved.variant, receivedAt: now, startedAt: null };
    ack(envelope.decisionId, 'received');
    current.startedAt = playbackClock.now();
    ack(envelope.decisionId, 'started');
    onStart(current);
    return { ok: true, cue: resolved.cue, variant: resolved.variant };
  }

  function progress(at = playbackClock.now()) {
    if (!current || current.startedAt === null) return null;
    return Math.max(0, Math.min(1, (at - current.startedAt) / current.variant.durationMs));
  }

  // The renderer owns the animation ticker. Advancing completion from that
  // same monotonic clock avoids a competing wall-clock timeout lifecycle.
  function update(at = playbackClock.now()) {
    if (!current || current.startedAt === null) return false;
    if (at - current.startedAt < current.variant.durationMs) return false;
    return completeCurrent();
  }

  function snapshot() {
    return current ? {
      decisionId: current.envelope.decisionId,
      cueId: current.cue.id,
      variantId: current.variant.id,
      startedAt: current.startedAt,
      durationMs: current.variant.durationMs
    } : null;
  }

  return { presentCue, cancelCurrent, update, progress, snapshot };
}

function appendParticles(target, additions, maximum = 160) {
  if (!Array.isArray(target) || !Array.isArray(additions)) throw new TypeError('particle arrays are required');
  const cap = Math.max(0, Math.floor(maximum));
  if (cap === 0) return [];
  return [...target, ...additions].slice(-cap);
}

// 渲染进程以 classic <script> 共享全局词法作用域加载本文件，
// 顶层标识符必须是本文件专属，否则同页面的后续脚本会在编译期整体失败。
const petPlayerApi = { createPetPlayer, appendParticles, TERMINAL, CANCELLATION_REASONS };



export default petPlayerApi;
export { createPetPlayer, appendParticles, TERMINAL, CANCELLATION_REASONS };
