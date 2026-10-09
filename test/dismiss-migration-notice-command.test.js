'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const appMaintenance = require('../src/capabilities/app-maintenance');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const {
  DISMISS_MIGRATION_NOTICE_WRITES,
  createDismissMigrationNoticeCommand
} = appMaintenance.dismissMigrationNotice;

const NOW = Date.parse('2026-09-09T12:00:00Z');

function notice(id, kind = 'focus-minutes-migrated') {
  return { id, kind, createdAt: NOW, payload: {} };
}

function baseState(overrides = {}) {
  return normalizePersistedState(overrides, { now: NOW });
}

function createRepository(initial, events = []) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: (candidate, context) => {
      events.push(['commit', context]);
      state = normalizePersistedState(candidate, context);
      revision += 1;
      commits += 1;
      return structuredClone(state);
    },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision, commits })
  };
}

function createCommand(repository, overrides = {}) {
  return createDismissMigrationNoticeCommand({
    unitOfWork: createUnitOfWork({ repository }),
    ...overrides
  });
}

test('acknowledging a notice removes only that notice and says so once', () => {
  const events = [];
  const repository = createRepository(baseState({
    migrationNotices: [notice('notice-1'), notice('notice-2', 'schema-8-upgraded')]
  }), events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ noticeId: 'notice-1' }), { ok: true });

  const persisted = repository.inspect();
  assert.equal(persisted.commits, 1);
  assert.deepEqual(persisted.state.migrationNotices.map(entry => entry.id), ['notice-2']);
  assert.deepEqual(events.map(event => event[0]), ['commit', 'publish']);
  assert.deepEqual(events[1][1], {
    type: 'migration-notice-dismissed',
    dismissedId: 'notice-1',
    revision: 1
  });
  assert.equal(Object.isFrozen(events[1][1]), true);
  assert.deepEqual(DISMISS_MIGRATION_NOTICE_WRITES, ['migrationNotices']);

  // A duplicated click is answered, not committed: the notice is already gone.
  assert.deepEqual(command.execute({ noticeId: 'notice-1' }), {
    ok: false,
    reason: 'notice-not-found'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(events.length, 2);
});

test('an unrecognisable id gets the shipped reason instead of a crash', () => {
  const repository = createRepository(baseState({ migrationNotices: [notice('notice-1')] }));
  const command = createCommand(repository);

  for (const bad of [undefined, null, '', 'nope', 42, { id: 'notice-1' }, 'x'.repeat(121)]) {
    assert.deepEqual(command.execute({ noticeId: bad }), {
      ok: false,
      reason: 'notice-not-found'
    });
  }
  assert.deepEqual(command.execute(), { ok: false, reason: 'notice-not-found' });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state.migrationNotices.map(entry => entry.id), ['notice-1']);
});

test('a stale dismissal never enters the transition', () => {
  const initial = baseState({ migrationNotices: [notice('notice-1')] });
  const events = [];
  const repository = createRepository(initial, events);
  const command = createCommand(repository, {
    publish: fact => events.push(['publish', fact])
  });

  assert.deepEqual(command.execute({ noticeId: 'notice-1', expectedRevision: 1 }), {
    ok: false,
    reason: 'state-revision-conflict'
  });
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(repository.inspect().state, initial);
  assert.deepEqual(events, []);
});

test('a failed strip refresh cannot resurrect the dismissed notice', () => {
  const repository = createRepository(baseState({ migrationNotices: [notice('notice-1')] }));
  const reported = [];
  const command = createCommand(repository, {
    publish: () => { throw new Error('popover window closed'); },
    reportEffectError: (error, fact) => reported.push([error.message, fact.dismissedId])
  });

  assert.deepEqual(command.execute({ noticeId: 'notice-1' }), { ok: true });
  assert.deepEqual(repository.inspect().state.migrationNotices, []);
  assert.deepEqual(reported, [['popover window closed', 'notice-1']]);
});

test('dismissal writes only migrationNotices and refuses to run without its ports', () => {
  const repository = createRepository(baseState({
    migrationNotices: [notice('notice-1')],
    lastResetDate: '2026-09-09',
    xp: 12
  }));
  const before = repository.inspect().state;
  const command = createCommand(repository);

  assert.deepEqual(command.execute({ noticeId: 'notice-1' }), { ok: true });
  const after = repository.inspect().state;
  assert.deepEqual(
    Object.keys(after).filter(key => JSON.stringify(after[key]) !== JSON.stringify(before[key])),
    ['migrationNotices']
  );
  assert.equal(after.schemaVersion, before.schemaVersion);
  assert.equal(after.lastResetDate, '2026-09-09');

  assert.throws(() => createDismissMigrationNoticeCommand(), /requires a unit of work/);
  assert.throws(
    () => createDismissMigrationNoticeCommand({ unitOfWork: { run: () => {} }, publish: 'later' }),
    /effects must be functions/
  );
});

test('the notice rule refuses a draft that cannot hold notices', () => {
  const { dismissNotice, findNotice, MAX_NOTICE_ID_LENGTH } = appMaintenance.migrationNotices;
  assert.equal(MAX_NOTICE_ID_LENGTH, 120);
  assert.throws(() => dismissNotice(null, 'notice-1'), /requires a state draft/);
  assert.throws(() => dismissNotice({}, 'notice-1'), /requires a notice collection/);
  assert.throws(() => findNotice({ migrationNotices: 'nope' }, 'notice-1'), /notice collection/);

  // The rule is pure: it mutates only the draft it is handed.
  const draft = { migrationNotices: [notice('notice-1'), notice('notice-2')] };
  assert.deepEqual(dismissNotice(draft, 'notice-2'), { ok: true, dismissedId: 'notice-2' });
  assert.deepEqual(draft.migrationNotices.map(entry => entry.id), ['notice-1']);
});
