import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { createEventMotionSource } from '../../../../src/surfaces/pet/realtime/event-motion-source.mjs';

const probeId = 'fixture-grip-test';
const SPACE = { schemaVersion: 1, revision: 1, kind: 'event-screen-dip',
  runtime: { platform: 'win32', electron: '44.10.1', chromium: '152.0.7977.169' },
  bounds: { x: 0, y: 0, width: 2000, height: 1200 }, scaleFactor: 1.25 };
const near = (actual, expected, tolerance = 1e-7) => {
  for (const key of Object.keys(expected)) assert(Math.abs(actual[key] - expected[key]) <= tolerance,
    `${key}: ${actual[key]} != ${expected[key]}`);
};
async function setup() {
  let source;
  const f = await fixture({ readMotionPoint: event => source.read({ type: event.type, pointerId: event.pointerId,
    pointerType: 'mouse', isPrimary: event.isPrimary, isTrusted: true, timeStamp: event.timeStamp,
    clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY }) });
  // Simulated platform envelope on the actual D2 owner. This is not OS evidence.
  f.doc.pointerLockElement = null;
  source = createEventMotionSource({ document: f.doc, target: f.target });
  source.setSpace(SPACE, 0, () => { f.h.suspend(); f.h.resume(); });
  const emit = (type, t, props = {}) => {
    f.at(t);
    const event = new Event(type);
    Object.defineProperty(event, 'timeStamp', { value: props.domTime ?? t * 1000 });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, buttons: 1,
      ...f.point(), screenX: 700, screenY: 400, ...props });
    f.target.dispatchEvent(event);
  };
  const lift = () => {
    emit('pointerdown', .01); f.tick(.01);
    emit('pointermove', .1, { ...f.point(.4, 2.4), screenX: 730, screenY: 370 }); f.tick(.1);
    f.tick(1.6);
    assert.equal(f.h.state.mode, 'drag');
    assert(f.h.state.body.minimumFootY > f.h.body.initialGround + .5);
  };
  return { ...f, source, emit, lift, arm: () => f.h.prepareFixtureGrip({ probeId }),
    read: () => f.h.readFixtureGrip(probeId), finish: value => f.h.finishFixtureGrip(probeId, { eventNotBefore: value }) };
}

test('actual D2 fixture grip uses the live surface, fixes only the original target, and keeps pose/inertia/clock live', async () => {
  const f = await setup();
  try {
    f.lift(); const before = structuredClone(f.h.state); const armed = f.arm(); assert.equal(armed.ok, true);
    near(armed.gripWorld, armed.localGrip); assert.equal(armed.contactGeneration, 1);
    const globalBefore = { x: 100 + armed.gripClient.x, y: 200 + armed.gripClient.y };
    // A pure window translation does not modify the canvas/camera or stage root.
    f.emit('pointermove', 1.7, { clientX: armed.gripClient.x - 24, clientY: armed.gripClient.y - 16,
      screenX: 754, screenY: 386 });
    f.tick(1.7); const moving = f.tick(1.76); const read = f.read();
    near(read.localGrip, armed.localGrip); near(read.gripWorld, armed.gripWorld); near(read.gripClient, armed.gripClient);
    near({ x: 124 + read.gripClient.x, y: 216 + read.gripClient.y },
      { x: globalBefore.x + 24, y: globalBefore.y + 16 });
    assert(Math.hypot(moving.drag.lag.x, moving.drag.lag.y) > .05);
    assert.notDeepEqual(moving.body.jointQuaternions, before.body.jointQuaternions);
    assert.notDeepEqual(moving.body.root, before.body.root, 'root still performs the ordinary deformed grip correction');
    assert(moving.time > before.time); assert(f.h.owner.assertCurrent());
    assert.equal(f.source.snapshot().rows.at(-1).motion.x, 754);
    const samples = f.source.snapshot().total; f.tick(2.2); assert.equal(f.source.snapshot().total, samples);
    near(f.read().gripWorld, armed.gripWorld); assert.equal(f.h.diagnostics.viewInvalidations, 0);
    f.emit('pointermove', 2.3, { clientX: armed.gripClient.x, clientY: armed.gripClient.y, screenX: 730, screenY: 370 });
    f.tick(2.3); const restored = f.read(); near(restored.gripWorld, armed.gripWorld);
    near({ x: 100 + restored.gripClient.x, y: 200 + restored.gripClient.y }, globalBefore);
    const copy = f.read(); copy.stamp[0] = 999; copy.localGrip.x = 999;
    near(f.read().localGrip, armed.localGrip); assert.notEqual(f.read().stamp[0], 999);
  } finally { f.h.dispose(); }
});

