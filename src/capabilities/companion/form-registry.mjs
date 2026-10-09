'use strict';

import { PET_ART, PET_ART_BLEED, PET_CSS_PER_ART_PIXEL, PET_VISUAL_CENTER_OFFSET,
  resolvePetStage } from '../../core/pet-stage.mjs';
import { SKINS } from '../../skins.mjs';
import { PET_APPEARANCE_ITEMS } from '../../content/appearance.mjs';
import { DANGO_FORM } from '../../content/companion/dango-form.mjs';
import { USAGI_FORM } from '../../content/companion/usagi-form.mjs';

const DEFAULT_FORM_ID = 'dango';
const VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);
const PET_FORMS = Object.freeze({ dango: DANGO_FORM, usagi: USAGI_FORM });

// Form descriptors contain no executable art, global state or persisted fields.
// Both windows resolve this exact frozen record; a new pet supplies a descriptor
// and its own painter instead of changing the existing body/face coordinate table.
function formScale(form, bodySize = PET_ART.bodySize) {
  if (!form || !Number.isFinite(form.bodySize) || form.bodySize <= 0
    || !Number.isFinite(bodySize) || bodySize <= 0) throw new TypeError('valid form and body size are required');
  return bodySize / form.bodySize;
}

function validatePetForms(forms = PET_FORMS, skins = SKINS, items = PET_APPEARANCE_ITEMS) {
  const ids = Object.keys(forms);
  if (!ids.length || !forms[DEFAULT_FORM_ID]) throw new TypeError('a default pet form is required');
  for (const [id, form] of Object.entries(forms)) {
    if (!form || form.id !== id || !['pixel', 'vector', 'raster'].includes(form.renderer)) {
      throw new TypeError(`invalid pet form: ${id}`);
    }
    if (!Number.isInteger(form.bodySize) || form.bodySize < 16 || form.bodySize > 512
      || !Number.isInteger(form.bleed)
      || form.bleed < 0 || form.bleed > PET_ART_BLEED) {
      throw new RangeError(`invalid pet stage geometry: ${id}`);
    }
    const scale = formScale(form);
    for (const [name, rect] of Object.entries({ artBounds: form.artBounds, hitbox: form.hitbox })) {
      if (!rect || [rect.x, rect.y, rect.width, rect.height].some(n => !Number.isFinite(n))
        || rect.width <= 0 || rect.height <= 0
        || rect.x * scale < -form.bleed || rect.y * scale < -form.bleed
        || (rect.x + rect.width) * scale > PET_ART.bodySize + form.bleed
        || (rect.y + rect.height) * scale > PET_ART.bodySize + form.bleed) {
        throw new RangeError(`${id}.${name} exceeds the stage safe area`);
      }
    }
    if (!form.faceRig || !form.anatomyRig || !form.appearanceAnchors
      || !Array.isArray(form.supportedSlots) || !form.supportedSlots.length
      || new Set(form.supportedSlots).size !== form.supportedSlots.length
      || !form.slotLabels || form.supportedSlots.some(slot =>
        typeof form.slotLabels[slot] !== 'string' || !form.slotLabels[slot].trim())
      || typeof form.fallbackMotion !== 'string' || !form.fallbackMotion
      || !form.motionMap || typeof form.motionMap !== 'object') {
      throw new TypeError(`incomplete pet form rig: ${id}`);
    }
    if (!['above', 'side-start'].includes(form.bubblePlacement)) {
      throw new TypeError(`pet form ${id} has an unknown bubble placement`);
    }
    if (form.renderer === 'pixel' && VIEWS.some(view => !Array.isArray(form.bodyGridByView?.[view]))) {
      throw new TypeError(`pet form ${id} lacks a body view`);
    }
    if (form.renderer === 'pixel' && form.bodySize !== PET_ART.bodySize) {
      throw new TypeError(`pixel pet form ${id} must match its body grid`);
    }
    if (form.renderer !== 'pixel' && VIEWS.some(view => !form.faceRig[view] || !form.anatomyRig[view])) {
      throw new TypeError(`pet form ${id} lacks an independent view rig`);
    }
    if (form.renderer !== 'pixel' && form.supportedSlots.some(slot => VIEWS.some(view => {
      const anchor = form.appearanceAnchors[slot]?.[view];
      return !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y);
    }))) {
      throw new TypeError(`pet form ${id} lacks an appearance anchor`);
    }
    if (form.renderer !== 'pixel' && (!Array.isArray(form.supportedMotions)
      || !form.supportedMotions.includes(form.fallbackMotion)
      || Object.values(form.motionMap).some(motion => !form.supportedMotions.includes(motion)))) {
      throw new TypeError(`pet form ${id} has an unsupported motion`);
    }
  }
  for (const [skinId, skin] of Object.entries(skins)) {
    if (!forms[skin.formId || DEFAULT_FORM_ID]) throw new TypeError(`skin ${skinId} refers to an unknown pet form`);
  }
  if (!Array.isArray(items)) throw new TypeError('appearance catalog is required');
  for (const item of items) {
    const form = forms[item.formId || DEFAULT_FORM_ID];
    if (!form) throw new TypeError(`appearance ${item.id} refers to an unknown pet form`);
    if (!form.supportedSlots.includes(item.exclusiveGroup)) {
      throw new TypeError(`appearance ${item.id} uses an unsupported slot`);
    }
  }
  return Object.freeze({ forms: ids.length, skins: Object.keys(skins).length });
}

