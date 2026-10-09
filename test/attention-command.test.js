'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const attention = require('../src/capabilities/attention');
const { createUnitOfWork } = require('../src/application');

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: candidate => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createCommand(repository, events) {
  return attention.recordWorkEndReminder.createRecordWorkEndReminderCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 10_000 },
    publish: fact => {
      assert.equal(repository.inspect().state.lastWorkEndNotifyDate, fact.dayKey);
      events.push(fact);
    }
  });
}

test('work-end reminder marker is monotonic, idempotent and publishes after commit', () => {
  const repository = createRepository({ lastWorkEndNotifyDate: '2026-09-08' });
  const events = [];
  const command = createCommand(repository, events);

  const first = command.execute({ dayKey: '2026-09-09' });
  const repeated = command.execute({ dayKey: '2026-09-09' });
  const older = command.execute({ dayKey: '2026-09-08' });

  assert.deepEqual(first, { ok: true, changed: true, dayKey: '2026-09-09' });
  assert.deepEqual(repeated, { ok: true, changed: false, dayKey: '2026-09-09' });
  assert.deepEqual(older, { ok: true, changed: false, dayKey: '2026-09-09' });
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event.type), ['work-end-reminder-recorded']);
});

test('invalid and stale work-end reminder requests perform zero writes', () => {
  const repository = createRepository({ lastWorkEndNotifyDate: null });
  const events = [];
  const command = createCommand(repository, events);

  assert.equal(command.execute({ dayKey: '2026-02-30' }).reason, 'work-end-reminder-invalid');
  assert.equal(command.execute({ dayKey: '2026-09-09', expectedRevision: 3 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(events, []);
});

test('reminder domain rejects invalid drafts without mutating them', () => {
  const state = { lastWorkEndNotifyDate: '2026-09-09' };
  const before = structuredClone(state);
  const result = attention.reminderMarker.recordWorkEndReminder(state, {
    dayKey: 'not-a-day',
    now: 10_000
  });

  assert.deepEqual(result, { ok: false, reason: 'work-end-reminder-invalid' });
  assert.deepEqual(state, before);
});
