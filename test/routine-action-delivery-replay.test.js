'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const processPorts = require('node:child_process');
let uninjectedProcessCalls = 0;
for (const port of ['exec', 'execFile', 'spawn']) {
  test.mock.method(processPorts, port, () => {
    uninjectedProcessCalls += 1;
    throw new Error(`Uninjected reminder process port: ${port}`);
  });
}
test.after(() => assert.equal(uninjectedProcessCalls, 0, 'all reminder process calls must be injected'));
const { createRoutineReplayFixture } = require('../test-support/routine-replay-fixture');

test('actual native show commits notified, then the registered first native button commits done and reconciles', async t => {
  const f = createRoutineReplayFixture(t);
  const sample = f.sampler.sample();
  await f.drain();
  const native = f.notifications[0];
  assert.equal(native.requested, true);
  assert.deepEqual(f.entries(), []);
  assert.deepEqual(native.options.actions.map(action => action.text), ['已完成', '稍后（+15 分钟）']);
  native.emit('show');
  assert.equal((await sample).reminded, 1);
  assert.equal(f.entries()[0].status, 'notified');
  const before = f.repository.snapshot(), revision = f.repository.revision();
  native.emit('action', {}, 0);
  assert.equal(f.entries()[0].status, 'done');
  assert.equal(native.closed, true, 'successful publication synchronously reconciles the live host');
  assert.deepEqual(f.writes.at(-1), ['routineLog']);
  assert.deepEqual({ ...f.repository.snapshot(), routineLog: before.routineLog }, before);
  const logged = f.publications.at(-1).rows.filter(row => row.kind === 'routine.logged');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].entityVersion, String(revision + 1));
  assert.equal(logged[0].payload.occurrenceId, f.identity.occurrenceId);
  assert.equal(JSON.stringify(logged).includes('Synthetic original title'), false);
  native.emit('action', {}, 0);
  assert.equal(f.host.dismissCurrentNudge('complete-routine').handled, false);
  assert.equal(f.repository.revision(), revision + 1);
  assert.deepEqual(f.errors, []);
});

test('an answer in the native show callback cannot be overwritten by the pending sampler', async t => {
  const f = createRoutineReplayFixture(t);
  const sample = f.sampler.sample();
  await f.drain();
  const native = f.notifications[0];
  native.emit('show');
  native.emit('action', {}, 0);
  assert.equal((await sample).reminded, 0);
  assert.equal(f.entries()[0].status, 'done');
  assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.reminded').length, 0);
  assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.logged').length, 1);
});

test('the ready visible corner exposes skip as a third action and rejects unknown or stale senders', async t => {
  const f = createRoutineReplayFixture(t, { maxLevel: 2, times: ['08:00', '08:30'] });
  await f.deliver();
  await f.advanceTo(f.now() + 60000);
  const corner = f.windows[0];
  assert.ok(corner);
  assert.equal(corner.visible, false);
  corner.webContents.emit('did-finish-load');
  await f.drain();
  assert.equal(corner.visible, true);
  assert.deepEqual(corner.messages.find(row => row.channel === 'nudge:init').payload.actions.map(action => action.id),
    ['complete-routine', 'defer-15', 'skip-routine-today']);
  const revision = f.repository.revision();
  assert.equal(f.host.dismissCurrentNudge('skip-routine-today', {}).reason, 'stale-or-unauthorized-sender');
  assert.equal(f.host.dismissCurrentNudge('not-offered', corner.webContents).reason, 'action-not-offered');
  assert.equal(f.repository.revision(), revision);
  assert.equal(f.host.dismissCurrentNudge('skip-routine-today', corner.webContents).handled, true);
  assert.equal(f.entries().length, 1, 'today skip answers only this occurrence');
  assert.equal(f.entries()[0].status, 'skipped');
  assert.equal(f.entries()[0].occurrenceId, f.identity.occurrenceId);
  assert.equal(corner.destroyed, true);
  assert.equal(f.host.dismissCurrentNudge('complete-routine', corner.webContents).handled, false);
  assert.equal(f.repository.revision(), revision + 1);
  assert.deepEqual(f.errors, []);
});

