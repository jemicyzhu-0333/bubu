'use strict';
const { FIXTURE_TRANSPORT_SCOPE: scope, readFixtureTranslation } = require('../../src/core/pet-fixture-transport.mjs');
const { bounds } = require('./movement-probe.cjs');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1000000 && Math.abs(p.y) <= 1000000;
const closePoint = (a, b, tolerance = .75) => point(a) && point(b) && Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
const delta = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const positioned = (a, b) => a?.available && b?.available
  && ['logicalAnchor', 'backingBounds', 'contentBounds', 'geometry'].every(key => same(a[key], b[key]));
function unavailable(reason) {
  return { schemaVersion: 1, scope, status: 'unavailable', reason, legs: [],
    pointerDriven: false, OSInputProven: false, eventMatched: false, compositorAcknowledged: false,
    nativeCaptureProven: false, cleanup: { attempted: false, confirmed: false }, requiresDispose: false };
}
/** Fixed, one-contact fixture experiment. Never a native drag controller or OS proof. */
async function probeHeldTransport({ assertCurrent, renderer, host, input, readNative, delay, now, probeId, identity }) {
  const result = { ...unavailable(null), ...identity, probeId, status: 'incomplete', toleranceDIP: .75,
    semantics: 'fixed-programmatic-window-hop-with-independent-captured-actor-grip-observation',
    coordinateSource: 'caller-supplied-controlled-fixture-not-OS' };
  let setupId = null, armed = false, prepared = false, paused = false, failed = false;
  let contact = null, observedTerminal = false;
  let unknown = false, holdDeadline = null, activeDeadline = now() + 2000;
  const budget = () => {
    assertCurrent();
    const remaining = (holdDeadline ?? activeDeadline) - now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw Error('held-transport-deadline');
    return Math.min(remaining, 2000);
  };
  async function operation(run, mutating = false) {
    const remaining = budget(); let entered = false;
    try {
      entered = true; const value = await run(remaining); budget();
      if (mutating && value?.ok === false && value.attempted === true) unknown = true;
      return value;
    } catch (error) { if (mutating && entered) unknown = true; throw error; }
  }
  function ownerHighWater(value) {
    const highWater = value?.contactGenerationHighWater;
    const expected = result.contactGeneration ?? result.initialContactGenerationHighWater;
    if (expected !== undefined && (!Number.isSafeInteger(highWater) || highWater !== expected))
      throw Error('held-transport-contact-replaced');
  }
  async function render(method, arg, mutating = false) {
    const value = await operation(ms => renderer(method, arg, ms), mutating);
    if (method === 'readDiagnostics' && result.contactGeneration !== undefined) ownerHighWater(value?.stage);
    if (method === 'readFixtureTransport' && result.contactGeneration !== undefined) ownerHighWater(value);
    return value;
  }
  const native = (method, arg, mutating = false) => operation(ms => host(method, arg, ms), mutating);
  function accepted(value) {
    if (value?.scope !== scope || value.ok !== true) throw Error('held-transport-operation-rejected');
    return value;
  }
  async function pauseOwned() {
    const intent = { instanceId: identity.instanceId, action: 'pause',
      contactGenerationHighWater: result.contactGeneration ?? result.initialContactGenerationHighWater };
    const receipt = accepted(await render('cleanupFixtureTransport', intent, true));
    if (receipt.attempted !== true || receipt.instanceId !== intent.instanceId || receipt.action !== intent.action
        || receipt.contactGenerationHighWater !== intent.contactGenerationHighWater) throw Error('held-transport-cleanup-receipt-invalid');
    return receipt;
  }
  async function until(read, predicate, cadence = 4) {
    // Fixed count is a second bound for malformed/frozen clocks in injected ports.
    for (let i = 0; i < 512; i++) {
      const value = await read(); if (predicate(value)) return value;
      const remaining = budget(); await operation(() => delay(Math.min(cadence, remaining)));
    }
    throw Error('held-transport-poll-limit');
  }
  async function quiescent() {
    return until(async () => {
      const geometry = await render('readWindowGeometry');
      const diagnostics = await render('readDiagnostics', { afterSequence: 0, limit: 1 });
      return { geometry, diagnostics };
    }, ({ geometry: g, diagnostics: d }) => g.ready === true && g.closed === false && g.paused === true
      && g.pointerId === null && g.captured === false && g.domPointerCapture === false && g.pendingCount === 0
      && d.inputLease?.held === false && d.inputLease?.inFlight === false && d.inputLease?.pendingEnd === false);
  }
  function held(value, step) {
    if (value?.probeId === probeId && value.terminal === true) observedTerminal = true;
    accepted(value);
    if (value.probeId !== probeId || value.terminal !== false || value.step !== step
        || !point(value.gripClient) || !value.view?.available || value.inputMotion?.mode !== 'event-screen-dip'
        || value.inputLease?.held !== true || value.inputLease?.inFlight !== false
        || !value.inputLease?.fixtureHold || value.inputLease.remainingMs <= 0
        || value.inputLease.fixtureHold.probeId !== probeId || value.inputLease.fixtureHold.step !== step
        || value.inputLease.fixtureHold.epoch !== contact.epoch
        || value.inputLease.fixtureHold.contactGeneration !== contact.contactGeneration
        || value.inputLease.fixtureHold.viewRevision !== value.view.revision) throw Error('held-transport-contact-ended');
    return value;
  }
  async function awaitNaturalTail(requireActivity = false) {
    activeDeadline = now() + 6000;
    const evidence = { landingObserved: false, interactionTailObserved: false };
    const value = await until(async () => {
      const value = await render('readDiagnostics', { afterSequence: 0, limit: 1 });
      if (value.stage?.contactGeneration !== null && value.stage?.contactGeneration !== result.contactGeneration)
        throw Error('held-transport-contact-replaced');
      evidence.landingObserved ||= value.stage?.pointerId === null && value.stage?.mode === 'landing';
      evidence.interactionTailObserved ||= value.stage?.pointerId === null && value.stage?.interactionTailActive === true;
      return value;
    }, value => value.stage?.mode === 'idle' && value.stage?.pointerId === null
      && value.stage?.captured === false && value.stage?.pendingCount === 0 && value.stage?.interactionTailActive === false, 20);
    if (requireActivity && !evidence.landingObserved && !evidence.interactionTailObserved)
      throw Error('held-transport-release-tail-unobserved');
    return { value, evidence };
  }
  function observation(value) {
    const nativeBounds = bounds(readNative());
    if (!same(nativeBounds, value.view.backingBounds)) throw Error('held-transport-native-view-mismatch');
    const client = { x: value.gripClient.x, y: value.gripClient.y };
    return { nativeBounds, view: value.view, contactGenerationHighWater: value.contactGenerationHighWater, gripClient: client,
      gripGlobal: { x: value.view.contentBounds.x + client.x, y: value.view.contentBounds.y + client.y } };
  }
  try {
    // Capability absence is a truthful deferred result and does not manufacture a contact.
    const first = await render('readDiagnostics', { afterSequence: 0, limit: 1 });
    if (first.stage?.inputMotion?.mode !== 'event-screen-dip' || first.inputLease?.capability?.available !== true) {
      result.status = 'unavailable'; result.reason = 'held-transport-runtime-capability-unavailable'; return result;
    }
    result.initialContactGenerationHighWater = first.stage?.contactGenerationHighWater ?? null;
    if (!Number.isSafeInteger(result.initialContactGenerationHighWater) || result.initialContactGenerationHighWater < 0)
      throw Error('held-transport-contact-history-unavailable');
    if (first.stage?.pointerId !== null || first.stage?.captured !== false || first.stage?.pendingCount !== 0)
      throw Error('held-transport-unowned-contact');
    result.preparationPause = await pauseOwned(); paused = true; await quiescent();
    const setup = await native('prepareFixture', undefined, true); result.setup = setup;
    setupId = setup?.setupId ?? null; accepted(setup);
    await until(() => render('readWindowGeometry'), value => same(value.presentationView, setup.prepared));
    await render('pause', false, true); paused = false;
    const state = await render('readDiagnostics', { afterSequence: 0, limit: 1 }), target = state.stage?.inputTargets?.body;
    if (!point(target)) throw Error('held-transport-body-target-unavailable');
    result.down = await operation(ms => input('mouseDown', target, ms), true);
    const admitted = await until(() => render('readDiagnostics', { afterSequence: 0, limit: 1 }), value =>
      value.stage?.captured === true && value.stage?.pendingCount === 0 && Number.isSafeInteger(value.stage?.contactGeneration));
    result.contactGeneration = admitted.stage.contactGeneration;
    ownerHighWater(admitted.stage);
    result.drag = await operation(ms => input('mouseMove', { x: target.x + 28, y: target.y - 32 }, ms), true);
    await until(() => render('readDiagnostics', { afterSequence: 0, limit: 1 }), value => value.stage?.mode === 'drag'
      && value.stage?.captured === true && value.stage?.pendingCount === 0 && value.inputLease?.held === true
      && value.inputLease?.remainingMs >= 200 && value.inputLease?.inFlight === false);
    // The deadline is deliberately conservative: charge the prepare roundtrip against it.
    const beforePrepare = now();
    const capture = accepted(await render('prepareFixtureTransport', { probeId }, true)); prepared = true; contact = capture; result.prepared = capture;
    if (capture.contactGeneration !== result.contactGeneration) throw Error('held-transport-contact-replaced');
    if (!Number.isFinite(capture.remainingMs) || capture.remainingMs < 150 || capture.remainingMs > 300) throw Error('held-transport-lease-too-short');
    holdDeadline = beforePrepare + capture.remainingMs;
    const arm = accepted(await native('arm', { setupId, probeId, epoch: capture.epoch,
      contactGeneration: capture.contactGeneration, viewRevision: capture.viewRevision }, true)); armed = true; result.arm = arm;
    if (!same(arm.delta, { x: 24, y: 16 }) || !same(arm.originView, capture.view)) throw Error('held-transport-arm-mismatch');
    let current = held(await render('readFixtureTransport', { probeId }), 0);
    const origin = observation(current); result.origin = origin;
    for (const step of [1, 2]) {
      const before = observation(current), displacement = step === 1 ? { x: 24, y: 16 } : { x: -24, y: -16 };
      const leg = { step, requestedDelta: displacement, before }; result.legs.push(leg);
      leg.eventReceipt = await operation(ms => input('mouseMove', { x: before.gripClient.x + displacement.x,
        y: before.gripClient.y + displacement.y }, ms), true);
      const frame = current.renderedFrames, events = current.inputMotion.total;
      current = await until(async () => held(await render('readFixtureTransport', { probeId }), step - 1), value =>
        value.pendingCount === 0 && value.renderedFrames > frame && value.inputMotion.total > events);
      const row = current.inputMotion.rows?.at(-1);
      if (!row || row.sequence <= events || row.type !== 'pointermove' || row.source !== 'event-screen-dip'
          || row.reason !== null || row.domCaptured !== true || !closePoint(row.client, leg.eventReceipt.local)
          || !closePoint(row.motion, leg.eventReceipt.global)) throw Error('held-transport-controlled-event-unverified');
      leg.controlledEventObservation = row;
      const beforeHop = observation(current); leg.afterEvent = beforeHop;
      if (!closePoint(beforeHop.gripClient, origin.gripClient)) throw Error('held-transport-local-grip-moved');
      const moved = await native('translate', { probeId, step }, true); leg.host = moved; accepted(moved);
      const receipt = readFixtureTranslation(moved.receipt);
      if (!receipt || receipt.probeId !== probeId || receipt.step !== step || receipt.epoch !== capture.epoch
          || receipt.contactGeneration !== capture.contactGeneration || !same(receipt.before, beforeHop.view)
          || !same(receipt.after, moved.view)) throw Error('held-transport-receipt-invalid');
      current = await until(async () => {
        const value = await render('readFixtureTransport', { probeId });
        // A terminal is never a retryable wait, even between the two translations.
        held(value, value.step);
        if (![step - 1, step].includes(value.step)) throw Error('held-transport-step-invalid');
        return value;
      }, value => value.step === step && same(value.view, moved.view));
      leg.after = observation(current); leg.actualNativeDisplacement = delta(before.nativeBounds, leg.after.nativeBounds);
      leg.actualGlobalDisplacement = delta(before.gripGlobal, leg.after.gripGlobal);
      leg.localGripPreserved = closePoint(before.gripClient, leg.after.gripClient);
      leg.singleGlobalDisplacement = closePoint(leg.actualGlobalDisplacement, displacement);
      if (!leg.localGripPreserved || !leg.singleGlobalDisplacement || !closePoint(leg.actualNativeDisplacement, displacement, 0))
        throw Error('held-transport-displacement-mismatch');
    }
    if (!positioned(origin.view, current.view)) throw Error('held-transport-return-mismatch');
    result.hostFinish = accepted(await native('finish', { probeId }, true));
    result.rendererFinish = accepted(await render('finishFixtureTransport', { probeId }, true));
    if (!closePoint(result.rendererFinish.gripClient, current.gripClient)) throw Error('held-transport-finish-grip-mismatch');
    holdDeadline = null; activeDeadline = now() + 2000;
    result.release = await operation(ms => input('mouseUp', result.rendererFinish.gripClient, ms), true);
    const { value: released, evidence: tailEvidence } = await awaitNaturalTail(true);
    const finished = accepted(await render('readFixtureTransport', { probeId }));
    if (finished.probeId !== probeId || finished.step !== 2 || finished.finished !== true || finished.releaseObserved !== true || finished.domCaptured !== false || !same(finished.view, current.view))
      throw Error('held-transport-finished-owner-unverified');
    result.releaseObserved = { mode: released.stage.mode, contactGeneration: released.stage.contactGeneration,
      acceptedContactGeneration: contact.contactGeneration, contactGenerationHighWater: released.stage.contactGenerationHighWater,
      releaseObserved: finished.releaseObserved, domCaptured: finished.domCaptured, ...tailEvidence, interactionTailActive: released.stage.interactionTailActive,
      captured: released.stage.captured, pendingCount: released.stage.pendingCount, naturalTailSettled: true };
    result.status = 'completed';
  } catch (error) {
    failed = true; result.status = 'incomplete';
    result.reason = /^held-transport-[a-z-]+$/.test(error.message) ? error.message : 'held-transport-operation-failed-or-invalidated';
  } finally {
    if (setupId || paused || prepared) {
      holdDeadline = null; activeDeadline = now() + 2000;
      try {
        assertCurrent();
        if (unknown) throw Error('held-transport-mutation-outcome-unknown');
        if (failed && prepared) {
          // A known native rejection can race an up queued after our last read.
          // Inspect the exact old transaction before issuing any cancellation.
          const terminal = await render('readFixtureTransport', { probeId });
          if (terminal?.probeId === probeId && terminal.terminal === true) observedTerminal = true;
        }
        const owner = await render('readDiagnostics', { afterSequence: 0, limit: 1 });
        ownerHighWater(owner.stage);
        if (owner.stage?.pointerId !== null && owner.stage?.contactGeneration !== result.contactGeneration)
          throw Error('held-transport-contact-replaced');
        if (failed && observedTerminal) {
          const { value: terminal, evidence } = await awaitNaturalTail();
          result.earlyTerminal = { tailQuiescentObserved: true,
            ...evidence, mode: terminal.stage.mode, contactGeneration: terminal.stage.contactGeneration,
            contactGenerationHighWater: terminal.stage.contactGenerationHighWater, interactionTailActive: terminal.stage.interactionTailActive };
        }
        if (failed && prepared) accepted(await render('cancelFixtureTransport', { probeId }, true));
        if (failed && armed) accepted(await native('abort', { probeId }, true));
        result.cleanup.pause = await pauseOwned(); paused = true;
        const settled = await quiescent();
        result.cleanup.contactGenerationHighWater = settled.diagnostics.stage.contactGenerationHighWater;
        if (setupId) {
          result.cleanup.attempted = true;
          result.cleanup.receipt = await native('restoreFixture', { setupId }, true);
          result.cleanup.confirmed = result.cleanup.receipt?.ok === true && result.cleanup.receipt?.confirmed === true;
          if (!result.cleanup.confirmed) throw Error('held-transport-restoration-unverified');
        }
      } catch {
        result.cleanup.reason = unknown ? 'held-transport-mutation-outcome-unknown' : 'held-transport-cleanup-unverified';
        result.status = 'incomplete'; result.requiresDispose = true;
      }
    }
    if (unknown) { result.mutationOutcomeUnknown = true; result.requiresDispose = true; result.status = 'incomplete'; }
  }
  return result;
}
module.exports = { probeHeldTransport, unavailable };
