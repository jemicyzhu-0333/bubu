'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { defaultCompanionState, normalizeCompanionState, LIMITS } = require('../src/core/companion-state');
const { appearanceGroups, selectAppearance } = require('../src/capabilities/companion/domain/appearance-selection');
const { equipAppearance, resetAppearance } = require('../src/capabilities/companion/domain/appearance-equipping');

const GROUPS = appearanceGroups(PET_APPEARANCE_ITEMS);
const EVERY_SKIN = ['pink', ...new Set(PET_APPEARANCE_ITEMS.map(item => item.skin).filter(Boolean))];
const TOP_LEVEL = Math.max(...PET_APPEARANCE_ITEMS.map(item => item.minLevel));
const NOW = 1_700_000_000_000;

// Shaped like the real draft the unit of work hands a transition: the top-level
// fields this file reads, plus a canonical companion branch.
function draft(overrides = {}) {
  return {
    level: TOP_LEVEL,
    unlockedSkins: ['pink'],
    currentSkin: 'pink',
    companion: defaultCompanionState(),
    ...overrides
  };
}

function equip(state, group, itemId, options = {}) {
  return equipAppearance(state, { group, itemId, items: PET_APPEARANCE_ITEMS, now: NOW, ...options });
}

function equippedOf(state) {
  return state.companion.appearance.equipped;
}

function itemById(id) {
  const item = PET_APPEARANCE_ITEMS.find(candidate => candidate.id === id);
  assert.ok(item, `no such catalog item: ${id}`);
  return item;
}

function skinForForm(formId) {
  return formId === 'dango' ? 'pink' : formId;
}

function skinForGroup(group) {
  const item = PET_APPEARANCE_ITEMS.find(candidate => candidate.exclusiveGroup === group);
  assert.ok(item, `no item for appearance group: ${group}`);
  return skinForForm(item.formId);
}

test('a choice survives the trip through persistence, key and value', () => {
  // The failure this rules out is silent: `normalizeEquipped` drops any entry whose
  // group or item id fails `ID_PATTERN`, so a catalog that introduced an id with a
  // capital letter or a space would have the wardrobe appear to work and then
  // forget everything on the next launch. Written as a round-trip over the whole
  // catalog rather than a spot check, because the ids come from content and will
  // keep being added to.
  const state = draft({ unlockedSkins: EVERY_SKIN });
  for (const item of PET_APPEARANCE_ITEMS) {
    state.currentSkin = skinForForm(item.formId);
    assert.deepEqual(equip(state, item.exclusiveGroup, item.id), {
      ok: true, changed: true, group: item.exclusiveGroup, itemId: item.id
    });
  }
  const saved = { ...equippedOf(state) };
  const reread = normalizeCompanionState(state.companion).appearance;
  assert.deepEqual(reread.equipped, saved);
  assert.equal(reread.updatedAt, NOW);

  // One entry per group, so a full wardrobe cannot reach the capacity that
  // normalization enforces by truncation.
  assert.equal(Object.keys(saved).length, GROUPS.length);
  assert.ok(GROUPS.length <= LIMITS.equipped);

  // `null` is a value persistence keeps rather than treats as a broken entry,
  // which is what lets "deliberately bare" outlive a restart.
  for (const group of GROUPS) {
    state.currentSkin = skinForGroup(group);
    equip(state, group, null);
  }
  assert.deepEqual(normalizeCompanionState(state.companion).appearance.equipped,
    Object.fromEntries(GROUPS.map(group => [group, null])));
});

test('equipping records the choice and when it was made', () => {
  const state = draft();
  const result = equip(state, 'headwear', 'milestone.sunhat');
  assert.deepEqual(result, { ok: true, changed: true, group: 'headwear', itemId: 'milestone.sunhat' });
  assert.deepEqual(equippedOf(state), { headwear: 'milestone.sunhat' });
  assert.equal(state.companion.appearance.updatedAt, NOW);
});

test('taking a group off is a change even though nothing new is worn', () => {
  // The three-state map `appearance-selection.js` documents, seen from the write
  // side: the first click on `[无]` turns "no opinion" into "bare on purpose", so
  // it has to commit or the automatic item would grow back on the next read.
  const state = draft();
  assert.equal(equip(state, 'headwear', null).changed, true);
  assert.deepEqual(equippedOf(state), { headwear: null });
  assert.ok(Object.prototype.hasOwnProperty.call(equippedOf(state), 'headwear'));
  assert.equal(selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: TOP_LEVEL, unlockedSkins: ['pink'],
    currentSkin: 'pink', equipped: equippedOf(state)
  }).choices.find(choice => choice.group === 'headwear').selected, null);
});