for (const failure of ['command-refused', 'pre-COMMIT']) {
  test(`the real delivery/action chain keeps ${failure} retryable until successful commit`, async t => {
    const f = createRoutineReplayFixture(t);
    await f.deliver();
    const before = f.repository.snapshot(), revision = f.repository.revision();
    const native = f.notifications[0];
    if (failure === 'command-refused') f.rejectCommand(true);
    else f.failCommit();
    const result = f.host.dismissCurrentNudge('complete-routine');
    assert.equal(result.handled, false);
    assert.equal(result.reason, failure === 'command-refused' ? 'synthetic-refusal' : 'action-failed');
    assert.equal(native.closed, false);
    assert.deepEqual(f.repository.snapshot(), before);
    assert.equal(f.repository.revision(), revision);
    assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.logged').length, 0);
    f.rejectCommand(false);
    assert.equal(f.host.dismissCurrentNudge('complete-routine').handled, true);
    assert.equal(native.closed, true);
    assert.equal(f.entries()[0].status, 'done');
    assert.equal(f.repository.revision(), revision + 1);
    assert.deepEqual(f.errors, []);
  });
}

for (const failure of ['command-refused', 'pre-COMMIT']) {
  test(`native ${failure} followed by OS close reopens only the presentation and waits for an explicit retry`, async t => {
    const f = createRoutineReplayFixture(t);
    await f.deliver();
    const first = f.notifications[0], revision = f.repository.revision(), writes = f.writes.length;
    if (failure === 'command-refused') f.rejectCommand(true);
    else f.failCommit();
    first.emit('action', {}, 0);
    const failedWrites = failure === 'pre-COMMIT' ? 1 : 0;
    assert.equal(f.writes.length, writes + failedWrites);
    assert.equal(f.entries()[0].status, 'notified');
    first.close();
    await f.drain();
    assert.equal(f.notifications.length, 2, 'the failed native action must retain a visible retry path after OS close');
    const retry = f.notifications[1];
    assert.equal(retry.options.body, first.options.body);
    assert.equal(f.repository.revision(), revision);
    assert.equal(f.writes.length, writes + failedWrites, 're-presenting is not a business command retry');
    retry.emit('show');
    await f.drain();
    assert.equal(f.repository.revision(), revision, 're-presentation does not write notified again');
    assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.reminded').length, 1);
    assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.logged').length, 0);
    f.rejectCommand(false);
    retry.emit('action', {}, 0);
    assert.equal(f.entries()[0].status, 'done');
    assert.equal(f.repository.revision(), revision + 1);
    assert.equal(f.writes.length, writes + failedWrites + 1);
    assert.equal(retry.closed, true);
    assert.deepEqual(f.errors, []);
  });
}

for (const outcome of ['failed', 'close', 'timeout']) {
  test(`a retry presentation that ${outcome} does not create a notification or command retry loop`, async t => {
    const f = createRoutineReplayFixture(t);
    await f.deliver();
    const revision = f.repository.revision(), writes = f.writes.length;
    f.rejectCommand(true);
    f.notifications[0].emit('action', {}, 0);
    f.notifications[0].close();
    await f.drain();
    assert.equal(f.notifications.length, 2);
    const retry = f.notifications[1];
    if (outcome === 'timeout') await f.advanceTo(f.now() + 3000);
    else if (outcome === 'close') retry.close();
    else retry.emit('failed', {}, 'synthetic delivery failure');
    await f.drain();
    retry.emit('show');
    await f.advanceTo(f.now() + 30000);
    assert.equal(f.notifications.length, 2);
    assert.equal(f.writes.length, writes);
    assert.equal(f.repository.revision(), revision);
    assert.equal(f.entries()[0].status, 'notified');
    assert.equal(f.host.dismissCurrentNudge('complete-routine').handled, false);
  });
}

