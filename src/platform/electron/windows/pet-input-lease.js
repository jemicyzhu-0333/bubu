'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { INPUT_LEASE_SCOPE, readInputLeaseRequest } = require('../../../core/pet-input-lease.mjs');

// ARCHITECTURE「V2 动画研究底座」: process-local input ownership only. This
// deadline is enforced when the main loop runs, not by an OS capture/watchdog.
function createPetInputLease({ now = () => performance.now(), newEpoch = randomUUID } = {}) {
  let epoch = newEpoch(), viewRevision = 0, available = false, context = null;
  let active = null, generationFloor = 0, lastTime = null;
  function revoke() { active = null; epoch = newEpoch(); }
  function time() {
    const value = now();
    if (!Number.isFinite(value) || value < 0 || (lastTime !== null && value < lastTime)) {
      revoke(); available = false; lastTime = null; return null;
    }
    lastTime = value;
    if (active && value >= active.deadline) revoke();
    return value;
  }
  function capability() {
    return Object.freeze({ schemaVersion: 1, epoch, viewRevision, available,
      ttlMs: 300, renewMs: 100, scope: INPUT_LEASE_SCOPE });
  }
  function observe(view, pointerSpace, ready) {
    const revision = Number.isSafeInteger(view?.revision) && view.revision > 0 ? view.revision : 0;
    const nextAvailable = Boolean(ready && view?.available && revision > 0);
    const nextContext = JSON.stringify([revision, pointerSpace]);
    if (context !== nextContext || available !== nextAvailable) revoke();
    viewRevision = revision; available = nextAvailable; context = nextContext;
    time();
    return capability();
  }
  function result(ok, request, reason = null) { return Object.freeze({ ok, request, capability: capability(), reason }); }
  return Object.freeze({
    capability,
    observe,
    revoke({ newDocument = false } = {}) { revoke(); if (newDocument) generationFloor = 0; },
    fail() { revoke(); available = false; },
    isActive() { time(); return Boolean(active); },
    apply(value) {
      const request = readInputLeaseRequest(value), at = time();
      if (!request) return result(false, null, 'invalid-request');
      if (at === null) return result(false, request, 'clock-unavailable');
      if (request.epoch !== epoch) return result(false, request, 'stale-epoch');
      if (request.viewRevision !== viewRevision) return result(false, request, 'stale-view');
      if (!available) return result(false, request, 'unavailable');
      if (request.phase === 'begin') {
        if (active) return result(false, request, 'contact-active');
        if (request.contactGeneration <= generationFloor) return result(false, request, 'stale-contact');
        generationFloor = request.contactGeneration;
        active = { generation: request.contactGeneration, sequence: request.sequence, deadline: at + 300 };
      } else {
        if (!active || request.contactGeneration !== active.generation) return result(false, request, 'contact-mismatch');
        if (request.sequence <= active.sequence) return result(false, request, 'stale-sequence');
        if (request.phase === 'end') active = null;
        else { active.sequence = request.sequence; active.deadline = at + 300; }
      }
      return result(true, request);
    }
  });
}
module.exports = { createPetInputLease };
