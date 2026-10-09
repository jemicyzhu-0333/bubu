'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SKINS } = require('../src/skins.mjs');
const content = require('../src/content');
const { createPetCatalog } = require('../src/capabilities/companion/pet-catalog');

test('pet catalog exposes every preview family with frozen, deduplicated entries', () => {
  const catalog = createPetCatalog({ content, skins: SKINS });
  for (const category of ['expressions', 'actions', 'sessions', 'props', 'scenes', 'skins', 'appearances']) {
    assert.ok(Array.isArray(catalog[category]) && catalog[category].length > 0, category);
    assert.ok(Object.isFrozen(catalog[category]), `${category} should be frozen`);
  }
  assert.deepEqual(catalog.views, ['front', 'three-quarter', 'profile', 'back']);
  for (const category of ['expressions', 'actions', 'sessions', 'props', 'scenes', 'skins', 'appearances']) {
    assert.equal(new Set(catalog[category].map(item => item.id)).size, catalog[category].length, category);
  }
  assert.ok(catalog.sessions.every(item => item.category === 'session'));
  assert.ok(catalog.appearances.every(item => item.unlockKind === 'level' || item.unlockKind === 'skin'));
  assert.ok(catalog.appearances.every(item => item.exclusiveGroup === null || typeof item.exclusiveGroup === 'string'));
  assert.ok(catalog.appearances.every(item => Number.isInteger(item.exclusivePriority)));
  assert.deepEqual(catalog.counts, {
    expressions: catalog.expressions.length,
    actions: catalog.actions.length,
    sessions: catalog.sessions.length,
    props: catalog.props.length,
    scenes: catalog.scenes.length,
    skins: catalog.skins.length,
    appearances: catalog.appearances.length,
    views: catalog.views.length
  });
});