test('re-picking what is already picked commits nothing', () => {
  // What makes this worth asserting is `updatedAt`: the unit of work skips a
  // no-change transition, so the stamp keeps pointing at the last real edit
  // instead of moving every time the wardrobe is clicked.
  const state = draft();
  equip(state, 'headwear', 'milestone.sunhat');
  const before = structuredClone(state);

  const again = equip(state, 'headwear', 'milestone.sunhat', { now: NOW + 90_000 });
  assert.deepEqual(again, { ok: true, changed: false, group: 'headwear', itemId: 'milestone.sunhat' });
  assert.deepEqual(state, before);

  equip(state, 'headwear', null);
  const bare = structuredClone(state);
  assert.equal(equip(state, 'headwear', null, { now: NOW + 90_000 }).changed, false);
  assert.deepEqual(state, bare);
});

test('a group the catalog does not define is refused', () => {
  const state = draft();
  for (const group of ['hat', 'HEADWEAR', '', ' headwear', null, undefined, 42, {}, ['headwear']]) {
    assert.deepEqual(equip(state, group, 'milestone.sunhat'),
      { ok: false, reason: 'appearance-group-unknown' }, `group ${JSON.stringify(group)} was accepted`);
  }
  assert.deepEqual(equippedOf(state), {});
  assert.equal(state.companion.appearance.updatedAt, null);
});

test('an item that is not one of the group options is refused', () => {
  const state = draft({ unlockedSkins: EVERY_SKIN });
  // A real item, but belonging to another group. Reported as not-found rather than
  // as a separate mismatch error, because to the caller both mean the same thing.
  assert.deepEqual(equip(state, 'headwear', 'milestone.cape'),
    { ok: false, reason: 'appearance-item-not-found' });
  assert.deepEqual(equip(state, 'headwear', 'milestone.deleted-hat'),
    { ok: false, reason: 'appearance-item-not-found' });
  for (const itemId of ['', undefined, 42, {}, ['milestone.sunhat'], true]) {
    assert.deepEqual(equip(state, 'headwear', itemId), itemId === ''
      ? { ok: false, reason: 'appearance-item-not-found' }
      : { ok: false, reason: 'appearance-item-invalid' }, `item ${JSON.stringify(itemId)} was accepted`);
  }
  assert.deepEqual(equippedOf(state), {});
});

test('an unearned item is refused rather than quietly ignored', () => {
  // The one place this layer deliberately disagrees with selection. Selection
  // ignores a locked choice so that a level rollback does not delete it; a request
  // to wear one is not a leftover, so it gets an answer.
  const lowLevel = draft({ level: 4 });
  assert.deepEqual(equip(lowLevel, 'footwear', 'milestone.boots'), { ok: false, reason: 'item-locked' });
  assert.deepEqual(equippedOf(lowLevel), {});
  assert.equal(lowLevel.companion.appearance.updatedAt, null);

  const noCrown = draft({ level: TOP_LEVEL, unlockedSkins: ['pink'] });
  assert.deepEqual(equip(noCrown, 'headwear', 'skin.crown'), { ok: false, reason: 'item-locked' });

  // Owning the skin is enough — wearing it is not required, which is the free
  // mixing the feature exists to allow.
  const ownsCrown = draft({ currentSkin: 'pink', unlockedSkins: ['pink', 'crown'] });
  assert.equal(equip(ownsCrown, 'headwear', 'skin.crown').ok, true);
});

test('the three original Usagi accessories remain wearable at level one while new options stay locked', () => {
  const state = draft({ level: 1, currentSkin: 'usagi', unlockedSkins: ['pink'] });
  const itemIds = ['usagi.ear-bow', 'usagi.star-collar', 'usagi.travel-cape'];
  const selection = selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: state.level,
    unlockedSkins: state.unlockedSkins, currentSkin: state.currentSkin,
    equipped: state.companion.appearance.equipped
  });
  assert.deepEqual(selection.worn.map(item => item.id).sort(), itemIds.slice().sort());
  for (const choice of selection.choices) for (const option of choice.options) {
    assert.equal(option.available, itemIds.includes(option.id), option.id);
    if (!option.available) assert.deepEqual(option.lockReason,
      { kind: 'level', minLevel: itemById(option.id).minLevel });
  }
  for (const itemId of itemIds) {
    const item = itemById(itemId);
    assert.equal(equip(state, item.exclusiveGroup, itemId).ok, true, itemId);
  }
  assert.equal(Object.keys(equippedOf(state)).length, 3);
});

