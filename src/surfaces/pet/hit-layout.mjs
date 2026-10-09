import { t, onLocaleChanged } from '../shared/interface/i18n.mjs';
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

  let name = SKINS.pink.name;
  const repaintCopy = () => hit.setAttribute('aria-label', t('小步 {name}：点按与按住都是互动，右键打开命令菜单', { name }));
  const stopLocale = onLocaleChanged(repaintCopy);
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
    name = SKINS[skinId]?.name || SKINS.pink.name;
    repaintCopy();
    return rectangle;
  }

  return Object.freeze({ update, dispose: stopLocale });
}

export { createPetHitLayout };
