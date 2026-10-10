'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const companion = require('../src/capabilities/companion');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { USAGI_OUTFIT_SETS } = require('../src/content/companion/usagi-wardrobe.mjs');
const { defaultCompanionState } = require('../src/core/companion-state');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { createCompanionWardrobe } = require('../src/bootstrap/companion-wardrobe');
const NOW = 1_700_000_000_000;
function setup({ level = 50, currentSkin = 'usagi', looks = USAGI_OUTFIT_SETS, failure = null } = {}) {
  let state = { level, currentSkin, unlockedSkins: ['pink'], companion: defaultCompanionState() };
  state.companion.appearance.equipped.headwear = 'skin.crown';
  let revision = 0, commits = 0;
  const facts = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision,
    commit(candidate) { if (failure) throw failure; state = structuredClone(candidate); revision++; commits++; return state; } };
  const ports = { unitOfWork: createUnitOfWork({ repository }), clock: { now: () => NOW }, items: PET_APPEARANCE_ITEMS,
    looks, publish: fact => facts.push(fact) };
  const command = companion.applyOutfit.createApplyOutfitCommand(ports);
  return { ports, command, facts, snapshot: repository.snapshot, commits: () => commits,
    apply: (lookId = 'sun-garden', extra = {}) => command.apply({ lookId, expectedSkin: 'usagi', ...extra }),
    custom: companion.equipAppearance.createEquipAppearanceCommand(ports) };
}
test('every trusted preset applies all supported slots with one commit and receipt; repeat is a no-op', () => {
  for (const look of USAGI_OUTFIT_SETS) {
    const h = setup();
    assert.deepEqual(h.apply(look.id), { ok: true, changed: true, lookId: look.id });
    const appearance = h.snapshot().companion.appearance;
    const slots = companion.formRegistry.resolvePetForm('usagi').supportedSlots;
    assert.equal(appearance.equipped.headwear, 'skin.crown');
    for (const slot of slots) {
      const item = PET_APPEARANCE_ITEMS.find(item => look.itemIds.includes(item.id) && item.exclusiveGroup === slot);
      assert.equal(appearance.equipped[slot], item?.id ?? null);
    }
    assert.equal(appearance.updatedAt, NOW);
    assert.equal(h.commits(), 1);
    assert.deepEqual(h.facts, [{ type: 'appearance-outfit-applied', lookId: look.id, revision: 1 }]);
    assert.deepEqual(h.apply(look.id), { ok: true, changed: false, lookId: look.id });
    assert.equal(h.commits(), 1); assert.equal(h.facts.length, 1);
    assert.equal(Object.hasOwn(appearance, 'lookId'), false);
  }
});
test('unknown, locked, stale form, missing target and stale revision leave the whole state untouched', () => {
  const cases = [
    [{}, 'unknown', {}, 'appearance-outfit-unknown'],
    [{ level: 1 }, 'sun-garden', {}, 'item-locked'],
    [{ currentSkin: 'pink' }, 'sun-garden', {}, 'appearance-target-changed'],
    [{}, 'sun-garden', { expectedSkin: 'pink' }, 'appearance-target-changed'],
    [{}, 'sun-garden', { expectedSkin: undefined }, 'appearance-target-changed'],
    [{}, 'sun-garden', { expectedRevision: 1 }, 'state-revision-conflict']
  ];
  for (const [options, id, request, reason] of cases) {
    const h = setup(options), before = h.snapshot();
    assert.deepEqual(h.apply(id, request), { ok: false, reason });
    assert.deepEqual(h.snapshot(), before); assert.equal(h.commits(), 0); assert.deepEqual(h.facts, []);
  }
});
test('malformed recipe fails without partial writes, including a bad piece after valid pieces', () => {
  for (const itemIds of [[], ['usagi.ear-bow', 'missing'], ['usagi.ear-bow', 'usagi.ear-bow'], ['skin.crown']]) {
    const h = setup({ looks: [{ id: 'broken', formId: 'usagi', itemIds }] }), before = h.snapshot();
    assert.deepEqual(h.apply('broken'), { ok: false, reason: 'appearance-outfit-invalid' });
    assert.deepEqual(h.snapshot(), before); assert.equal(h.commits(), 0);
  }
});
test('single-item customization remains independent and does not reset other preset slots', () => {
  const h = setup(); h.apply();
  const before = h.snapshot().companion.appearance.equipped;
  assert.equal(h.custom.equip({ group: 'usagi.earwear', itemId: null }).ok, true);
  assert.deepEqual(h.snapshot().companion.appearance.equipped, { ...before, 'usagi.earwear': null });
  assert.equal(h.apply().changed, true);
  assert.deepEqual(h.snapshot().companion.appearance.equipped, before);
});
test('persist failure remains unknown to transport and never publishes or partially writes', () => {
  const failure = new Error('durability unknown'), h = setup({ failure }), before = h.snapshot();
  assert.throws(() => h.apply(), error => error === failure);
  assert.deepEqual(h.snapshot(), before); assert.equal(h.commits(), 0); assert.deepEqual(h.facts, []);
});
test('effect failure cannot turn successful outfit receipt into a retryable failure', () => {
  const h = setup(); const errors = [];
  const command = companion.applyOutfit.createApplyOutfitCommand({ ...h.ports,
    publish() { throw Error('window gone'); }, reportEffectError: error => errors.push(error) });
  assert.equal(command.apply({ lookId: 'sun-garden', expectedSkin: 'usagi' }).ok, true);
  assert.equal(h.commits(), 1); assert.equal(errors.length, 1);
});
test('trusted recipes are captured before dispatch and the renderer cannot submit arbitrary slots', () => {
  const looks = structuredClone(USAGI_OUTFIT_SETS), h = setup({ looks });
  looks[0].itemIds.push('missing');
  assert.equal(h.apply().ok, true);
  const payload = { lookId: 'sun-garden', expectedSkin: 'usagi' };
  assert.deepEqual(allowedSurfacesFor('appearance:apply-outfit'), ['popover']);
  assert.equal(validateIpcPayload('appearance:apply-outfit', payload).ok, true);
  for (const invalid of [null, {}, { ...payload, expectedSkin: null }, { ...payload, itemIds: [] }, { ...payload, level: 50 }]) {
    assert.equal(validateIpcPayload('appearance:apply-outfit', invalid).ok, false);
  }
});
test('bootstrap registers one atomic preset handler with the existing wardrobe handlers', () => {
  const h = setup(), handlers = new Map();
  createCompanionWardrobe(h.ports).register((channel, handler) => handlers.set(channel, handler));
  assert.deepEqual([...handlers.keys()], ['appearance:equip', 'appearance:reset', 'appearance:apply-outfit']);
  assert.equal(handlers.get('appearance:apply-outfit')({}, { lookId: 'sun-garden', expectedSkin: 'usagi' }).ok, true);
  assert.equal(h.commits(), 1);
});
test('a later locked piece or invalid slot leaves even the domain draft untouched', () => {
  const { applyOutfit } = require('../src/capabilities/companion/domain/outfit-applying');
  for (const look of [USAGI_OUTFIT_SETS[0], { id: 'bad-slot', formId: 'usagi', itemIds: ['usagi.garden-beret', 'skin.crown'] }]) {
    const state = setup({ level: 10 }).snapshot(), before = structuredClone(state);
    const result = applyOutfit(state, { look, expectedSkin: 'usagi', items: PET_APPEARANCE_ITEMS, now: NOW });
    assert.equal(result.ok, false);
    assert.deepEqual(state, before);
  }
});
