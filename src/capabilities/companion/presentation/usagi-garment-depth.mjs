'use strict';

// PET_RIG「渲染顺序」: a near paw can overlap cloth; a far paw does not
// become a foreground sticker merely because it belongs to a moving bone.
// Only garments with an authored wrap contract opt into this projection.
function usagiPartLayer(part, artwork) {
  if (!artwork?.wardrobe?.wrapsBody || !part?.bone?.startsWith('hand_')) return part?.layer;
  const view = artwork.drawnView || artwork.view;
  if (view === 'back') return 'back';
  if (view === 'three-quarter' && part.bone === 'hand_l') return 'back';
  return part.layer;
}

export { usagiPartLayer };
