'use strict';

const path = require('node:path');
const { createPetRuntimeFixture } = require('./pet-runtime-fixture');
const ROOT = path.resolve(__dirname, '..');
const PET_CONTENT_PAYLOAD = Object.freeze({ manifest: { cues: [] }, EXPRESSIONS: [], INTERACTIONS: { clickCount: {} } });
// Sync cases use minimal content, CSS property setters and a live motion driver.
const createHarness = createPetRuntimeFixture({ contentPayload: PET_CONTENT_PAYLOAD,
  styleProperties: true, liveReducedMotion: true });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function settle() { return new Promise(resolve => setImmediate(() => setImmediate(resolve))); }
function ring(sessionId = 'new-session', mode = 'focus') {
  return { sessionId, mode, plannedMs: 25 * 60_000, elapsedMs: 60_000, running: true };
}
function snapshot(overrides = {}) {
  return { state: 'idle', energy: { level: 20 }, level: 1, satiation: 25,
    focusRing: null, paused: false, screenLocked: false, skin: 'pink', work: { start: 10, end: 21 },
    stimulationMode: 'high', motionMode: 'full', dnd: false, ...overrides };
}
function send(harness, packet) { harness.bridge.handlers.sync(packet); }
function sample(harness) {
  return { state: harness.runtime.sample().state, paused: harness.runtime.sample().sessionPaused,
    locked: harness.runtime.sample().screenLocked, ring: harness.document.getElementById('stage').dataset.ring ?? null,
    motion: harness.document.body.dataset.motion, stimulation: harness.document.body.dataset.stimulation };
}
module.exports = { ROOT, createHarness, deferred, settle, ring, snapshot, send, sample, PET_CONTENT_PAYLOAD };