test('actual D2 fixture samples the same screen travel once and leaves approved inertia identical to ordinary drag', async () => {
  const a = await setup(), b = await setup();
  try {
    a.lift(); b.lift(); assert.equal(a.arm().ok, true);
    for (const [t, x, y] of [[1.7, 754, 386], [1.78, 760, 380], [1.9, 730, 370]]) {
      a.emit('pointermove', t, { ...a.point(-.8, .5), screenX: x, screenY: y });
      b.emit('pointermove', t, { ...b.point(.4, 2.4), screenX: x, screenY: y });
      const left = a.tick(t), right = b.tick(t);
      assert.deepEqual(left.drag, right.drag); assert.deepEqual(left.body.jointQuaternions, right.body.jointQuaternions);
      assert.equal(left.face.path, right.face.path);
    }
    assert.equal(a.source.snapshot().total, b.source.snapshot().total);
  } finally { a.h.dispose(); b.h.dispose(); }
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  test(`actual D2 fixture ${type} releases capture immediately, then original queue creates landing and late return preserves it`, async () => {
    const f = await setup();
    try {
      f.lift(); const armed = f.arm();
      const commits = f.h.diagnostics.commits;
      f.emit(type, 1.7, { clientX: NaN, clientY: NaN, screenX: NaN, screenY: NaN });
      assert.equal(f.target.captured.size, 0); assert.equal(f.read().captured, false);
      assert.equal(f.read().terminal, true); assert.equal(f.read().terminalPending, true); assert.equal(f.h.pendingCount, 1);
      assert.equal(f.h.diagnostics.commits, commits, 'terminal does not invent a frame or clock');
      const landed = f.tick(1.7); assert.equal(landed.mode, 'landing'); assert.equal(landed.pointerId, null);
      assert.equal(f.read().terminalPending, false); const snapshot = structuredClone(landed);
      f.emit('pointerdown', 1.71); assert.equal(f.h.pendingCount, 0);
      assert.equal(f.h.cancelFixtureGrip('wrong'), false);
      assert.equal(f.h.cancelFixtureGrip(probeId), true); assert.deepEqual(f.h.state, snapshot);
      // A late known host translation/return does not alter the local view or invoke reset.
      const returned = f.finish(1800); assert.equal(returned.ok, true); assert.equal(returned.fenced, false);
      assert.deepEqual(f.h.state, snapshot); assert.equal(returned.contactGeneration, armed.contactGeneration);
      assert.equal(f.read().finished, true); returned.gripClient.x = 999; assert.notEqual(f.read().gripClient.x, 999);
      assert.equal(f.tick(4).mode, 'idle'); assert.equal(f.target.captured.size, 0);
      assert.equal(f.h.pool.stats.active, 1);
    } finally { f.h.dispose(); }
  });
}

test('actual D2 fixture stale/new down never reaches queue, motion source or contact generation; disarm uses event time', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm(); const samples = f.source.snapshot().total;
    for (const pointerId of [1, 2, 9]) f.emit('pointerdown', 1.7, { pointerId });
    assert.equal(f.h.pendingCount, 0); assert.equal(f.source.snapshot().total, samples);
    assert.equal(f.h.state.contactGeneration, 1);
    f.emit('pointerup', 1.8); f.tick(1.8); f.tick(4);
    f.emit('pointerdown', 4.1); assert.equal(f.h.pendingCount, 0);
    assert.equal(f.finish(4200).ok, true);
    for (const domTime of [4199, 4200, NaN]) f.emit('pointerdown', 4.3, { domTime });
    assert.equal(f.h.pendingCount, 0); assert.equal(f.h.state.pointerId, null);
    f.emit('pointerdown', 4.4, { ...f.point(.4, 1.4), domTime: 4201 }); f.tick(4.4);
    assert.equal(f.h.state.contactGeneration, 2, 'rejected downs never consume a generation');
    const newContact = structuredClone(f.h.state);
    assert.equal(f.h.cancelFixtureGrip(probeId), false); assert.deepEqual(f.h.state, newContact);
    assert.equal(f.h.diagnostics.fixtureDownRejections, 7);
  } finally { f.h.dispose(); }
});

