'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { USAGI_INTERACTION_PAIRS } = require('../tools/usagi-complete-review/review-matrix.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { PET_ACTIONS } = require('../src/content/behaviors.mjs');
const { projectAppearance } = require('../src/core/pet-appearance.mjs');

test('finite Usagi interaction pairs select two real independent slots in every authored view', () => {
  assert.equal(new Set(USAGI_INTERACTION_PAIRS.map(pair => pair.id)).size, USAGI_INTERACTION_PAIRS.length);
  for (const pair of USAGI_INTERACTION_PAIRS) {
    assert.ok(PET_ACTIONS[pair.action], pair.id);
    const items = pair.itemIds.map(id => PET_APPEARANCE_ITEMS.find(item => item.id === id));
    assert.ok(items.every(item => item?.formId === 'usagi'), pair.id);
    assert.equal(new Set(items.map(item => item.exclusiveGroup)).size, 2, pair.id);
    for (const view of ['front', 'three-quarter', 'profile', 'back']) {
      const selected = projectAppearance({ skin: 'usagi', formId: 'usagi', view,
        items: PET_APPEARANCE_ITEMS, itemIds: pair.itemIds, includeLocked: true });
      assert.deepEqual(new Set(selected.items.map(item => item.id)), new Set(pair.itemIds), `${pair.id}/${view}`);
    }
  }
});
