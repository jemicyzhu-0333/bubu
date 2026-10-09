'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const companion = require('../src/capabilities/companion');

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

test('skin selection writes only an unlocked known skin and effects observe committed state', () => {
  const repository = createRepository({ currentSkin: 'pink', unlockedSkins: ['pink', 'forest'] });
  const events = [];
  const command = companion.selectSkin.createSelectSkinCommand({
    unitOfWork: createUnitOfWork({ repository }),
    availableSkinIds: ['pink', 'forest', 'bat'],
    publish: fact => {
      assert.equal(repository.inspect().state.currentSkin, fact.skinId);
      events.push(fact);
    }
  });

  assert.deepEqual(command.execute({ skinId: 'forest' }), {
    ok: true, changed: true, skinId: 'forest'
  });
  assert.deepEqual(command.execute({ skinId: 'forest' }), {
    ok: true, changed: false, skinId: 'forest'
  });
  assert.equal(command.execute({ skinId: 'bat' }).reason, 'skin-locked');
  assert.equal(command.execute({ skinId: 'unknown' }).reason, 'skin-not-found');
  assert.equal(repository.inspect().commits, 1);
  assert.deepEqual(events.map(event => event.type), ['skin-selected']);
});

test('stale skin selection is rejected without a second commit', () => {
  const repository = createRepository({ currentSkin: 'pink', unlockedSkins: ['pink', 'forest'] });
  const command = companion.selectSkin.createSelectSkinCommand({
    unitOfWork: createUnitOfWork({ repository }),
    availableSkinIds: ['pink', 'forest']
  });

  assert.equal(command.execute({ skinId: 'forest', expectedRevision: 2 }).reason, 'state-revision-conflict');
  assert.equal(repository.inspect().commits, 0);
});

test('a level-one account can select the bundled form without earning an unlock first', () => {
  const repository = createRepository({ level: 1, currentSkin: 'pink', unlockedSkins: ['pink'] });
  const command = companion.selectSkin.createSelectSkinCommand({
    unitOfWork: createUnitOfWork({ repository }),
    availableSkinIds: ['pink', 'usagi', 'forest']
  });

  assert.deepEqual(command.execute({ skinId: 'usagi' }), {
    ok: true, changed: true, skinId: 'usagi'
  });
  assert.equal(command.execute({ skinId: 'forest' }).reason, 'skin-locked');
  assert.equal(command.execute({ skinId: 'not-in-the-catalog' }).reason, 'skin-not-found');
  assert.equal(repository.inspect().state.currentSkin, 'usagi');
  assert.deepEqual(repository.inspect().state.unlockedSkins, ['pink']);
  assert.equal(repository.inspect().commits, 1);
});