test('actual D2 fixture sealed terminal retains original lifecycle fallback, fence and exact time without epsilon', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm(); const time = f.h.state.time;
    f.emit('pointerup', time, { screenX: NaN });
    assert.equal(f.h.state.mode, 'idle'); assert.equal(f.h.state.pointerId, null);
    assert.equal(f.h.state.time, time); assert.equal(f.target.captured.size, 0);
    assert.equal(f.h.diagnostics.lifecycleInvalidations, 1); assert.equal(f.read().fenced, true);
    f.emit('pointerdown', time + .1); assert.equal(f.h.pendingCount, 0);
  } finally { f.h.dispose(); }
});

test('actual D2 fixture no-buttons and missing-motion cancellation do not need a fresh motion sample to release', async () => {
  for (const props of [{ buttons: 0, clientX: NaN, screenX: NaN }, { screenX: NaN }]) {
    const f = await setup();
    try {
      f.lift(); f.arm(); f.emit('pointermove', 1.7, props);
      assert.equal(f.target.captured.size, 0); assert.equal(f.read().terminal, true);
      assert.equal(f.tick(1.7).mode, 'landing'); assert.equal(f.h.state.pointerId, null);
    } finally { f.h.dispose(); }
  }
});

test('actual D2 fixture cannot bypass CSS/camera barriers, unsafe disarm, blur, hidden, or dispose', async () => {
  for (const mutate of [f => { f.target.rect.left += 1; }, f => { f.target.rect.width += 1; },
    f => { f.camera.position.x += .1; }, f => { f.camera.zoom = 1.1; f.camera.updateProjectionMatrix(); }]) {
    const f = await setup();
    try {
      f.lift(); f.arm(); mutate(f);
      assert.equal(f.finish(1700).ok, false);
      assert.equal(f.tick(1.7).pointerId, null); assert.equal(f.target.captured.size, 0);
      assert.equal(f.h.diagnostics.viewInvalidations, 1);
      assert.equal(f.read().fenced, true); f.emit('pointerdown', 1.8); assert.equal(f.h.pendingCount, 0);
    } finally { f.h.dispose(); }
  }
  for (const cancel of [f => f.win.emit('blur'), f => { f.doc.hidden = true; f.doc.emit('visibilitychange'); }]) {
    const f = await setup();
    try {
      f.lift(); f.arm(); cancel(f); assert.equal(f.target.captured.size, 0); assert.equal(f.read().terminal, true);
      f.doc.hidden = false; f.doc.emit('visibilitychange'); f.win.emit('focus');
      f.emit('pointerdown', 1.8); assert.equal(f.h.pendingCount, 0, 'focus cannot reopen fixture fence');
      f.h.dispose(); assert.equal(f.read().reason, 'disposed'); assert.equal(f.pending.size, 0);
    } finally { f.h.dispose(); }
  }
});

test('actual D2 fixture only arms a captured current drag with an empty queue and restores normal target updates after finish', async () => {
  const f = await setup();
  try {
    assert.equal(f.arm().ok, false); f.lift();
    f.emit('pointermove', 1.7, { ...f.point(.4, 2.4), screenX: 740 }); assert.equal(f.arm().ok, false); f.tick(1.7);
    const armed = f.arm(); assert.equal(armed.ok, true); assert.equal(f.arm().ok, false);
    f.emit('pointermove', 1.8, { ...f.point(-1, 1), screenX: 750 }); f.tick(1.8);
    near(f.read().gripWorld, armed.gripWorld); assert.equal(f.finish(NaN).ok, false);
    assert.equal(f.finish(1850).ok, true);
    f.emit('pointermove', 1.9, { ...f.point(1.4, 2.6), screenX: 780 });
    const state = f.tick(1.9); assert(state.body.root[0] > 1.2);
    f.emit('pointerup', 2, { ...f.point(1.4, 2.6), screenX: 780 });
    assert.equal(f.target.captured.size, 1, 'ordinary terminals outside fixture keep original frame ordering');
    assert.equal(f.tick(2).mode, 'landing'); assert.equal(f.target.captured.size, 0);
  } finally { f.h.dispose(); }
});

