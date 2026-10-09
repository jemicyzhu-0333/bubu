'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const companion = require('../src/capabilities/companion');
const { PET_APPEARANCE_ITEMS } = require('../src/content/appearance.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { petVisibleRect } = require('../src/core/pet-docking');

const { PET_FORMS, resolvePetForm, previewSkinForForm, resolveFormMotion, formHitRect,
  visualSizeForForm, visualSizeForSkin, resolveFormStage, formPeekOffsets,
  validatePetForms } = companion.formRegistry;

test('form registry is read-only and every skin resolves a complete independent rig', () => {
  assert.deepEqual(Object.keys(PET_FORMS), ['dango', 'usagi']);
  assert.equal(resolvePetForm('pink').id, 'dango');
  assert.equal(resolvePetForm('ocean'), resolvePetForm('pink'));
  assert.equal(resolvePetForm('usagi').id, 'usagi');
  assert.equal(resolvePetForm('a-removed-skin'), resolvePetForm('pink'));
  assert.equal(previewSkinForForm('usagi', 'pink'), 'usagi');
  assert.equal(previewSkinForForm('dango', 'usagi'), 'pink');
  assert.equal(previewSkinForForm('dango', 'forest'), 'forest');
  assert.ok(Object.isFrozen(PET_FORMS));
  assert.ok(Object.isFrozen(PET_FORMS.usagi.faceRig.front));
  assert.ok(Object.isFrozen(PET_FORMS.usagi.anatomyRig.profile));
  assert.ok(Object.isFrozen(PET_FORMS.usagi.appearanceAnchors));
  assert.equal(PET_FORMS.usagi.renderer, 'vector');
  assert.equal(PET_FORMS.dango.renderer, 'raster');
  assert.equal(validatePetForms().forms, 2);
  for (const item of PET_APPEARANCE_ITEMS) {
    assert.ok(PET_FORMS[item.formId].supportedSlots.includes(item.exclusiveGroup), item.id);
  }
});

test('motion identities are scoped by form and every unsupported gesture has a static-safe fallback', () => {
  assert.equal(resolveFormMotion(PET_FORMS.dango, { motion: 'dig' }), 'dig');
  assert.equal(resolveFormMotion(PET_FORMS.usagi, { motion: 'high-five' }), 'high-five');
  assert.equal(resolveFormMotion(PET_FORMS.usagi, { motion: 'read' }), 'read');
  assert.equal(resolveFormMotion(PET_FORMS.usagi, { motion: 'alien-motion' }), 'curious');
  assert.equal(resolveFormMotion(PET_FORMS.usagi, null), 'curious');
  assert.throws(() => resolveFormMotion({}, null), /registered/);
});

test('ear height changes hit geometry and the window docking rectangle follows the actual canvas layout', () => {
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const box = formHitRect(PET_FORMS.usagi, stage);
  assert.ok(box.top < stage.hitCssOffset - 25);
  assert.ok(box.height > stage.hitCssSize);
  assert.ok(box.top >= 0);
  assert.ok(box.top + box.height < stage.cssHeight);
  const bounds = { x: 28, y: 78, width: 220, height: 220 };
  for (const skin of ['pink', 'usagi']) {
    const form = resolvePetForm(skin);
    const rect = formHitRect(form, stage);
    const visual = petVisibleRect(bounds, visualSizeForSkin(skin));
    // Stage is centered in the 220px window. The canvas is 219px wide,
    // left 0.5px and top 2.5px; the default pet has a 2px vertical baseline.
    assert.equal(visual.x - bounds.x, (bounds.width - 220) / 2 + 0.5 + rect.left);
    assert.equal(visual.y - bounds.y, (bounds.height - 220) / 2 + 2.5 + rect.top);
    assert.equal(visual.width, rect.width);
    assert.equal(visual.height, rect.height);
  }
});

test('form-owned bubble placement and peek distances keep long ears and capes inside the stage', () => {
  const stage = resolveFormStage('usagi', 2);
  const form = PET_FORMS.usagi;
  const peek = formPeekOffsets(form, stage);
  assert.equal(PET_FORMS.dango.bubblePlacement, 'above');
  assert.equal(form.bubblePlacement, 'side-start');
  assert.deepEqual(formPeekOffsets(PET_FORMS.dango, stage),
    { top: 35, bottom: 35, left: 35, right: 35 });
  const canvasLeft = (stage.frameCssSize - stage.cssWidth) / 2;
  const canvasTop = canvasLeft + 2;
  const scale = stage.cssWidth / stage.artWidth;
  const { x, y, width, height } = form.artBounds;
  const left = canvasLeft + (stage.bodyOrigin.x + x) * scale;
  const top = canvasTop + (stage.bodyOrigin.y + y) * scale;
  const right = canvasLeft + (stage.bodyOrigin.x + x + width) * scale;
  const bottom = canvasTop + (stage.bodyOrigin.y + y + height) * scale;
  assert.ok(peek.top < 35 && peek.bottom < 35);
  assert.ok(peek.top >= 4, 'the top peek needs a visible displacement even with long ears');
  assert.ok(peek.left <= 35 && peek.right <= 35);
  assert.ok(top - peek.top >= 12);
  assert.ok(left - peek.left >= 12);
  assert.ok(stage.frameCssSize - bottom - peek.bottom >= 12);
  assert.ok(stage.frameCssSize - right - peek.right >= 12);
  assert.throws(() => validatePetForms({ dango: PET_FORMS.dango, usagi: {
    ...form, bubblePlacement: 'unknown'
  } }), /bubble placement/);
});

test('independent vector form art units normalize to the stage, with no 33×33 grid dependency', () => {
  const doubleRect = rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * 2]));
  const twiceAsDetailed = {
    ...PET_FORMS.usagi, id: 'detailed', bodySize: 132,
    artBounds: doubleRect(PET_FORMS.usagi.artBounds),
    hitbox: doubleRect(PET_FORMS.usagi.hitbox)
  };
  const forms = { dango: PET_FORMS.dango, detailed: twiceAsDetailed };
  assert.equal(validatePetForms(forms, { pink: { formId: 'dango' }, detailed: { formId: 'detailed' } }, [] ).forms, 2);
  assert.deepEqual(formHitRect(twiceAsDetailed, resolvePetStage({ devicePixelRatio: 2 })),
    formHitRect(PET_FORMS.usagi, resolvePetStage({ devicePixelRatio: 2 })));
  assert.deepEqual(visualSizeForForm(twiceAsDetailed), visualSizeForForm(PET_FORMS.usagi));
  assert.throws(() => validatePetForms(forms, { bad: { formId: 'missing' } }, []), /unknown pet form/);
  assert.throws(() => validatePetForms({ dango: PET_FORMS.dango, detailed: { ...twiceAsDetailed,
    artBounds: { ...twiceAsDetailed.artBounds, x: -200, width: 362 }
  } }, { pink: { formId: 'dango' } }, []), /safe area/);
  assert.throws(() => validatePetForms(forms, { pink: { formId: 'dango' } }, [
    { id: 'foreign', formId: 'detailed', exclusiveGroup: 'headwear' }
  ]), /unsupported slot/);
});

test('both companion artists rasterize at actual display DPR rather than quantizing to a coarse grid', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const skin of ['pink', 'usagi']) {
    const stage = resolveFormStage(skin, dpr);
    assert.equal(stage.cssWidth, 219);
    assert.equal(stage.rasterWidth, Math.round(stage.cssWidth * dpr));
    assert.equal(stage.rasterWidth, stage.artWidth * stage.deviceScale);
  }
  for (const skin of ['pink', 'usagi']) {
    const preview = resolveFormStage(skin, 1, { cssPerArtPixel: 1.5, bleed: 12 });
    assert.equal(preview.cssWidth, 135);
    assert.equal(preview.rasterWidth, 135);
    assert.equal(preview.deviceScale, 1.5);
  }
});
