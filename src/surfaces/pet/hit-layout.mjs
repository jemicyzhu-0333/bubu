'use strict';

import { forms } from '../../capabilities/companion/index.mjs';
import { SKINS } from '../../skins.mjs';

// A surface adapter for the form's *declared* hit geometry. The companion
// registry owns dimensions; this adapter only writes CSS onto existing DOM.
function createPetHitLayout({ hit, canvas, root, getStage } = {}) {
  if (!hit?.style || typeof hit.setAttribute !== 'function'
    || !canvas?.style || !root?.dataset || !root?.style || typeof getStage !== 'function') {
    throw new TypeError('pet hit layout requires hit, canvas, root and getStage');
  }

  function update(skinId) {
    const form = forms.resolvePetForm(skinId);
    const rectangle = forms.formHitRect(form, getStage());
    hit.style.left = `${rectangle.left}px`;
    hit.style.top = `${rectangle.top}px`;
    hit.style.width = `${rectangle.width}px`;
    hit.style.height = `${rectangle.height}px`;
    canvas.style.imageRendering = 'auto';
    root.dataset.petForm = form.id;
    root.dataset.petBubble = form.bubblePlacement;
    for (const [edge, distance] of Object.entries(forms.formPeekOffsets(form, getStage()))) {
      const property = `--pet-peek-${edge}`;
      if (typeof root.style.setProperty === 'function') root.style.setProperty(property, `${distance}px`);
      else root.style[property] = `${distance}px`;
    }
    const name = SKINS[skinId]?.name || SKINS.pink.name;
    hit.setAttribute('aria-label', `小步 ${name}：点按与按住都是互动，右键打开命令菜单`);
    return rectangle;
  }

  return Object.freeze({ update });
}

export { createPetHitLayout };
