'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const preferences = require('../src/capabilities/preferences');
const { createUpdatePreferencesWorkflow } = require('../src/application/workflows/update-preferences');

function createRepository(initialState) {
  let state = structuredClone(initialState);
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
    read: () => structuredClone(state),
    commits: () => commits
  };
}

test('preference patches commit once before their platform effects', () => {
  const repository = createRepository({
    settings: preferences.normalizeSettings({ dnd: false, petEnabled: true })
  });
  const events = [];
  const command = createUpdatePreferencesWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 1_000 },
    publish: fact => events.push(['publish', fact.settings.dnd, fact.changedKeys])
  });

  const result = command.execute({ patch: { dnd: true, petEnabled: false } });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(repository.commits(), 1);
  assert.equal(repository.read().settings.dnd, true);
  assert.equal(repository.read().settings.petEnabled, false);
  assert.deepEqual(events, [['publish', true, ['dnd', 'petEnabled']]]);
});

test('invalid, empty, stale and no-op preference changes write nothing', () => {
  const settings = preferences.normalizeSettings({ dnd: false });
  const repository = createRepository({ settings });
  let publishes = 0;
  const command = createUpdatePreferencesWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 2_000 },
    publish: () => { publishes += 1; }
  });

  assert.deepEqual(command.execute({ patch: {} }), {
    ok: false,
    reason: 'settings-patch-invalid'
  });
  assert.deepEqual(command.execute({ patch: { hydrationEvery: 0 } }), {
    ok: false,
    reason: 'settings-field-invalid'
  });
  assert.equal(command.execute({ patch: { dnd: false } }).changed, false);
  assert.equal(command.execute({ patch: { dnd: true }, expectedRevision: 4 }).reason, 'state-revision-conflict');
  assert.equal(repository.commits(), 0);
  assert.equal(publishes, 0);
});

test('post-commit preference effect failures cannot make the durable command retryable', () => {
  const repository = createRepository({
    settings: preferences.normalizeSettings({ stimulationMode: 'balanced' })
  });
  const failures = [];
  const command = createUpdatePreferencesWorkflow({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => 3_000 },
    publish: () => { throw new Error('surface closed'); },
    reportEffectError: error => failures.push(error.message)
  });

  const result = command.execute({ patch: { stimulationMode: 'low' } });
  assert.equal(result.ok, true);
  assert.equal(repository.read().settings.stimulationMode, 'low');
  assert.deepEqual(failures, ['surface closed']);
});
