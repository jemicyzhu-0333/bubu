'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetHitLayout } = require('../src/surfaces/pet/hit-layout.mjs');
const { resolvePetForm, formHitRect, formPeekOffsets } = require('../src/capabilities/companion/form-registry.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');

test('desktop hit rectangle follows the current form and updates on live skin changes and DPR changes', () => {
  const hit = { style: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const canvas = { style: {} };
  const root = { dataset: {}, style: { setProperty(name, value) { this[name] = value; } } };
  let stage = resolvePetStage({ devicePixelRatio: 1 });
  const layout = createPetHitLayout({ hit, canvas, root, getStage: () => stage });

  for (const [skin, formId, rendering] of [['pink', 'dango', 'auto'], ['usagi', 'usagi', 'auto'], ['pink', 'dango', 'auto']]) {
    const rectangle = formHitRect(resolvePetForm(skin), stage);
    layout.update(skin);
    assert.equal(root.dataset.petForm, formId);
    assert.equal(root.dataset.petBubble, resolvePetForm(skin).bubblePlacement);
    for (const [edge, distance] of Object.entries(formPeekOffsets(resolvePetForm(skin), stage))) {
      assert.equal(root.style[`--pet-peek-${edge}`], `${distance}px`);
    }
    assert.equal(canvas.style.imageRendering, rendering);
    assert.equal(hit.style.left, `${rectangle.left}px`);
    assert.equal(hit.style.top, `${rectangle.top}px`);
    assert.equal(hit.style.width, `${rectangle.width}px`);
    assert.equal(hit.style.height, `${rectangle.height}px`);
  }

  stage = resolvePetStage({ devicePixelRatio: 3 });
  layout.update('usagi');
  assert.equal(hit.style.height, `${formHitRect(resolvePetForm('usagi'), stage).height}px`);
  assert.match(hit.attributes['aria-label'], /小奇/);
  assert.throws(() => createPetHitLayout({ getStage: () => stage }), /hit/);
});