test('each new Usagi option unlocks at its own exact level and a refused request cannot overwrite the outfit', () => {
  const additions = PET_APPEARANCE_ITEMS.filter(item => item.formId === 'usagi' && item.unlockKind === 'level');
  assert.equal(additions.length, 22);
  for (const item of additions) {
    const state = draft({ level: item.minLevel - 1, currentSkin: 'usagi', unlockedSkins: ['pink'] });
    equip(state, 'usagi.earwear', 'usagi.ear-bow');
    equip(state, 'usagi.neckwear', 'usagi.star-collar');
    equip(state, 'usagi.backwear', 'usagi.travel-cape');
    const before = structuredClone(state);
    assert.deepEqual(equip(state, item.exclusiveGroup, item.id), { ok: false, reason: 'item-locked' }, item.id);
    assert.deepEqual(state, before, `${item.id}: refusing a locked choice leaves all state intact`);
    state.level = item.minLevel;
    assert.equal(equip(state, item.exclusiveGroup, item.id).ok, true, `${item.id}: its exact threshold is accepted`);
    assert.equal(equippedOf(state)[item.exclusiveGroup], item.id);
    const originalOtherSlots = Object.entries(before.companion.appearance.equipped)
      .filter(([group]) => group !== item.exclusiveGroup);
    for (const [group, chosen] of originalOtherSlots) assert.equal(equippedOf(state)[group], chosen);
  }
});

test('what may be equipped is exactly what the wardrobe offers', () => {
  // `appearance-equipping.js` re-states the unlock rule instead of importing
  // `lockReasonFor`, so this walks the whole catalog at several levels and asserts
  // the two never disagree. Without it the wardrobe could offer a button that the
  // transition then refuses, or grey one out that would have worked.
  for (const unlockedSkins of [['pink'], ['pink', 'crown', 'ocean'], EVERY_SKIN]) {
    for (const level of [1, 4, 8, 12, 15, TOP_LEVEL]) {
      const offered = new Map();
      for (const choice of selectAppearance({
        items: PET_APPEARANCE_ITEMS, level, unlockedSkins, currentSkin: 'pink', equipped: {}
      }).choices) {
        for (const option of choice.options) offered.set(option.id, option.available);
      }
      for (const choice of selectAppearance({
        items: PET_APPEARANCE_ITEMS, level, unlockedSkins, currentSkin: 'usagi', equipped: {}
      }).choices) {
        for (const option of choice.options) offered.set(option.id, option.available);
      }
      for (const item of PET_APPEARANCE_ITEMS) {
        const accepted = equip(draft({
          level, unlockedSkins, currentSkin: skinForForm(item.formId)
        }), item.exclusiveGroup, item.id).ok;
        assert.equal(accepted, offered.get(item.id),
          `${item.id} at Lv.${level} owning ${unlockedSkins.length} skins: offered ${offered.get(item.id)}, accepted ${accepted}`);
      }
    }
  }
});

test('one item per group, so equipping replaces rather than accumulates', () => {
  const state = draft({ unlockedSkins: EVERY_SKIN });
  equip(state, 'headwear', 'milestone.sunhat');
  equip(state, 'headwear', 'skin.crown');
  assert.deepEqual(equippedOf(state), { headwear: 'skin.crown' });

  equip(state, 'backwear', 'skin.ocean-fin');
  assert.deepEqual(equippedOf(state), { headwear: 'skin.crown', backwear: 'skin.ocean-fin' });
  const worn = selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: TOP_LEVEL, unlockedSkins: EVERY_SKIN,
    currentSkin: 'pink', equipped: equippedOf(state)
  }).worn.map(item => item.id);
  assert.ok(worn.includes('skin.crown'));
  assert.ok(worn.includes('skin.ocean-fin'));
  assert.ok(!worn.includes('milestone.sunhat'));
  assert.ok(!worn.includes('milestone.cape'));
});

test('resetting clears every choice and restores the automatic pet', () => {
  const state = draft({ unlockedSkins: EVERY_SKIN });
  const stock = selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: TOP_LEVEL, unlockedSkins: EVERY_SKIN,
    currentSkin: 'pink', equipped: {}
  }).worn.map(item => item.id);

  equip(state, 'headwear', 'skin.crown');
  equip(state, 'backwear', null);
  assert.deepEqual(resetAppearance(state, { now: NOW + 1 }), { ok: true, changed: true });
  assert.deepEqual(equippedOf(state), {});
  assert.equal(state.companion.appearance.updatedAt, NOW + 1);

  // Emptying the map is not the same as writing `null` into every group: the pet
  // must come back stock, not naked.
  assert.deepEqual(selectAppearance({
    items: PET_APPEARANCE_ITEMS, level: TOP_LEVEL, unlockedSkins: EVERY_SKIN,
    currentSkin: 'pink', equipped: equippedOf(state)
  }).worn.map(item => item.id), stock);
  assert.ok(stock.length > 0);
});

test('resetting an untouched wardrobe commits nothing', () => {
  const state = draft();
  const before = structuredClone(state);
  assert.deepEqual(resetAppearance(state, { now: NOW }), { ok: true, changed: false });
  assert.deepEqual(state, before);
});