test('actual D2 fixture cancellation targets only its original contact and cannot unlock input by itself', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm(); const before = structuredClone(f.h.state);
    assert.equal(f.h.cancelFixtureGrip('other-probe'), false); assert.deepEqual(f.h.state, before);
    f.emit('pointercancel', 1.7, { pointerId: 2, clientX: NaN, screenX: NaN }); f.tick(1.7);
    assert.equal(f.read().terminal, false); assert.equal(f.target.captured.size, 1);
    assert.equal(f.h.cancelFixtureGrip(probeId), true); assert.equal(f.target.captured.size, 0);
    assert.equal(f.read().cancelled, true); assert.equal(f.read().terminal, true);
    f.emit('pointerdown', 1.8); assert.equal(f.h.pendingCount, 0); assert.equal(f.read().contactGeneration, 1);
    assert.equal(f.finish(1900).ok, true);
    f.emit('pointerdown', 2, { ...f.point(.4, 1.4) }); f.tick(2); assert.equal(f.h.state.contactGeneration, 2);
    const current = structuredClone(f.h.state); assert.equal(f.h.cancelFixtureGrip(probeId), false);
    assert.deepEqual(f.h.state, current);
  } finally { f.h.dispose(); }
});

test('actual D2 fixture full queue terminal fails closed through original lifecycle rather than retaining capture', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm();
    for (let i = 0; i < 1024; i++) f.emit('pointermove', 1.7, { screenX: 730 + i % 10 });
    assert.equal(f.h.pendingCount, 1024);
    f.emit('pointerup', 1.7, { clientX: NaN, screenX: NaN });
    assert.equal(f.h.pendingCount, 0); assert.equal(f.target.captured.size, 0);
    assert.equal(f.h.state.mode, 'idle'); assert.equal(f.h.state.time, 1.7);
    assert.equal(f.read().fenced, true); assert.equal(f.read().terminal, true);
    assert.equal(f.source.snapshot().rows.length, 32);
  } finally { f.h.dispose(); }
});


test('actual D2 fixture final finite up remains in the same-time motion batch without changing the locked grip', async () => {
  const f = await setup();
  try {
    f.lift(); const armed = f.arm(), commits = f.h.diagnostics.commits;
    f.emit('pointermove', 1.7, { ...f.point(-1, 1), screenX: 754, screenY: 386 });
    f.emit('pointerleave', 1.7);
    f.emit('pointerup', 1.7, { ...f.point(2, 3), screenX: 760, screenY: 390 });
    assert.equal(f.h.pendingCount, 3); assert.equal(f.target.captured.size, 0);
    const released = f.tick(1.7); assert.equal(released.mode, 'landing');
    assert.equal(f.h.diagnostics.commits, commits + 1); assert.equal(f.h.pendingCount, 0);
    near(f.read().gripWorld, armed.gripWorld);
    const rows = f.source.snapshot().rows.slice(-2);
    assert.deepEqual(rows.map(row => [row.type, row.motion.x, row.motion.y]),
      [['pointermove', 754, 386], ['pointerup', 760, 390]]);
    assert.equal(f.tick(2.9).drag.faceIntent, 'landingP2', 'pre-terminal captured leave must not change up into cancel');
    assert.equal(f.tick(4).mode, 'idle');
  } finally { f.h.dispose(); }
});

