'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const companion = require('../src/capabilities/companion');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { defaultCompanionState } = require('../src/core/companion-state');

const NOW = 1_700_000_000_000;

function createRepository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  let commits = 0;
  const contexts = [];
  return {
    snapshot: () => structuredClone(state),
    revision: () => revision,
    commit: (candidate, context) => {
      state = structuredClone(candidate);
      revision += 1;
      commits += 1;
      contexts.push(context);
      return structuredClone(state);
    },
    inspect: () => ({ state: structuredClone(state), revision, commits, contexts: [...contexts] })
  };
}

function initialState(overrides = {}) {
  return {
    level: 20,
    xp: 4200,
    streak: 6,
    currentSkin: 'pink',
    unlockedSkins: ['pink', 'crown'],
    companion: defaultCompanionState(),
    ...overrides
  };
}

function setup({ state = initialState(), now = () => NOW, publish, reportEffectError } = {}) {
  const repository = createRepository(state);
  const facts = [];
  const errors = [];
  const command = companion.equipAppearance.createEquipAppearanceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now },
    items: PET_APPEARANCE_ITEMS,
    publish: publish || (fact => facts.push(fact)),
    reportEffectError: reportEffectError || ((error, fact) => errors.push({ error, fact }))
  });
  return { command, repository, facts, errors };
}

function equippedOf(repository) {
  return repository.inspect().state.companion.appearance.equipped;
}