validatePetForms();

function resolvePetForm(skinId) {
  const skin = SKINS[skinId] || SKINS.pink;
  return PET_FORMS[skin.formId || DEFAULT_FORM_ID];
}

function resolveFormStage(skinId, devicePixelRatio = 1, options = {}) {
  const stage = resolvePetStage({ ...options, devicePixelRatio });
  if (resolvePetForm(skinId).renderer === 'pixel') return stage;
  // Vector outlines can use fractional art-to-device scales; they do not have
  // adjacent pixel cells that require an integer multiple. Keep the CSS size
  // but rasterize at the display's full resolution, including 1.5× screens.
  const rasterWidth = Math.round(stage.cssWidth * devicePixelRatio);
  const rasterHeight = Math.round(stage.cssHeight * devicePixelRatio);
  return Object.freeze({ ...stage, deviceScale: rasterWidth / stage.artWidth,
    rasterWidth, rasterHeight });
}

function previewSkinForForm(formId, currentSkin = 'pink') {
  if (resolvePetForm(currentSkin).id === formId) return currentSkin;
  const matching = Object.entries(SKINS).find(([, skin]) => (skin.formId || DEFAULT_FORM_ID) === formId);
  return matching ? matching[0] : 'pink';
}

function resolveFormMotion(form, action) {
  if (!form || !PET_FORMS[form.id]) throw new TypeError('registered pet form is required');
  if (form.renderer === 'pixel') return action?.motion || form.fallbackMotion;
  return form.motionMap[action?.motion] || form.fallbackMotion;
}

function formHitRect(form, stage) {
  if (!form || !stage || !Number.isFinite(stage.cssWidth) || !Number.isFinite(stage.bodySize)) {
    throw new TypeError('form and stage are required');
  }
  const scale = stage.cssWidth / stage.artWidth * formScale(form, stage.bodySize);
  return Object.freeze({
    left: stage.bodyOrigin.x * stage.cssWidth / stage.artWidth + form.hitbox.x * scale,
    top: stage.bodyOrigin.y * stage.cssWidth / stage.artWidth + form.hitbox.y * scale,
    width: form.hitbox.width * scale,
    height: form.hitbox.height * scale
  });
}

// A docked form may peek, but a long ear or back decoration must still have
// room for its own motion inside the transparent 220px window. Preserve the
// original pixel form's 35px movement; vector forms derive all four edges from
// their declared art bounds plus a small animation/stroke margin.
function formPeekOffsets(form, stage) {
  if (!form || !stage || !Number.isFinite(stage.frameCssSize)
    || !Number.isFinite(stage.cssWidth) || !stage.bodyOrigin) {
    throw new TypeError('form and stage frame are required');
  }
  if (form.renderer === 'pixel') return Object.freeze({ top: 35, bottom: 35, left: 35, right: 35 });
  const scale = stage.cssWidth / stage.artWidth * formScale(form, stage.bodySize);
  const frame = stage.frameCssSize;
  const canvasX = (frame - stage.cssWidth) / 2 + PET_VISUAL_CENTER_OFFSET.x;
  const canvasY = (frame - stage.cssHeight) / 2 + PET_VISUAL_CENTER_OFFSET.y;
  const { x, y, width, height } = form.artBounds;
  const left = canvasX + stage.bodyOrigin.x * stage.cssWidth / stage.artWidth + x * scale;
  const top = canvasY + stage.bodyOrigin.y * stage.cssHeight / stage.artHeight + y * scale;
  const right = left + width * scale;
  const bottom = top + height * scale;
  const margin = 12;
  const peek = (room) => Math.min(35, Math.max(0, room - margin));
  return Object.freeze({
    top: peek(top), bottom: peek(frame - bottom),
    left: peek(left), right: peek(frame - right)
  });
}

function visualSizeForForm(form) {
  const scale = PET_CSS_PER_ART_PIXEL * formScale(form);
  const box = form.hitbox;
  return Object.freeze({
    width: box.width * scale,
    height: box.height * scale,
    offsetX: PET_VISUAL_CENTER_OFFSET.x + (box.x + box.width / 2 - form.bodySize / 2) * scale,
    offsetY: PET_VISUAL_CENTER_OFFSET.y + (box.y + box.height / 2 - form.bodySize / 2) * scale
  });
}

function visualSizeForSkin(skinId) { return visualSizeForForm(resolvePetForm(skinId)); }

export {
  DEFAULT_FORM_ID, PET_FORMS, resolvePetForm, resolveFormMotion, formScale,
  previewSkinForForm, resolveFormStage, formHitRect, formPeekOffsets,
  visualSizeForForm, visualSizeForSkin, validatePetForms
};
export default Object.freeze({
  PET_FORMS, resolvePetForm, resolveFormMotion, formScale,
  previewSkinForForm, resolveFormStage, formHitRect, formPeekOffsets,
  visualSizeForForm, visualSizeForSkin, validatePetForms
});
