'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { selectPetRendererPage } = require('../src/platform/electron/windows/pet-renderer-selection');
const pagePath = path.resolve('src/renderer/pet.html');
for (const development of [false, true]) for (const defaultApp of [false, true]) {
  test(`realtime renderer requires development=${development} and defaultApp=${defaultApp}`, () => {
    const selected = selectPetRendererPage({ pagePath, development, defaultApp, requested: '1' });
    assert.equal(selected, development && defaultApp
      ? path.resolve('src/surfaces/pet/realtime/index.html') : pagePath);
  });
}
test('missing, false-like and arbitrary path flags preserve the production page', () => {
  for (const requested of [undefined, '', '0', 'true', '/tmp/foreign.html'])
    assert.equal(selectPetRendererPage({ pagePath, development: true, defaultApp: true, requested }), pagePath);
});
test('selection rejects absent page path', () => {
  assert.throws(() => selectPetRendererPage(), /path/);
});