test('equipping commits once and announces what was worn', () => {
  const { command, repository, facts } = setup();

  assert.deepEqual(command.equip({ group: 'headwear', itemId: 'skin.crown' }), {
    ok: true, changed: true, group: 'headwear', itemId: 'skin.crown'
  });
  assert.deepEqual(equippedOf(repository), { headwear: 'skin.crown' });
  assert.equal(repository.inspect().state.companion.appearance.updatedAt, NOW);
  assert.deepEqual(facts, [{ type: 'appearance-equipped', group: 'headwear', itemId: 'skin.crown', revision: 1 }]);
  assert.ok(Object.isFrozen(facts[0]));

  // Clicking the same card again is a success with nothing behind it, so the store
  // is not rewritten and no listener is woken to redraw an unchanged pet.
  assert.deepEqual(command.equip({ group: 'headwear', itemId: 'skin.crown' }), {
    ok: true, changed: false, group: 'headwear', itemId: 'skin.crown'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(facts.length, 1);
});

test('a refusal from the domain reaches the caller with its reason and writes nothing', () => {
  const { command, repository, facts } = setup({ state: initialState({ level: 4, unlockedSkins: ['pink'] }) });

  assert.deepEqual(command.equip({ group: 'footwear', itemId: 'milestone.boots' }),
    { ok: false, reason: 'item-locked' });
  assert.deepEqual(command.equip({ group: 'headwear', itemId: 'skin.crown' }),
    { ok: false, reason: 'item-locked' });
  assert.deepEqual(command.equip({ group: 'hat', itemId: 'milestone.sprout' }),
    { ok: false, reason: 'appearance-group-unknown' });
  assert.deepEqual(command.equip({ group: 'headwear', itemId: 'milestone.cape' }),
    { ok: false, reason: 'appearance-item-not-found' });
  assert.deepEqual(command.equip({ group: 'headwear', itemId: 7 }),
    { ok: false, reason: 'appearance-item-invalid' });
  assert.deepEqual(command.equip(), { ok: false, reason: 'appearance-group-unknown' });

  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(facts, []);
});

test('resetting clears the wardrobe and says so once', () => {
  const { command, repository, facts } = setup();
  command.equip({ group: 'headwear', itemId: 'skin.crown' });
  command.equip({ group: 'neckwear', itemId: null });

  assert.deepEqual(command.reset({ now: NOW + 5_000 }), { ok: true, changed: true });
  assert.deepEqual(equippedOf(repository), {});
  assert.equal(repository.inspect().state.companion.appearance.updatedAt, NOW + 5_000);
  assert.deepEqual(facts.at(-1), { type: 'appearance-reset', revision: 3 });

  // Nothing to restore is a success, not an error, and not a commit: the 恢复默认
  // button stays clickable without rewriting the store every time.
  assert.deepEqual(command.reset(), { ok: true, changed: false });
  assert.equal(repository.inspect().commits, 3);
  assert.equal(facts.length, 3);
});

test('switching form keeps each wardrobe independent and reset only clears the selected form', () => {
  const initial = initialState({ currentSkin: 'pink', unlockedSkins: ['pink', 'crown', 'usagi'], level: 25 });
  const { command, repository } = setup({ state: initial });
  assert.equal(command.equip({ group: 'headwear', itemId: 'skin.crown' }).ok, true);
  // The persistence owner of currentSkin is a separate select-skin command; we
  // only simulate its successful commit between independent outfit commands.
  repository.commit({ ...repository.snapshot(), currentSkin: 'usagi' });
  assert.deepEqual(command.equip({ group: 'headwear', itemId: null }),
    { ok: false, reason: 'appearance-group-unknown' });
  assert.deepEqual(command.equip({ group: 'usagi.earwear', itemId: 'skin.crown' }),
    { ok: false, reason: 'appearance-item-not-found' });
  assert.equal(command.equip({ group: 'usagi.earwear', itemId: null }).ok, true);
  assert.equal(command.equip({ group: 'usagi.neckwear', itemId: 'usagi.star-collar' }).ok, true);
  assert.deepEqual(equippedOf(repository), {
    headwear: 'skin.crown', 'usagi.earwear': null, 'usagi.neckwear': 'usagi.star-collar'
  });
  assert.equal(command.reset().changed, true);
  assert.deepEqual(equippedOf(repository), { headwear: 'skin.crown' });
  repository.commit({ ...repository.snapshot(), currentSkin: 'pink' });
  assert.equal(command.reset().changed, true);
  assert.deepEqual(equippedOf(repository), {});
});

test('only the companion branch moves', () => {
  // The unit of work throws on an undeclared write, so this passing is the evidence
  // that `writes: ['companion']` is the whole truth. Asserted through the store
  // rather than through the declaration so it keeps holding if the domain grows.
  const before = initialState();
  const { command, repository } = setup({ state: before });
  command.equip({ group: 'headwear', itemId: 'skin.crown' });
  command.reset();

  const after = repository.inspect().state;
  for (const key of Object.keys(before)) {
    if (key === 'companion') continue;
    assert.deepEqual(after[key], before[key], `${key} was modified`);
  }
  const { appearance, ...rest } = after.companion;
  const { appearance: _ignored, ...restBefore } = before.companion;
  assert.deepEqual(rest, restBefore);
  assert.deepEqual(appearance, { equipped: {}, updatedAt: NOW });
});

test('a stale request is rejected without a commit, on both writes', () => {
  const { command, repository, facts } = setup();
  assert.equal(command.equip({ group: 'headwear', itemId: 'skin.crown', expectedRevision: 3 }).reason,
    'state-revision-conflict');
  assert.equal(command.reset({ expectedRevision: 3 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
  assert.deepEqual(facts, []);

  // And the matching revision goes through, so the guard is not simply always on.
  assert.equal(command.equip({ group: 'headwear', itemId: 'skin.crown', expectedRevision: 0 }).ok, true);
  assert.equal(repository.inspect().commits, 1);
});

test('the clock decides when, and a caller may override it', () => {
  let ticks = 0;
  const { command, repository } = setup({ now: () => NOW + (ticks += 1_000) });
  command.equip({ group: 'headwear', itemId: 'skin.crown' });
  assert.equal(repository.inspect().state.companion.appearance.updatedAt, NOW + 1_000);
  command.equip({ group: 'neckwear', itemId: 'milestone.scarf', now: NOW + 777 });
  assert.equal(repository.inspect().state.companion.appearance.updatedAt, NOW + 777);
  // The same timestamp travels to the commit context, so a persistence listener and
  // the stored `updatedAt` cannot disagree about when this happened.
  assert.deepEqual(repository.inspect().contexts.map(context => context.now), [NOW + 1_000, NOW + 777]);
  assert.equal(ticks, 1_000);
});

test('the effect observes state that is already committed', () => {
  const repository = createRepository(initialState());
  const seen = [];
  const command = companion.equipAppearance.createEquipAppearanceCommand({
    unitOfWork: createUnitOfWork({ repository }),
    clock: { now: () => NOW },
    items: PET_APPEARANCE_ITEMS,
    publish: fact => {
      // The pet is redrawn from the store, not from the fact, so the store has to be
      // right by the time the fact lands.
      seen.push({ fact, stored: repository.inspect().state.companion.appearance.equipped });
    }
  });
  command.equip({ group: 'headwear', itemId: 'skin.crown' });
  assert.deepEqual(seen[0].stored, { headwear: 'skin.crown' });
  assert.equal(seen[0].fact.revision, repository.inspect().revision);
});

test('a broken listener is reported, not allowed to fail the write', () => {
  const failure = new Error('window is gone');
  const { command, repository, errors } = setup({ publish: () => { throw failure; } });
  assert.deepEqual(command.equip({ group: 'headwear', itemId: 'skin.crown' }), {
    ok: true, changed: true, group: 'headwear', itemId: 'skin.crown'
  });
  assert.equal(repository.inspect().commits, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, failure);
  assert.equal(errors[0].fact.type, 'appearance-equipped');

  const onReset = setup({ publish: () => { throw failure; } });
  onReset.command.equip({ group: 'headwear', itemId: 'skin.crown' });
  assert.equal(onReset.command.reset().changed, true);
  assert.deepEqual(onReset.errors.map(entry => entry.fact.type), ['appearance-equipped', 'appearance-reset']);
});

test('a command that cannot work is refused at construction', () => {
  const base = {
    unitOfWork: createUnitOfWork({ repository: createRepository(initialState()) }),
    clock: { now: () => NOW },
    items: PET_APPEARANCE_ITEMS
  };
  const create = companion.equipAppearance.createEquipAppearanceCommand;
  assert.throws(() => create(), TypeError);
  for (const unitOfWork of [undefined, null, {}, { run: 'yes' }]) {
    assert.throws(() => create({ ...base, unitOfWork }), TypeError);
  }
  for (const clock of [undefined, null, {}, { now: 42 }]) {
    assert.throws(() => create({ ...base, clock }), TypeError);
  }
  for (const items of [undefined, null, 'catalog', {}]) {
    assert.throws(() => create({ ...base, items }), TypeError);
  }
  assert.throws(() => create({ ...base, publish: 'nope' }), TypeError);
  assert.throws(() => create({ ...base, reportEffectError: 'nope' }), TypeError);
  // Silence is a legal default: a caller with nothing to redraw need not pass one.
  assert.ok(Object.isFrozen(create(base)));
  assert.equal(create(base).equip({ group: 'headwear', itemId: 'skin.crown' }).ok, true);
});

test('the declared write path is published, so the manifest can be checked against it', () => {
  assert.deepEqual(companion.equipAppearance.EQUIP_APPEARANCE_WRITES, ['companion']);
  assert.ok(Object.isFrozen(companion.equipAppearance.EQUIP_APPEARANCE_WRITES));
});