test('actual D2 fixture reports actual original DOM capture after a failed release rather than masking it with terminal state', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm(); f.target.releasePointerCapture = () => { throw Error('fixture release fault'); };
    f.emit('pointercancel', 1.7); f.tick(1.7);
    const read = f.read(); assert.equal(read.terminal, true); assert.equal(read.captured, false);
    assert.equal(read.domCaptured, true); assert.equal(f.h.diagnostics.releaseFailures, 1);
  } finally { f.target.captured.clear(); f.h.dispose(); }
});

test('actual D2 generation high-water reveals a complete new contact between polls after fixture disarm', async () => {
  const f = await setup();
  try {
    assert.equal(f.h.contactGenerationHighWater, 0);
    f.lift(); const armed = f.arm();
    f.emit('pointerdown', 1.7, { pointerId: 2 }); assert.equal(f.h.contactGenerationHighWater, armed.contactGeneration);
    f.emit('pointerup', 1.8); f.tick(1.8); f.tick(4); assert.equal(f.finish(4100).ok, true);
    assert.equal(f.h.state.contactGeneration, null); assert.equal(f.h.contactGenerationHighWater, armed.contactGeneration);
    f.emit('pointerdown', 4.2, { ...f.point(.4, 1.4), pointerId: 2 });
    f.emit('pointerup', 4.2, { ...f.point(.4, 1.4), pointerId: 2 });
    assert.equal(f.h.contactGenerationHighWater, armed.contactGeneration, 'queueing alone is not an admitted generation');
    f.tick(4.2);
    assert.equal(f.h.state.contactGeneration, null); assert.equal(f.h.state.pointerId, null);
    assert.equal(f.h.contactGenerationHighWater, armed.contactGeneration + 1,
      'a completed same-frame newer gesture cannot be mistaken for the old transaction');
    const state = structuredClone(f.h.state); for (let i = 0; i < 5; i++) assert.equal(f.h.contactGenerationHighWater, 2);
    assert.deepEqual(f.h.state, state);
  } finally { f.h.dispose(); }
});

for (const [name, abort] of [
  ['sealed up', f => f.emit('pointerup', 1.6)],
  ['blur', f => f.win.emit('blur')],
  ['reset', f => { f.h.suspend(); f.h.resume(); }],
  ['cancel', f => { f.emit('pointercancel', 1.7); f.tick(1.7); }],
  ['lost capture', f => { f.emit('lostpointercapture', 1.7); f.tick(1.7); }],
  ['no buttons', f => { f.emit('pointermove', 1.7, { buttons: 0 }); f.tick(1.7); }],
]) {
  test(`actual D2 fixture completion memo cannot survive ${name} truncating its original release`, async () => {
    const f = await setup();
    try {
      f.lift(); f.arm(); assert.equal(f.finish(1650).ok, true); assert.equal(f.read().finished, true);
      abort(f); assert.equal(f.read().ok, false); assert.equal(f.read().reason, 'not-armed');
    } finally { f.h.dispose(); }
  });
}

test('actual D2 fixture normal up and complete original gentle tail retain only the detached release observation', async () => {
  const f = await setup();
  try {
    f.lift(); f.arm(); assert.equal(f.finish(1650).ok, true); assert.equal(f.read().releaseObserved, false);
    f.emit('pointerup', 1.7, { ...f.point(.4, 2.4), screenX: 730, screenY: 370 });
    assert.equal(f.read().releaseObserved, false, 'receipt is not the original terminal commit');
    f.tick(1.7); assert.equal(f.read().releaseObserved, true);
    let done = false;
    for (let frame = 171; frame <= 600; frame++) {
      f.tick(frame / 100);
      if (!f.h.interactionTailActive) { done = true; break; }
    }
    assert.equal(done, true); const completed = f.read();
    assert.equal(completed.ok, true); assert.equal(completed.finished, true);
    assert.equal(completed.releaseObserved, true); assert.equal(completed.contactGeneration, 1);
    assert.equal(f.h.state.face.candidate, 'restR0'); assert.equal(f.h.state.face.phase, 'hold');
    assert.equal(f.h.contactGenerationHighWater, 1);
    f.h.suspend(); f.h.resume(); assert.equal(f.read().ok, false, 'a later lifecycle reset invalidates the memo too');
  } finally { f.h.dispose(); }
});
