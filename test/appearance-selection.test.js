'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { projectAppearance } = require('../src/core/pet-appearance.mjs');
const { PET_ART_BLEED } = require('../src/core/pet-stage.mjs');
const { resolvePetForm } = require('../src/capabilities/companion/form-registry.mjs');
const { appearanceGroups, selectAppearance } = require('../src/capabilities/companion/domain/appearance-selection');

const GROUPS = appearanceGroups(PET_APPEARANCE_ITEMS);
const DANGO_GROUPS = appearanceGroups(PET_APPEARANCE_ITEMS.filter(item => item.formId === 'dango'));
const USAGI_GROUPS = appearanceGroups(PET_APPEARANCE_ITEMS.filter(item => item.formId === 'usagi'));
const ALL_SKINS = ['pink', ...new Set(PET_APPEARANCE_ITEMS.map(item => item.skin).filter(Boolean))];
const EVERY_SKIN = [...ALL_SKINS];
const TOP_LEVEL = Math.max(...PET_APPEARANCE_ITEMS.map(item => item.minLevel));

function ids(result) {
  return result.worn.map(item => item.id);
}

function select(overrides = {}) {
  return selectAppearance({
    items: PET_APPEARANCE_ITEMS,
    level: TOP_LEVEL,
    unlockedSkins: ['pink'],
    currentSkin: 'pink',
    equipped: {},
    ...overrides
  });
}

function itemById(id) {
  const item = PET_APPEARANCE_ITEMS.find(candidate => candidate.id === id);
  assert.ok(item, `no such catalog item: ${id}`);
  return item;
}

function optionsFor(result, group) {
  const choice = result.choices.find(entry => entry.group === group);
  assert.ok(choice, `no choices for group: ${group}`);
  return choice;
}

test('the catalog still has the shape this feature was designed against', () => {
  assert.deepEqual(DANGO_GROUPS, [
    'backwear', 'footwear', 'head-accent', 'head-aura', 'headwear', 'neckwear', 'sidebag'
  ]);
  assert.deepEqual(USAGI_GROUPS, [
    'usagi.aura', 'usagi.backwear', 'usagi.earwear', 'usagi.footwear',
    'usagi.headwear', 'usagi.neckwear', 'usagi.sidebag'
  ]);
  assert.deepEqual(GROUPS, [...DANGO_GROUPS, ...USAGI_GROUPS]);
  // Every shipping item belongs to a group, so every item is offered somewhere.
  assert.equal(PET_APPEARANCE_ITEMS.filter(item => item.exclusiveGroup).length, PET_APPEARANCE_ITEMS.length);
});

test('with nothing chosen the pet looks exactly as it did before the wardrobe existed', () => {
  // The visual-inertia guarantee, stated as an identity rather than a spot check:
  // for every skin and every level, an empty preference map must reproduce the
  // 0.1.4 automatic result item for item. This is also what stops the frozen copy
  // of the priority rule in `appearance-selection.js` from drifting away from
  // `resolveExclusiveItems`, which is the original.
  for (const skin of EVERY_SKIN) {
    for (let level = 1; level <= TOP_LEVEL + 5; level += 1) {
      const automatic = projectAppearance({ skin, formId: resolvePetForm(skin).id, level, view: 'front' })
        .items.map(item => item.id);
      const selected = ids(select({ level, currentSkin: skin, unlockedSkins: EVERY_SKIN }));
      // Compared in order, not as sets: both sides claim to hand the compositor a
      // z-ascending list, and a divergence there is a layering bug.
      assert.deepEqual(selected, automatic,
        `${skin} at level ${level} diverged from the automatic result`);
    }
  }
});

test('the default ignores what the user owns, so unlocking a skin changes nothing on its own', () => {
  // The counterpart to the test above and the reason ownership governs only the
  // choice: someone at the top level who owns every skin must still see their
  // pink pet's own accessories until they say otherwise. Judging the *automatic*
  // pick by ownership would put a crown (priority 90) on a pink pet the moment
  // the crown skin unlocked.
  const owningNothingElse = ids(select({ unlockedSkins: ['pink'] }));
  const owningEverything = ids(select({ unlockedSkins: EVERY_SKIN }));
  assert.deepEqual(owningEverything, owningNothingElse);
  assert.ok(owningNothingElse.includes('milestone.sunhat'));
  assert.ok(!owningNothingElse.includes('skin.crown'));

  // Owning the skins does change what may be picked, which is the whole feature.
  assert.equal(optionsFor(select({ unlockedSkins: ['pink'] }), 'headwear')
    .options.filter(option => option.available).length, 2);
  assert.equal(optionsFor(select({ unlockedSkins: EVERY_SKIN }), 'headwear')
    .options.filter(option => option.available).length, 6);
});

