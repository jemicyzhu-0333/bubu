import { FIXTURE_TRANSPORT_SCOPE as scope, readFixtureTranslation, readFixtureTransportCapability } from '../../../core/pet-fixture-transport.mjs';
import { readInputLeaseCapability } from '../../../core/pet-input-lease.mjs';

function same(a, b, depth = 0) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || depth > 10 || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key], depth + 1));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function request(value) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const d = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(d).length === 1 && Object.hasOwn(d.probeId ?? {}, 'value')
      && typeof d.probeId.value === 'string' && UUID.test(d.probeId.value) ? d.probeId.value : null;
  } catch { return null; }
}
const returned = (a, b) => ['logicalAnchor', 'backingBounds', 'contentBounds', 'geometry'].every(key => same(a[key], b[key]));
function cleanupRequest(value) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const d = Object.getOwnPropertyDescriptors(value), keys = ['instanceId', 'contactGenerationHighWater', 'action'];
    if (Reflect.ownKeys(d).length !== keys.length || keys.some(key => !Object.hasOwn(d[key] ?? {}, 'value'))) return null;
    const instanceId = d.instanceId.value, contactGenerationHighWater = d.contactGenerationHighWater.value, action = d.action.value;
    if (typeof instanceId !== 'string' || !instanceId.length || instanceId.length > 128 || instanceId === 'unavailable'
        || !Number.isSafeInteger(contactGenerationHighWater) || contactGenerationHighWater < 0
        || !['pause', 'dispose'].includes(action)) return null;
    return { instanceId, contactGenerationHighWater, action };
  } catch { return null; }
}
function cleanupOwner(owner, generation) {
  return Boolean(owner && owner.contactGenerationHighWater === generation && owner.pendingCount === 0
    && (owner.pointerId === null ? owner.captured === false && owner.interactionTailActive === false
      : Number.isSafeInteger(owner.pointerId) && owner.pointerId >= 0 && generation > 0 && owner.contactGeneration === generation));
}

/** Collector-only coordination. The actor owns the grip and clock; this owns only
 * one bounded geometry transaction. No pointer/native capture or landing policy. */