test('an abandoned L2 receipt cannot close the new native retry presentation or consume its action', async t => {
  const f = createRoutineReplayFixture(t, { maxLevel: 2 });
  await f.deliver();
  const first = f.notifications[0], revision = f.repository.revision(), writes = f.writes.length;
  await f.advanceTo(f.now() + 60000);
  assert.equal(f.windows.length, 1);
  const pendingCorner = f.windows[0];
  assert.equal(pendingCorner.visible, false, 'L2 is still waiting for its renderer ready event');
  f.rejectCommand(true);
  first.emit('action', {}, 0);
  first.close();
  await f.drain();
  assert.equal(f.notifications.length, 2);
  const retry = f.notifications[1];
  retry.emit('show');
  await f.drain();
  assert.equal(pendingCorner.destroyed, true);
  await f.advanceTo(f.now() + 3000);
  assert.equal(retry.closed, false, 'the old L2 timeout no longer owns the live native receipt');
  assert.equal(f.repository.revision(), revision);
  assert.equal(f.writes.length, writes, 'neither presentation replacement nor the abandoned timeout may retry the command');
  f.rejectCommand(false);
  retry.emit('action', {}, 0);
  assert.equal(f.entries()[0].status, 'done');
  assert.equal(f.repository.revision(), revision + 1);
  assert.equal(f.writes.length, writes + 1);
  assert.equal(retry.closed, true);
  assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.reminded').length, 1);
  assert.equal(f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.logged').length, 1);
  assert.deepEqual(f.errors, []);
});

test('postcommit publication failure cannot turn a committed, synchronously reconciled action into a retry', async t => {
  const f = createRoutineReplayFixture(t);
  await f.deliver();
  const revision = f.repository.revision();
  f.failPublish();
  assert.equal(f.host.dismissCurrentNudge('complete-routine').handled, true);
  assert.equal(f.entries()[0].status, 'done');
  assert.equal(f.notifications[0].closed, true);
  assert.equal(f.host.dismissCurrentNudge('complete-routine').handled, false);
  assert.equal(f.repository.revision(), revision + 1);
  assert.deepEqual(f.errors, ['synthetic postcommit publication failure']);
});

test('the second native button defers a notified occurrence and replays the latest canonical title before answering', async t => {
  const f = createRoutineReplayFixture(t);
  await f.deliver();
  const first = f.notifications[0];
  first.emit('action', {}, 1);
  assert.equal(first.closed, true);
  assert.equal(f.entries()[0].status, 'notified');
  f.update(state => { state.routines[0].title = 'Synthetic latest title'; state.routines[0].updatedAt = f.now(); });
  assert.ok(f.sampler.resolveRequest(f.identity), 'notified remains eligible for an explicit deferral');
  await f.advanceTo(f.now() + 15 * 60000);
  assert.equal(f.notifications.length, 2);
  const replay = f.notifications[1];
  assert.equal(replay.options.body, 'Synthetic latest title');
  assert.equal(f.entries()[0].status, 'notified');
  replay.emit('show');
  await f.drain();
  replay.emit('action', {}, 0);
  assert.equal(f.entries()[0].status, 'done');
  assert.equal(f.entries()[0].at, f.now());
  assert.equal(replay.closed, true);
  const rows = f.timeline.readDay('2026-10-07');
  assert.equal(rows.filter(row => row.kind === 'routine.reminded').length, 1);
  assert.equal(rows.filter(row => row.kind === 'routine.logged').length, 1);
  assert.equal((await f.sampler.sample()).reminded, 0);
  assert.deepEqual(f.errors, []);
});

for (const offset of [0, 1]) {
  test(`a cross-midnight deferral ${offset ? 'expires one millisecond after' : 'answers at'} the inclusive end`, async t => {
    const f = createRoutineReplayFixture(t, { at: new Date(2026, 9, 6, 23, 50).getTime(), times: ['23:45'] });
    await f.deliver();
    f.notifications[0].emit('action', {}, 1);
    await f.advanceTo(new Date(2026, 9, 7, 0, 5).getTime());
    assert.equal(f.notifications.length, 2);
    f.notifications[1].emit('show');
    await f.drain();
    const answeredAt = new Date(2026, 9, 7, 0, 45).getTime() + offset;
    f.setNow(answeredAt);
    const result = f.host.dismissCurrentNudge('complete-routine');
    assert.equal(result.handled, offset === 0);
    const day = f.repository.get('routineLog').days.find(row => row.dayKey === '2026-10-06');
    assert.equal(day.entries[0].occurrenceId, 'routine:2026-10-06:23:45');
    assert.equal(day.entries[0].status, offset ? 'notified' : 'done');
    const logged = f.timeline.readDay('2026-10-07').filter(row => row.kind === 'routine.logged');
    if (offset === 0) {
      assert.equal(day.entries[0].at, answeredAt);
      assert.equal(logged.length, 1);
      assert.equal(logged[0].occurredAt, answeredAt);
      assert.equal(logged[0].payload.occurrenceId, f.identity.occurrenceId);
    } else {
      assert.deepEqual(logged, []);
      assert.equal(result.reason, 'routine-stale');
    }
    assert.equal(f.timeline.readDay('2026-10-06').filter(row => row.kind === 'routine.logged').length, 0);
    assert.equal(f.notifications[1].closed, true);
    assert.deepEqual(f.errors, []);
  });
}