test('a choice overrides the automatic pick', () => {
  const result = select({ unlockedSkins: EVERY_SKIN, equipped: { headwear: 'milestone.sprout' } });
  assert.ok(ids(result).includes('milestone.sprout'));
  assert.ok(!ids(result).includes('milestone.sunhat'));
  assert.equal(optionsFor(result, 'headwear').selected, 'milestone.sprout');
  // Only the group that was spoken for moves.
  assert.equal(optionsFor(result, 'backwear').selected, optionsFor(select(), 'backwear').selected);
});

test('a cross-skin choice is honoured on any skin, which is what free mixing means', () => {
  const result = select({
    currentSkin: 'pink',
    unlockedSkins: ['pink', 'crown', 'ocean'],
    equipped: { headwear: 'skin.crown', backwear: 'skin.ocean-fin' }
  });
  assert.ok(ids(result).includes('skin.crown'));
  assert.ok(ids(result).includes('skin.ocean-fin'));
  // And the cape it displaces is still offered, unlike under the automatic rule
  // where ocean-fin's priority 100 beat cape's 80 with no way to say otherwise.
  const backwear = optionsFor(result, 'backwear');
  assert.equal(backwear.selected, 'skin.ocean-fin');
  assert.ok(backwear.options.find(option => option.id === 'milestone.cape').available);
});