export function createFixtureTransport({ now, readState, inputLease, pauseSurface, disposeSurface, onError = () => {} }) {
  let capability = null, session = null, used = false, closed = false;
  const result = (ok, fields = {}) => ({ ok, scope, ...fields });
  function currentGrip() {
    return session ? readState().stage?.readFixtureGrip?.(session.probeId) ?? null : null;
  }
  function gripValid(grip, allowQueue = false) {
    return grip?.ok === true && grip.contactGeneration === session.contactGeneration
      && same(grip.stamp, session.stamp) && (grip.pendingCount === 0 || allowQueue);
  }
  function invalidate() {
    if (!session || session.finished || session.invalid) return;
    session.invalid = true;
    try { readState().stage?.cancelFixtureGrip?.(session.probeId); }
    catch (error) { onError(error); }
    inputLease.update(readState().stage?.readInteraction?.() ?? null, false);
    inputLease.releaseFixtureHold(session.probeId);
  }
  function observeCapability(value) {
    const next = readFixtureTransportCapability(value);
    if (session && !same(next, capability)) invalidate();
    capability = next;
  }
  function prepare(value) {
    const probeId = request(value), state = readState(), motion = state.stage?.readDiagnostics?.().inputMotion;
    if (closed || used || !probeId || !capability || !state.enabled || state.blocked || !state.view?.available
        || state.pointerSpace?.kind !== 'event-screen-dip' || motion?.mode !== 'event-screen-dip'
        || !same(motion.capability, state.pointerSpace)) return result(false, { reason: 'fixture-transport-unavailable' });
    const owner = state.stage.readInteraction?.();
    if (owner?.mode !== 'drag') return result(false, { reason: 'fixture-drag-required' });
    const hold = inputLease.holdFixture({ probeId, contactGeneration: owner.contactGeneration });
    if (!hold.ok || hold.viewRevision !== state.view.revision) {
      if (hold.ok) inputLease.releaseFixtureHold(probeId);
      return result(false, { reason: 'fixture-lease-unsettled' });
    }
    used = true;
    const grip = state.stage.prepareFixtureGrip?.({ probeId });
    if (!grip?.ok || grip.contactGeneration !== hold.contactGeneration || grip.pendingCount !== 0) {
      state.stage.cancelFixtureGrip?.(probeId);
      inputLease.update(state.stage.readInteraction?.() ?? null, false);
      inputLease.releaseFixtureHold(probeId);
      return result(false, { reason: 'fixture-grip-unavailable' });
    }
    session = { probeId, epoch: hold.epoch, contactGeneration: hold.contactGeneration, step: 0,
      origin: structuredClone(state.view), current: structuredClone(state.view), space: structuredClone(state.pointerSpace),
      stamp: structuredClone(grip.stamp), invalid: false, finished: false, terminal: false };
    return result(true, { probeId, ...hold, gripClient: structuredClone(grip.gripClient), view: structuredClone(state.view) });
  }
  function acceptViewport(value) {
    if (closed || !session || session.invalid || session.finished) return false;
    const state = readState(), receipt = readFixtureTranslation(value?.fixtureTranslation);
    if (state.enabled && !state.blocked && same(value?.presentationView, session.current)
        && same(state.view, session.current) && same(value.pointerSpace, session.space)
        && same(readFixtureTransportCapability(value.fixtureTransport), capability)
        && same(readInputLeaseCapability(value.inputLease), inputLease.snapshot().capability)
        && (!Object.hasOwn(value, 'fixtureTranslation') || receipt && receipt.probeId === session.probeId
          && receipt.step === session.step && same(receipt.after, session.current))) return true;
    if (!receipt || !state.enabled || state.blocked || !capability || !same(readFixtureTransportCapability(value.fixtureTransport), capability)
        || receipt.probeId !== session.probeId || receipt.epoch !== session.epoch || receipt.contactGeneration !== session.contactGeneration
        || receipt.step !== session.step + 1 || !same(receipt.before, session.current) || !same(state.view, session.current)
        || !same(receipt.after, value.presentationView) || !same(value.pointerSpace, session.space)) return false;
    const nextLease = readInputLeaseCapability(value.inputLease), oldLease = inputLease.snapshot().capability;
    if (!nextLease || nextLease.epoch !== session.epoch || !oldLease || !same(nextLease, { ...oldLease, viewRevision: receipt.toRevision })) return false;
    const grip = currentGrip();
    if (!gripValid(grip, true)) return false;
    const terminal = grip.terminal === true;
    if (!terminal && (!grip.captured || !grip.domCaptured || grip.mode !== 'drag' || !inputLease.migrateFixtureView(receipt))) return false;
    // An already released contact is never revived. The down fence prevents a
    // late, strictly known translation from being assigned to a newer gesture.
    // A terminal may already be queued for the next actor frame. Do not invoke
    // capability-change cancellation here: that would erase its legitimate tail.
    // The ordinary frame consumes termination then publishes end; no old lease
    // or in-flight request is relabelled, renewed, or resurrected.
    session.current = receipt.after; session.step = receipt.step; session.terminal ||= terminal;
    return true;
  }
  function read(value) {
    const probeId = request(value), state = readState();
    if (closed || !session || probeId !== session.probeId) return result(false, { reason: 'fixture-probe-unavailable' });
    const grip = currentGrip(), diagnostics = state.stage?.readDiagnostics?.() ?? {};
    const valid = !session.invalid && grip?.ok === true && grip.contactGeneration === session.contactGeneration
      && same(grip.stamp, session.stamp) && same(state.view, session.current)
      && same(state.pointerSpace, session.space) && state.enabled;
    const terminal = session.terminal || grip?.terminal === true
      || session.finished && state.stage?.readInteraction?.()?.pointerId == null;
    const point = grip?.gripClient;
    return result(Boolean(valid), { probeId, step: session.step, terminal, finished: session.finished,
      gripObservation: session.finished ? 'lock-completion-snapshot' : 'current-deformed-surface',
      releaseObserved: grip?.releaseObserved === true, domCaptured: grip?.domCaptured ?? null,
      contactGenerationHighWater: diagnostics.contactGenerationHighWater ?? null,
      view: state.view ? structuredClone(state.view) : null,
      gripClient: point ? { ...point } : null,
      gripGlobal: point && state.view?.contentBounds ? { x: state.view.contentBounds.x + point.x, y: state.view.contentBounds.y + point.y } : null,
      pendingCount: grip?.pendingCount ?? null, renderedFrames: diagnostics.renderedFrames ?? null,
      inputMotion: diagnostics.inputMotion ?? null, inputLease: inputLease.snapshot() });
  }
  function finish(value) {
    const probeId = request(value), state = readState(), grip = currentGrip();
    if (closed || !session || session.invalid || session.finished || probeId !== session.probeId || session.step !== 2
        || !state.enabled || !gripValid(grip) || !same(state.view, session.current) || !returned(session.origin, session.current))
      return result(false, { reason: 'fixture-restoration-unconfirmed' });
    const ended = state.stage.finishFixtureGrip(probeId, { eventNotBefore: now() });
    if (!ended?.ok) { invalidate(); return result(false, { reason: 'fixture-disarm-failed' }); }
    session.finished = true;
    inputLease.releaseFixtureHold(probeId);
    return result(true, { probeId, terminal: session.terminal || grip.terminal === true, gripClient: ended.gripClient ?? grip.gripClient,
      view: structuredClone(session.current) });
  }
  function cleanup(value) {
    const intent = cleanupRequest(value), state = readState();
    if (!intent || closed || !capability || intent.instanceId !== state.instanceId)
      return result(false, { attempted: false, reason: 'fixture-cleanup-owner-unavailable' });
    const owner = state.stage?.readDiagnostics?.();
    // This check and the existing lifecycle mutation share one renderer task.
    // A prior collector read cannot authorize erasing a newer or queued contact:
    // queued down has not yet incremented the sole actor's generation counter.
    if (!cleanupOwner(owner, intent.contactGenerationHighWater))
      return result(false, { attempted: false, reason: 'fixture-cleanup-owner-changed-or-input-unsettled' });
    const apply = intent.action === 'pause' ? pauseSurface : disposeSurface;
    if (typeof apply !== 'function') return result(false, { attempted: false, reason: 'fixture-cleanup-unavailable' });
    apply();
    return result(true, { attempted: true, ...intent });
  }
  return Object.freeze({ observeCapability, prepare, acceptViewport, read, finish, invalidate, cleanup,
    cancel(value) {
      const probeId = request(value);
      if (!session || probeId !== session.probeId) return result(false, { reason: 'fixture-probe-unavailable' });
      // A terminal can arrive after the collector's last read but before this
      // call. Leave its queue and unowned tail to the original frame owner.
      if (!session.finished && !session.invalid && !cleanupOwner(readState().stage?.readDiagnostics?.(), session.contactGeneration))
        return result(false, { attempted: false, reason: 'fixture-cancel-input-unsettled-or-owner-changed' });
      invalidate(); return result(true, { probeId });
    },
    dispose() { if (closed) return; invalidate(); capability = null; closed = true; }
  });
}
