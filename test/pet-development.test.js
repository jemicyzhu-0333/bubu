'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetDevelopment } = require('../src/platform/electron/dev/pet-development');

test('production profile does not expose the pet development desk', () => {
  const development = createPetDevelopment({ profile: 'production' });

  assert.deepEqual(development.menuItems(), []);
  assert.equal(development.open(), false);
  assert.equal(development.onLoaded(), false);
  assert.equal(development.start()(), undefined);
});

test('development profile opens the inspection desk and resynchronizes after reload', () => {
  const messages = [];
  let shown = 0;
  const window = {
    isAlive: () => true,
    isLoading: () => false,
    send: (...args) => { messages.push(args); return true; }
  };
  const development = createPetDevelopment({
    profile: 'development',
    sourceRoot: '/repo/src',
    getWindow: () => window,
    showPet: () => { shown += 1; }
  });

  assert.equal(development.menuItems().length, 1);
  assert.equal(development.open(), true);
  assert.equal(shown, 1);
  assert.deepEqual(messages, [
    ['pet:sync', { devMode: true }],
    ['pet:devtools', { open: true }]
  ]);

  messages.length = 0;
  assert.equal(development.onLoaded(), true);
  assert.deepEqual(messages, [['pet:sync', { devMode: true }]]);
});

test('inspection requests survive window loading and failed delivery', () => {
  const messages = [];
  let loading = true;
  let deliveryReady = false;
  const window = {
    isAlive: () => true,
    isLoading: () => loading,
    send: (channel, payload) => {
      messages.push([channel, payload]);
      return channel !== 'pet:devtools' || deliveryReady;
    }
  };
  const development = createPetDevelopment({
    profile: 'development', sourceRoot: '/repo/src', getWindow: () => window, showPet() {}
  });
  assert.equal(development.open(), false);
  assert.deepEqual(messages, []);
  loading = false;
  assert.equal(development.onLoaded(), false);
  deliveryReady = true;
  assert.equal(development.onLoaded(), true);
  assert.deepEqual(messages.slice(-2), [
    ['pet:sync', { devMode: true }], ['pet:devtools', { open: true }]
  ]);
});
