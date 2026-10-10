'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSatiationLabel } = require('../src/surfaces/pet/feeding-copy.mjs');
const { displaySatiation } = require('../src/surfaces/companion/satiation-display.mjs');
const { createPetFoodMenu } = require('../src/surfaces/pet/food-menu.mjs');
const { createPopoverCompanionFeature } = require('../src/surfaces/popover/features/companion.mjs');
const { dom } = require('../test-support/manual-growth-dom');
const { FOODS } = require('../src/pet-content');

for (const [input, expected] of [[0, 0], [0.4, 0], [0.5, 1], [45.5, 46], [99.1, 99], [99.5, 100], [99.9, 100], [100, 100], [101.7, 100], [-2, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0], [undefined, 0], [null, 0], ['99.6', 0]]) {
  test(`satiation display ${String(input)} becomes bounded integer ${expected}`, () => {
    assert.equal(displaySatiation(input), expected);
    assert.ok(Number.isInteger(displaySatiation(input)));
  });
}

test('food menu text, progress width and accessible value agree without changing fractional state', async () => {
  const { $, document } = dom();
  const state = { satiation: 99.6, foodInventory: { berry: 2 }, foodTickets: 6, totalFeeds: 0,
    basicMeal: { dayKey: '2026-10-09', remaining: 3, eligible: false } };
  const bars = [];
  const menu = createPetFoodMenu({ document, client: { pet_getFeedState: async () => state, pet_feed() {} },
    content: () => ({ FOODS }), setOpen() {}, available: () => true, beforeOpen() {}, closeCommandMenu: async () => {},
    expand: async () => ({}), changed() {}, focusReturn() {}, requestFrame: () => 1, cancelFrame() {},
    updateSatBar: value => bars.push(value), feeding: { clock: { read: () => 0 }, now: () => 1000, nonce: () => 'display', present() {}, say() {} } });
  await menu.open();
  assert.equal($('#fpSatTxt').textContent, '饱食 100/100');
  assert.equal($('#fpSatFill').style.width, '100%');
  assert.equal($('#fpSatProgress').attributes['aria-valuenow'], '100');
  assert.equal($('#fpSatProgress').attributes['aria-valuetext'], '饱食 100/100');
  assert.equal(bars.at(-1), 100);
  assert.equal(state.satiation, 99.6);
  menu.dispose();
});

test('companion summary rounds only satiation and preserves the projected value', () => {
  const { $ } = dom();
  const state = { companionProjection: { satiation: 45.5, totalFeeds: 3, bond: { points: 2.5, label: '初识', percent: 5 } } };
  const feature = createPopoverCompanionFeature({ getState: () => state, $, escapeHTML: String,
    skinAccent: () => ({}), surfaceClient: { buyFood() {} } });
  feature.renderCompanion();
  assert.equal($('#companionSatiationValue').textContent, '46');
  assert.equal($('#companionSatiationStat').attributes['aria-label'], '饱食 46/100');
  assert.equal($('#companionMealsValue').textContent, '3');
  assert.equal(state.companionProjection.satiation, 45.5);
  assert.equal(state.companionProjection.bond.points, 2.5);
});

test('actual pet floating bar function uses the same integer display and finite fallback', contextTest => {
  const source = fs.readFileSync(path.join(__dirname, '../src/surfaces/pet/controller.mjs'), 'utf8');
  const body = source.slice(source.indexOf('function updateSatBar(satiation) {'), source.indexOf('// 关闭：', source.indexOf('function updateSatBar(satiation) {')));
  const { $, document } = dom();
  const satiationLabel = createSatiationLabel({ label: $('#satLabel') });
  contextTest.after(() => satiationLabel.dispose());
  const context = { document, displaySatiation, satiationLabel, clearTimeout() {}, setTimeout: () => 1 };
  vm.runInNewContext(`${body}\nupdateSatBar(99.6);`, context);
  assert.equal($('#satLabel').textContent, '饱食 100');
  assert.equal($('#satFill').style.width, '100%');
  vm.runInNewContext('updateSatBar(NaN);', context);
  assert.equal($('#satLabel').textContent, '饱食 0');
  assert.equal($('#satFill').style.width, '0%');
});