test('only the companion branch is written, which is what the command declares', () => {
  // `writes: ['companion']` on the command is checked against the paths this
  // transition actually touches, so a stray write to `level` or `currentSkin` would
  // fail at the unit of work rather than here. Asserting it here names the reason.
  const state = draft({ unlockedSkins: EVERY_SKIN, streak: 4, xp: 900 });
  const before = structuredClone(state);
  equip(state, 'headwear', 'skin.crown');
  resetAppearance(state, { now: NOW + 1 });
  equip(state, 'neckwear', 'milestone.scarf');

  for (const key of Object.keys(before)) {
    if (key === 'companion') continue;
    assert.deepEqual(state[key], before[key], `${key} was modified`);
  }
  const { appearance, ...restAfter } = state.companion;
  const { appearance: _ignored, ...restBefore } = before.companion;
  assert.deepEqual(restAfter, restBefore);
  assert.deepEqual(appearance, { equipped: { neckwear: 'milestone.scarf' }, updatedAt: NOW });
});

test('the level and the unlocks come off the draft, not off the request', () => {
  // A caller cannot grant itself an unlock by passing one, because there is nowhere
  // to pass it: the transition reads the same state it is about to write.
  const state = draft({ level: 4, unlockedSkins: ['pink'] });
  const result = equipAppearance(state, {
    group: 'footwear', itemId: 'milestone.boots', items: PET_APPEARANCE_ITEMS, now: NOW,
    level: 99, unlockedSkins: EVERY_SKIN
  });
  assert.deepEqual(result, { ok: false, reason: 'item-locked' });

  // And a nonsensical stored level reads as level 1 rather than throwing, the same
  // way `selectAppearance` reads it, so a repaired store still dresses the pet.
  for (const level of [0, -20, null, undefined, Number.NaN, 'nine', {}]) {
    const broken = draft({ level, unlockedSkins: ['pink'] });
    assert.equal(equip(broken, 'headwear', 'milestone.sprout').reason, 'item-locked');
    assert.equal(equip(broken, 'head-accent', 'skin.forest-leaf').reason, 'item-locked');
  }
  const owned = draft({ level: 0, unlockedSkins: ['pink', 'forest'] });
  assert.equal(equip(owned, 'head-accent', 'skin.forest-leaf').ok, true);
});

test('a draft missing the companion branch gets one rather than throwing', () => {
  // Normalization always emits `companion.appearance`, so this is reached only by a
  // hand-built draft or a store repaired mid-flight. Building the branch keeps a
  // first-ever equip working on a state that has everything else.
  for (const companion of [undefined, null, {}, 'companion', [], { appearance: null }, { appearance: { equipped: 'none' } }]) {
    const state = { level: TOP_LEVEL, unlockedSkins: ['pink'], companion };
    assert.equal(equip(state, 'headwear', 'milestone.sunhat').changed, true);
    assert.deepEqual(equippedOf(state), { headwear: 'milestone.sunhat' });
  }
  const bare = { level: TOP_LEVEL, unlockedSkins: ['pink'] };
  assert.deepEqual(resetAppearance(bare, { now: NOW }), { ok: true, changed: false });
  assert.deepEqual(bare.companion.appearance, { equipped: {}, updatedAt: null });
});

test('a caller that cannot say what state, when or from which catalog gets a TypeError', () => {
  // Separated from the `{ok: false}` reasons on purpose: a bad group or item id is
  // a user action to report, while a missing draft or clock is a wiring mistake and
  // must not be reachable in a shipped build.
  for (const state of [undefined, null, 'state', 42, []]) {
    assert.throws(() => equip(state, 'headwear', 'milestone.sunhat'), TypeError);
    assert.throws(() => resetAppearance(state, { now: NOW }), TypeError);
  }
  // A timestamp normalization would turn back into `null` is refused up front.
  for (const now of [undefined, null, 'now', Number.NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => equip(draft(), 'headwear', 'milestone.sunhat', { now }), TypeError);
    assert.throws(() => resetAppearance(draft(), { now }), TypeError);
  }
  assert.throws(() => resetAppearance(draft()), TypeError);
  for (const items of [undefined, null, 'catalog', {}, 42]) {
    assert.throws(() => equipAppearance(draft(), { group: 'headwear', itemId: null, items, now: NOW }), TypeError);
  }
  // A catalog with junk in it is workable — the group set is what matters, and
  // `appearanceGroups` already skips malformed entries.
  const state = draft();
  const sunhat = itemById('milestone.sunhat');
  assert.equal(equipAppearance(state, {
    group: 'headwear', itemId: 'milestone.sunhat', items: [null, 42, { label: 'no id' }, sunhat], now: NOW
  }).ok, true);
  assert.equal(equipAppearance(draft(), {
    group: 'headwear', itemId: 'milestone.sunhat', items: [], now: NOW
  }).reason, 'appearance-group-unknown');
});
