'use strict';
// Compatibility view of the unified limb module (usagi-limbs.mjs). There is
// no separate contact painter any more: the grip intent table in
// content/companion/usagi-limbs.mjs replaces the old motion/prop predicates.
import { intentFor, limbGeometry, paintLimbPart } from './usagi-limbs.mjs';

const fakeArtwork = sample => ({ drawnView: 'front', pose: { sample, world: null },
  rig: { views: { front: { anchors: { 'usagi.umbrella-grip': true } } } } });

// Expanded (table / tool) grip family, from data.
function expandedContactPaw(sample, side, artwork) {
  const intent = intentFor(artwork?.pose?.world ? artwork : fakeArtwork(sample), side,
    artwork?.rig?.views?.[artwork?.drawnView] || fakeArtwork(sample).rig.views.front);
  return Boolean(intent?.kind === 'grip' && intent.expanded);
}
function integratedUsagiPaw(artwork, side) {
  return intentFor(artwork, side)?.kind === 'grip';
}
function contactPawGeometry(artwork, data, side) { return limbGeometry(artwork, data, side); }
const paintUsagiContactPart = paintLimbPart;
export { expandedContactPaw, integratedUsagiPaw, contactPawGeometry, paintUsagiContactPart };
