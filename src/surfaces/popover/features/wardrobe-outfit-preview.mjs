'use strict';

import { t } from '../../shared/interface/i18n.mjs';
import { USAGI_OUTFIT_SETS } from '../../../content/companion/usagi-wardrobe.mjs';

// Passive styling references only. The canonical appearance projection still
// decides ownership, selected slots and worn IDs; this module sends no commands.
function renderWardrobeOutfitPreviews({ container, state, formId, escapeHTML, drawPetPreview }) {
  if (!container) return () => {};
  const options = new Map((state?.appearance?.choices || [])
    .flatMap(choice => choice.options || []).map(option => [option.id, option]));
  const looks = formId === 'usagi'
    ? USAGI_OUTFIT_SETS.filter(look => look.itemIds.every(id => options.has(id))) : [];
  const expanded = Boolean(container.querySelector('details')?.open);
  if (!looks.length) { container.innerHTML = ''; return () => {}; }
  const cards = looks.map(look => {
    const pieces = look.itemIds.map(id => options.get(id));
    const missing = pieces.filter(piece => !piece.available).length;
    const availability = missing ? t('还有 {count} 件待解锁', { count: missing }) : t('配饰已全部解锁');
    const labels = pieces.map(piece => piece.label).join(' · ');
    return '<figure class="wardrobe-look">'
      + `<canvas data-outfit-preview="${escapeHTML(look.id)}" width="135" height="135" aria-hidden="true"></canvas>`
      + `<figcaption>${escapeHTML(look.label)}<small>${escapeHTML(availability)}</small></figcaption>`
      + `<p>${escapeHTML(labels)}</p></figure>`;
  }).join('');
  container.innerHTML = `<details class="wardrobe-lookbook"${expanded ? ' open' : ''}>`
    + `<summary>${escapeHTML(t('搭配参考 · {count} 组', { count: looks.length }))}</summary><div class="wardrobe-look-grid">${cards}</div></details>`;
  for (const look of looks) {
    const canvas = container.querySelector(`[data-outfit-preview="${look.id}"]`);
    if (!canvas) continue;
    drawPetPreview(canvas, { skinId: state.currentSkin, itemIds: [...look.itemIds], size: 'preview' });
    // The existing painter owns the DPR backing store; the card only fits its
    // square CSS presentation to the available drawer width.
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }
  return () => {
    const summary = container.querySelector('summary');
    if (summary) summary.textContent = t('搭配参考 · {count} 组', { count: looks.length });
    const captions = container.querySelectorAll('figcaption small');
    looks.forEach((look, index) => {
      const missing = look.itemIds.filter(id => !options.get(id).available).length;
      if (captions[index]) captions[index].textContent = missing
        ? t('还有 {count} 件待解锁', { count: missing }) : t('配饰已全部解锁');
    });
  };

}

export { renderWardrobeOutfitPreviews };