test('an explicit null empties its group and only its group', () => {
  const bare = select({ equipped: { headwear: null } });
  assert.equal(optionsFor(bare, 'headwear').selected, null);
  assert.ok(!ids(bare).some(id => itemById(id).exclusiveGroup === 'headwear'));
  assert.deepEqual(
    ids(bare),
    ids(select()).filter(id => itemById(id).exclusiveGroup !== 'headwear')
  );
  // Every group off at once is a legal state, not an error.
  const naked = select({ equipped: Object.fromEntries(DANGO_GROUPS.map(group => [group, null])) });
  assert.deepEqual(ids(naked), []);
  assert.deepEqual(naked.bleed, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.equal(naked.choices.length, DANGO_GROUPS.length);
});

test('a locked choice falls back to the automatic pick and says why it is locked', () => {
  const result = select({ unlockedSkins: ['pink'], equipped: { headwear: 'skin.crown' } });
  assert.ok(!ids(result).includes('skin.crown'));
  assert.equal(optionsFor(result, 'headwear').selected, 'milestone.sunhat');
  const crown = optionsFor(result, 'headwear').options.find(option => option.id === 'skin.crown');
  assert.equal(crown.available, false);
  assert.deepEqual(crown.lockReason, { kind: 'skin', skin: 'crown' });

  const lowLevel = select({ level: 4, unlockedSkins: ['pink'] });
  const boots = optionsFor(lowLevel, 'footwear').options.find(option => option.id === 'milestone.boots');
  assert.equal(boots.available, false);
  assert.deepEqual(boots.lockReason, { kind: 'level', minLevel: 15 });
  // Available options carry no reason at all rather than a null-ish placeholder.
  assert.equal(optionsFor(lowLevel, 'headwear').options.find(o => o.id === 'milestone.sprout').lockReason, null);
});

test('a level rollback hides a choice without deleting it', () => {
  // Deliberate: a data repair or a level correction must not throw away something
  // the user picked. The preference lives in persistence and is not touched here,
  // so the same map produces the item again once the level is back.
  const equipped = { footwear: 'milestone.boots' };
  const demoted = select({ level: 9, equipped });
  assert.ok(!ids(demoted).includes('milestone.boots'));
  assert.equal(optionsFor(demoted, 'footwear').selected, null);

  const restored = select({ level: 15, equipped });
  assert.ok(ids(restored).includes('milestone.boots'));
  assert.equal(optionsFor(restored, 'footwear').selected, 'milestone.boots');
});

test('junk in the preference map is discarded, never raised', () => {
  const expected = ids(select());
  const junk = [
    { 'no-such-group': 'milestone.sunhat' },
    { headwear: 'milestone.satchel' },
    { headwear: 'milestone.deleted-hat' },
    { headwear: '' },
    { headwear: 42 },
    { headwear: undefined },
    { headwear: { id: 'milestone.sunhat' } },
    { headwear: ['milestone.sunhat'] }
  ];
  for (const equipped of junk) {
    const result = select({ equipped });
    assert.deepEqual(ids(result), expected, `${JSON.stringify(equipped)} changed the result`);
    assert.equal(result.choices.length, DANGO_GROUPS.length);
    // A group the catalog does not define never appears, however it got saved.
    assert.ok(result.choices.every(choice => GROUPS.includes(choice.group)));
  }
  // `undefined` is a present key, but it is not a saved `null`: it fails to name
  // an item, so it falls back rather than emptying the group. Worth stating
  // because JSON cannot hold it and only a tampered store can produce it.
  assert.equal(optionsFor(select({ equipped: { headwear: undefined } }), 'headwear').selected, 'milestone.sunhat');
});

test('a malformed catalog is refused, and malformed entries inside one are skipped', () => {
  for (const items of [undefined, null, 'catalog', {}, 42]) {
    assert.throws(() => selectAppearance({ items }), TypeError);
  }
  const result = selectAppearance({
    items: [null, undefined, 42, { label: 'no id' }, itemById('milestone.sunhat')],
    level: TOP_LEVEL,
    unlockedSkins: ['pink'],
    currentSkin: 'pink',
    equipped: {}
  });
  assert.deepEqual(ids(result), ['milestone.sunhat']);
  // An empty catalog is a legal one: nothing to wear, nothing to offer.
  assert.deepEqual(selectAppearance({ items: [] }), { worn: [], choices: [], bleed: { left: 0, top: 0, right: 0, bottom: 0 } });
});

test('a missing or nonsensical level, skin or preference map still produces a pet', () => {
  const base = ids(select({ level: 1, currentSkin: 'pink' }));
  for (const level of [0, -20, null, undefined, Number.NaN, 'nine', {}]) {
    assert.deepEqual(ids(select({ level })), base, `level ${String(level)} did not fall back to 1`);
  }
  for (const equipped of [null, undefined, 'headwear', 42, []]) {
    assert.deepEqual(ids(select({ equipped })), ids(select()), `equipped ${String(equipped)} was not ignored`);
  }
  // An unknown skin wears no skin accessories, which is the same as pink here and
  // is the honest answer: nothing in the catalog belongs to it.
  const unknown = select({ currentSkin: 'not-a-skin', unlockedSkins: EVERY_SKIN });
  assert.ok(unknown.worn.every(item => !item.skin));
});

test('a group never yields more than one item', () => {
  // The invariant that gives "exclusive group" its meaning: one item per shared
  // patch of screen. Checked across the same space the identity test walks.
  for (const skin of EVERY_SKIN) {
    for (let level = 1; level <= TOP_LEVEL; level += 1) {
      for (const equipped of [{}, { headwear: 'skin.crown' }, { backwear: null }]) {
        const result = selectAppearance({
          items: PET_APPEARANCE_ITEMS, level, currentSkin: skin, unlockedSkins: EVERY_SKIN, equipped
        });
        const perGroup = new Map();
        for (const item of result.worn) {
          perGroup.set(item.exclusiveGroup, (perGroup.get(item.exclusiveGroup) || 0) + 1);
        }
        assert.ok([...perGroup.values()].every(count => count === 1),
          `${skin}/${level}/${JSON.stringify(equipped)} wore two items in one group`);
        assert.equal(result.worn.length, result.choices.filter(choice => choice.selected).length);
      }
    }
  }
});

test('the worn list arrives in the order the compositor expects', () => {
  const result = select({ unlockedSkins: EVERY_SKIN, equipped: { headwear: 'skin.crown' } });
  const sorted = [...result.worn].sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  assert.deepEqual(ids(result), sorted.map(item => item.id));
});

test('each form sees only its own slots and preserves its outfit after a switch', () => {
  const equipped = {
    headwear: 'skin.crown', backwear: null,
    'usagi.earwear': null, 'usagi.neckwear': 'usagi.star-collar'
  };
  const dango = select({ unlockedSkins: EVERY_SKIN, currentSkin: 'pink', equipped });
  const usagi = select({ unlockedSkins: EVERY_SKIN, currentSkin: 'usagi', equipped });
  assert.deepEqual(dango.choices.map(choice => choice.group), DANGO_GROUPS);
  assert.deepEqual(usagi.choices.map(choice => choice.group), USAGI_GROUPS);
  assert.equal(optionsFor(dango, 'headwear').selected, 'skin.crown');
  assert.equal(optionsFor(usagi, 'usagi.earwear').selected, null);
  assert.equal(optionsFor(usagi, 'usagi.neckwear').selected, 'usagi.star-collar');
  assert.ok(dango.worn.every(item => item.formId === 'dango'));
  assert.ok(usagi.worn.every(item => item.formId === 'usagi'));
  assert.deepEqual(ids(select({ unlockedSkins: EVERY_SKIN, currentSkin: 'pink', equipped })), ids(dango));
});

test('every legal combination of accessories fits inside the stage safe area', () => {
  // Single-item compliance is not combination compliance, and this is the test
  // that will fail on the day someone adds a sixteenth-plus accessory that
  // reaches further than the stage allows. It walks every legal outfit — each
  // group empty or holding any one of its items — rather than sampling.
  //
  // A combined bleed is the per-side maximum: `bleed` is a reach past the body,
  // so two items reaching up 16 and 32 reach up 32 together. Summing them would
  // report 160 on the top edge for the shipping catalog and be wrong; the halo's
  // 32 already contains the one real stacking case, the lift a hat gives it.
  const byGroup = DANGO_GROUPS.map(group => [
    null,
    ...PET_APPEARANCE_ITEMS.filter(item => item.exclusiveGroup === group)
  ]);
  const worst = { left: 0, top: 0, right: 0, bottom: 0 };
  let combinations = 0;

  const walk = (index, chosen) => {
    if (index === byGroup.length) {
      combinations += 1;
      const result = selectAppearance({
        items: PET_APPEARANCE_ITEMS,
        level: TOP_LEVEL,
        unlockedSkins: EVERY_SKIN,
        currentSkin: 'pink',
        equipped: Object.fromEntries(chosen)
      });
      assert.deepEqual(ids(result), chosen.filter(([, id]) => id !== null).map(([, id]) => id).sort(
        (left, right) => itemById(left).z - itemById(right).z || left.localeCompare(right)
      ));
      for (const side of ['left', 'top', 'right', 'bottom']) {
        assert.ok(result.bleed[side] <= PET_ART_BLEED,
          `${JSON.stringify(chosen)} reaches ${result.bleed[side]} past the ${side} edge, over ${PET_ART_BLEED}`);
        if (result.bleed[side] > worst[side]) worst[side] = result.bleed[side];
      }
      return;
    }
    for (const item of byGroup[index]) {
      walk(index + 1, [...chosen, [DANGO_GROUPS[index], item ? item.id : null]]);
    }
  };
  walk(0, []);

  assert.equal(combinations, byGroup.reduce((total, options) => total * options.length, 1));
  assert.equal(combinations, 1792);
  // Recorded rather than merely bounded: the headroom is the useful number when
  // judging whether a new accessory has room, and it is per side.
  assert.deepEqual(worst, { left: 18, top: 32, right: 22, bottom: 0 });
});

test('the result is frozen, so a caller cannot dress the pet by mutating a projection', () => {
  const result = select();
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.worn));
  assert.ok(Object.isFrozen(result.choices));
  assert.ok(Object.isFrozen(result.bleed));
  assert.ok(result.choices.every(choice => Object.isFrozen(choice) && Object.isFrozen(choice.options)));
  assert.throws(() => { result.worn.push(itemById('skin.crown')); }, TypeError);
});

test('the group list comes off the catalog rather than a second copy of it', () => {
  assert.deepEqual(appearanceGroups(PET_APPEARANCE_ITEMS), GROUPS);
  assert.ok(Object.isFrozen(appearanceGroups(PET_APPEARANCE_ITEMS)));
  assert.deepEqual(appearanceGroups([]), []);
  assert.deepEqual(appearanceGroups(null), []);
  assert.deepEqual(appearanceGroups([{ exclusiveGroup: 'b' }, { exclusiveGroup: 'a' }, { exclusiveGroup: 'b' }]), ['a', 'b']);
  // Every group the wardrobe can be asked about is a group the catalog defines,
  // which is what makes this list usable as the payload validator's whitelist.
  assert.deepEqual(DANGO_GROUPS, [...new Set(select().choices.map(choice => choice.group))]);
  assert.deepEqual(USAGI_GROUPS, select({ currentSkin: 'usagi' }).choices.map(choice => choice.group));
});
