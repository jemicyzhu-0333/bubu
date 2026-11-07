'use strict';
const { randomUUID } = require('node:crypto');
const { FIXTURE_TRANSPORT_SCOPE: scope, isPureFixtureTranslation, readFixtureTranslation } = require('../../../core/pet-fixture-transport.mjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const point = (rect, d) => ({ ...rect, x: rect.x + d.x, y: rect.y + d.y });
const validRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]) && Math.abs(r[k]) <= 100000) && r.width > 0 && r.height > 0;
function record(value, keys) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), copy = {};
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    for (const key of keys) {
      if (!descriptors[key] || !Object.hasOwn(descriptors[key], 'value')) return null;
      copy[key] = descriptors[key].value;
    }
    return copy;
  } catch { return null; }
}
function samePosition(a, b) {
  return a?.available && b?.available && ['logicalAnchor', 'backingBounds', 'contentBounds', 'geometry'].every(k => same(a[k], b[k]));
}

// One collector-owned transaction, not a renderer command or drag controller.
// No timers, retry, persistence, global registry, or native/compositor claim.
function createPetFixtureTransport({ isActive, captureDocument, observe, observeRaw, leaseSnapshot,
  migrateLease, moveNative, commitAnchor, publish, revoke, displayAt, newId = randomUUID }) {
  let setup = null, attempt = null;
  function owner() {
    if (!isActive()) throw Error('fixture-isolation-unavailable');
    const document = captureDocument();
    if (!document || (setup && document !== setup.document)) throw Error('fixture-document-changed');
    const lease = leaseSnapshot();
    if (!lease) throw Error('fixture-lease-unavailable');
    if (setup && lease.generationFloor !== (attempt?.generation ?? setup.generationFloor)) throw Error('fixture-contact-changed');
    return { document, lease };
  }
  function readView(raw = false) { return (raw ? observeRaw() : observe()); }
  function actual() { try { owner(); return readView(true)?.presentationView ?? null; } catch { return null; } }
  function response(ok, extra = {}) { return Object.freeze({ ok, scope, ...extra }); }
  function failed(error, extra = {}) { return response(false, { reason: error.message || 'fixture-operation-failed', ...extra }); }
  function snapshot() {
    owner();
    const value = readView();
    owner();
    return value;
  }
  function display(view) {
    const r = view.backingBounds;
    const d = displayAt({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    if (!d || !Number.isSafeInteger(d.id) || !validRect(d.workArea) || !validRect(d.bounds)
        || !Number.isFinite(d.scaleFactor) || ![0, 90, 180, 270].includes(d.rotation)) throw Error('fixture-display-unavailable');
    return JSON.stringify([d.id, d.bounds, d.workArea, d.scaleFactor, d.rotation]);
  }
  function context(value) {
    if (!value?.presentationView?.available || !same(value.pointerSpace, setup.pointerSpace)
        || display(value.presentationView) !== setup.display) throw Error('fixture-context-changed');
  }
  function activeLease(value) {
    const current = owner().lease;
    if (!current.active || current.epoch !== attempt.epoch || current.active.generation !== attempt.generation
        || current.viewRevision !== value.presentationView.revision) throw Error('fixture-contact-inactive');
    return current;
  }
  function cancel() {
    if (attempt) attempt.status = 'aborted';
    // A replacement document/contact is never ours to revoke, even when a
    // native call re-enters synchronously before returning or throwing.
    if (!setup || captureDocument() !== setup.document
        || leaseSnapshot()?.generationFloor !== (attempt?.generation ?? setup.generationFloor)) return;
    revoke();
    try { if (isActive()) publish(readView()); } catch { /* Native observation can remain unknown. */ }
  }
  function move(targetAnchor, targetBacking) {
    moveNative(targetBacking.x, targetBacking.y);
    // A synchronous native event may revoke ownership during the command.
    owner();
    commitAnchor(targetAnchor);
  }
  function expected(request, keys) {
    const copy = record(request, keys);
    if (!copy) throw Error('fixture-request-invalid');
    return copy;
  }
  function probe(request, keys) {
    const copy = expected(request, keys);
    if (!attempt || copy.probeId !== attempt.probeId) throw Error('fixture-probe-mismatch');
    owner();
    return copy;
  }
  return Object.freeze({
    prepareFixture() {
      let attempted = false;
      try {
        const current = owner();
        if (setup) throw Error('fixture-setup-used');
        const before = snapshot(), view = before.presentationView;
        if (!view?.available || current.lease.active || leaseSnapshot().active) throw Error('fixture-not-quiescent');
        const displayKey = display(view), d = displayAt({ x: view.backingBounds.x + view.backingBounds.width / 2,
          y: view.backingBounds.y + view.backingBounds.height / 2 }), area = d.workArea, b = view.backingBounds;
        if (area.width < b.width + 64 || area.height < b.height + 64) throw Error('fixture-workarea-too-small');
        const target = { ...b, x: Math.max(area.x + 32, Math.min(b.x, area.x + area.width - b.width - 32)),
          y: Math.max(area.y + 32, Math.min(b.y, area.y + area.height - b.height - 32)) };
        const anchor = { ...view.logicalAnchor, x: target.x + (target.width - view.logicalAnchor.width) / 2,
          y: target.y + (target.height - view.logicalAnchor.height) / 2 };
        setup = { setupId: newId(), document: current.document, generationFloor: current.lease.generationFloor,
          original: view, prepared: null, pointerSpace: JSON.parse(JSON.stringify(before.pointerSpace)), display: displayKey, cleanupUsed: false };
        owner(); attempted = true; move(anchor, target);
        const after = snapshot();
        context(after);
        const shift = { x: target.x - b.x, y: target.y - b.y };
        if (!same(after.presentationView.logicalAnchor, anchor) || !same(after.presentationView.backingBounds, target)
            || !same(after.presentationView.contentBounds, point(view.contentBounds, shift))) throw Error('fixture-preparation-mismatch');
        setup.prepared = after.presentationView; publish(after);
        return response(true, { setupId: setup.setupId, before: view, prepared: setup.prepared });
      } catch (error) {
        if (attempted) cancel();
        return failed(error, { setupId: setup?.setupId ?? null, attempted, view: actual() });
      }
    },
    arm(request) {
      try {
        const q = expected(request, ['setupId', 'probeId', 'epoch', 'contactGeneration', 'viewRevision']);
        // The first admitted contact is bound here, after quiescent preparation.
        if (!isActive() || !setup || setup.document !== captureDocument()) throw Error('fixture-document-changed');
        if (q.setupId !== setup.setupId || !setup.prepared || attempt || setup.cleanupUsed || typeof q.probeId !== 'string' || !UUID.test(q.probeId)) throw Error('fixture-arm-invalid');
        const value = readView(), lease = leaseSnapshot();
        if (!lease?.active || q.epoch !== lease.epoch || q.contactGeneration !== lease.active.generation
            || q.viewRevision !== lease.viewRevision || !samePosition(value.presentationView, setup.prepared)) throw Error('fixture-arm-contact-mismatch');
        context(value);
        attempt = { probeId: q.probeId, epoch: q.epoch, generation: q.contactGeneration,
          origin: value.presentationView, current: value.presentationView, step: 0, status: 'armed' };
        owner();
        return response(true, { probeId: q.probeId, delta: Object.freeze({ x: 24, y: 16 }), originView: attempt.origin });
      } catch (error) { return failed(error, { attempted: false, view: actual() }); }
    },
    translate(request) {
      let attempted = false;
      try {
        const q = probe(request, ['probeId', 'step']);
        if (!['armed', 'translated'].includes(attempt.status) || q.step !== attempt.step + 1 || ![1, 2].includes(q.step)) throw Error('fixture-step-invalid');
        const before = snapshot(); context(before);
        if (!same(before.presentationView, attempt.current)) throw Error('fixture-view-changed');
        const lease = activeLease(before), delta = { x: q.step === 1 ? 24 : -24, y: q.step === 1 ? 16 : -16 };
        const anchor = point(before.presentationView.logicalAnchor, delta), backing = point(before.presentationView.backingBounds, delta);
        // Mark consumed before entering native code. An exception is never replayable.
        attempt.status = 'moving'; attempted = true; move(anchor, backing);
        const after = readView(true); owner(); context(after);
        const receipt = readFixtureTranslation({ schemaVersion: 1, scope, probeId: attempt.probeId, step: q.step,
          epoch: attempt.epoch, contactGeneration: attempt.generation, fromRevision: before.presentationView.revision,
          toRevision: after.presentationView.revision, delta, before: before.presentationView, after: after.presentationView });
        if (!receipt || !isPureFixtureTranslation(before.presentationView, after.presentationView, delta)) throw Error('fixture-translation-mismatch');
        if (!migrateLease(lease, after)) throw Error('fixture-lease-migration-refused');
        attempt.current = after.presentationView; attempt.step = q.step; attempt.status = q.step === 1 ? 'translated' : 'returned';
        if (!publish(after, receipt)) throw Error('fixture-publication-failed');
        activeLease(after);
        return response(true, { probeId: q.probeId, step: q.step, view: after.presentationView, receipt });
      } catch (error) {
        if (attempt && !['fixture-step-invalid', 'fixture-probe-mismatch', 'fixture-request-invalid'].includes(error.message)) cancel();
        return failed(error, { attempted, probeId: attempt?.probeId ?? null, view: actual() });
      }
    },
    read() {
      try {
        const value = snapshot();
        return response(true, { view: value.presentationView, status: attempt?.status ?? (setup ? 'prepared' : 'unprepared'),
          probeId: attempt?.probeId ?? null, step: attempt?.step ?? 0 });
      } catch (error) { return failed(error, { attempted: false, view: null }); }
    },
    finish(request) {
      try {
        const q = probe(request, ['probeId']), value = snapshot(); context(value); activeLease(value);
        if (attempt.status !== 'returned' || !samePosition(value.presentationView, attempt.origin)) throw Error('fixture-return-unconfirmed');
        attempt.status = 'finished';
        return response(true, { probeId: q.probeId, view: value.presentationView });
      } catch (error) { return failed(error, { attempted: false, view: actual() }); }
    },
    abort(request) {
      try {
        const q = probe(request, ['probeId']); cancel();
        return response(true, { probeId: q.probeId, view: actual() });
      } catch (error) { return failed(error, { attempted: false, view: null }); }
    },
    restoreFixture(request) {
      let attempted = false;
      try {
        const q = expected(request, ['setupId']); owner();
        if (!setup || q.setupId !== setup.setupId || setup.cleanupUsed) throw Error('fixture-cleanup-invalid');
        const before = snapshot(); context(before);
        setup.cleanupUsed = true;
        cancel(); owner();
        attempted = true; move(setup.original.logicalAnchor, setup.original.backingBounds);
        const after = snapshot(); context(after); publish(after);
        const confirmed = samePosition(after.presentationView, setup.original);
        return response(confirmed, { setupId: q.setupId, attempted, confirmed, view: after.presentationView,
          reason: confirmed ? null : 'fixture-restoration-mismatch' });
      } catch (error) {
        if (attempted) cancel();
        return failed(error, { setupId: setup?.setupId ?? null, attempted, confirmed: false, view: actual() });
      }
    }
  });
}
module.exports = { createPetFixtureTransport };
