'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { createUnitOfWork } = require('../src/application/state/unit-of-work');
const { createUpdatePreferencesWorkflow, UPDATE_PREFERENCES_WRITES } = require('../src/application/workflows/update-preferences');
const { assertIpcPayload, validateIpcPayload } = require('../src/application/ipc/route-catalog');
const NOW = Date.parse('2026-10-07T09:00:00Z');
function fixture(t, { enabled = true, version = 4, pending = 'plan' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-meals18-')), handles = [];
  const open = () => { const value = createSqliteStateAdapter({ userDataPath: directory, now: () => NOW }); handles.push(value); return value; };
  t.after(() => { handles.forEach(value => value.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const repository = open(), effects = [];
  repository.update(state => {
    state.settings.aiBreakdownEnabled = true; state.settings.aiPetMealsEnabled = enabled;
    state.pet.care = { ...state.pet.care, version, aiDay: '2026-10-07', aiCalls: 3,
      nextMealAt: NOW + 300_000,
      plan: pending === 'plan' ? { foodId: 'berry', reactionIndex: 1, expiresAt: NOW + 600_000, slot: 'breakfast' } : null,
      decision: pending === 'decision' ? { id: '4:7', expiresAt: NOW + 5000, slot: 'breakfast' } : null };
  });
  let fail = false;
  const ports = { snapshot: repository.snapshot, revision: repository.revision,
    commit(candidate, context) { if (fail) throw new Error('preferences-write-failed'); return repository.commit(candidate, context); } };
  const command = createUpdatePreferencesWorkflow({ unitOfWork: createUnitOfWork({ repository: ports }),
    clock: { now: () => NOW }, publish: fact => {
      assert.equal(repository.revision(), fact.revision, 'publish happens only after durable commit'); effects.push(fact);
    } });
  return { command, repository, effects, fail: () => { fail = true; }, reopen: () => open().snapshot() };
}
function assertCleanWithoutBenefits(before, after, version) {
  const expected = structuredClone(before.pet.care);
  expected.plan = null; expected.decision = null; expected.nextMealAt = null; expected.version = version;
  assert.deepEqual(after.pet, { ...before.pet, care: expected });
  for (const field of ['companion', 'rewardLedger', 'xp', 'level', 'unlockedSkins', 'stats']) assert.deepEqual(after[field], before[field]);
}
for (const flag of ['aiBreakdownEnabled', 'aiPetMealsEnabled']) {
  for (const pending of ['plan', 'decision']) test(`${flag} opt-out atomically clears ${pending} without refund or reward`, t => {
    const f = fixture(t, { pending }), before = f.repository.snapshot(), revision = f.repository.revision();
    const result = f.command.execute({ patch: { [flag]: false } });
    assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(result.careChanged, true);
    assert.equal(f.repository.revision(), revision + 1); const after = f.reopen();
    assert.equal(after.settings[flag], false); assertCleanWithoutBenefits(before, after, 5);
    assert.equal(f.effects.length, 1); assert.equal(f.effects[0].careChanged, true);
    assert.deepEqual(f.effects[0].changedKeys, [flag]);
    assert.equal(f.command.execute({ patch: { [flag]: true } }).ok, true);
    assert.equal(f.reopen().pet.care.plan, null); assert.equal(f.reopen().pet.care.decision, null);
  });
}
for (const patch of [{ aiPetMealsEnabled: false }, { dnd: true }]) test(`disabled valid patch ${Object.keys(patch)[0]} cleans stale care and publishes once`, t => {
  const f = fixture(t, { enabled: false }), before = f.repository.snapshot(), revision = f.repository.revision();
  const result = f.command.execute({ patch });
  assert.equal(result.changed, true); assert.equal(result.careChanged, true); assert.equal(f.repository.revision(), revision + 1);
  assertCleanWithoutBenefits(before, f.reopen(), 5); assert.equal(f.effects.length, 1);
  assert.deepEqual(f.effects[0].changedKeys, Object.hasOwn(patch, 'dnd') ? ['dnd'] : []);
  assert.equal(f.command.execute({ patch }).changed, false); assert.equal(f.effects.length, 1);
});

test('version saturation does not block consent revocation and stale care cleanup', t => {
  const f = fixture(t, { version: Number.MAX_SAFE_INTEGER }), before = f.repository.snapshot();
  assert.equal(f.command.execute({ patch: { aiPetMealsEnabled: false } }).ok, true);
  assertCleanWithoutBenefits(before, f.reopen(), Number.MAX_SAFE_INTEGER);
});

test('enabled unrelated patch preserves the exact accepted meal identity', t => {
  const f = fixture(t), before = f.repository.snapshot();
  assert.equal(f.command.execute({ patch: { dnd: true } }).careChanged, false);
  assert.deepEqual(f.reopen().pet, before.pet); assert.equal(f.effects[0].careChanged, false);
});

test('invalid, stale or failed update rolls back settings and care together', t => {
  const f = fixture(t), before = f.repository.snapshot(), revision = f.repository.revision();
  assert.equal(f.command.execute({ patch: { aiPetMealsEnabled: false, unknown: true } }).ok, false);
  assert.equal(f.command.execute({ patch: { aiPetMealsEnabled: false }, expectedRevision: revision + 1 }).reason, 'state-revision-conflict');
  f.fail(); assert.throws(() => f.command.execute({ patch: { aiPetMealsEnabled: false } }), /preferences-write-failed/);
  assert.deepEqual(f.reopen(), before); assert.equal(f.repository.revision(), revision); assert.deepEqual(f.effects, []);
});

test('meal opt-in is a closed boolean setting and the workflow declares both owners', () => {
  assert.deepEqual(UPDATE_PREFERENCES_WRITES, ['settings', 'pet']);
  for (const enabled of [true, false]) assert.deepEqual(assertIpcPayload('settings:update', { aiPetMealsEnabled: enabled }), { aiPetMealsEnabled: enabled });
  for (const enabled of [null, 0, 1, 'true', []]) assert.equal(validateIpcPayload('settings:update', { aiPetMealsEnabled: enabled }).ok, false);
});
