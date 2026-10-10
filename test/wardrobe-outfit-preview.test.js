'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderWardrobeOutfitPreviews } = require('../src/surfaces/popover/features/wardrobe-outfit-preview.mjs');
const { USAGI_OUTFIT_SETS } = require('../src/content/companion/usagi-wardrobe.mjs');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { selectAppearance } = require('../src/capabilities/companion/domain/appearance-selection');

function render(level, formId = 'usagi', expanded = undefined) {
  const previews = [];
  const canvases = new Map(USAGI_OUTFIT_SETS.map(look => [look.id, { style: {} }]));
  const container = { innerHTML: '', querySelector(selector) {
    return selector === 'details' ? (expanded === undefined ? null : { open: expanded })
      : canvases.get(selector.match(/data-outfit-preview="([^"]+)"/)?.[1]);
  } };
  const selection = selectAppearance({ items: PET_APPEARANCE_ITEMS, level,
    currentSkin: formId === 'usagi' ? 'usagi' : 'pink', unlockedSkins: ['pink'], equipped: {} });
  const state = { currentSkin: formId === 'usagi' ? 'usagi' : 'pink',
    appearance: { choices: selection.choices, wornIds: selection.worn.map(item => item.id) } };
  const before = structuredClone(state);
  renderWardrobeOutfitPreviews({ container, state, formId, escapeHTML: value => String(value).replace(/&/g, '&amp;'),
    drawPetPreview: (canvas, options) => previews.push({ canvas, options }) });
  assert.deepEqual(state, before, 'preview must not change equipped or worn projection');
  return { container, previews, canvases };
}

test('three named recipe cards preview exact IDs without an equip button or command', () => {
  const result = render(25);
  assert.equal(result.previews.length, 3);
  assert.match(result.container.innerHTML, /<details class="wardrobe-lookbook" open>/);
  for (const [index, look] of USAGI_OUTFIT_SETS.entries()) {
    assert.match(result.container.innerHTML, new RegExp(look.label));
    assert.deepEqual(result.previews[index].options, { skinId: 'usagi', itemIds: look.itemIds, size: 'preview' });
    assert.equal(result.canvases.get(look.id).style.width, '100%');
  }
  assert.doesNotMatch(result.container.innerHTML, /<button|data-group=|data-item=/);
  assert.equal((result.container.innerHTML.match(/配饰已全部解锁/g) || []).length, 3);
});

test('locked clothes remain an explicitly labelled preview instead of appearing owned', () => {
  const result = render(1);
  assert.equal(result.previews.length, 3);
  assert.match(result.container.innerHTML, /还有 4 件待解锁/);
  assert.match(result.container.innerHTML, /还有 5 件待解锁/);
  assert.match(result.container.innerHTML, /还有 6 件待解锁/);
  assert.doesNotMatch(result.container.innerHTML, /配饰已全部解锁/);
});

test('lookbook preserves its local disclosure and never leaks to another form', () => {
  assert.match(render(25, 'usagi', true).container.innerHTML, /<details class="wardrobe-lookbook" open>/);
  assert.match(render(25, 'usagi', false).container.innerHTML, /<details class="wardrobe-lookbook">/);
  const other = render(25, 'dango', true);
  assert.equal(other.container.innerHTML, '');
  assert.equal(other.previews.length, 0);
});
