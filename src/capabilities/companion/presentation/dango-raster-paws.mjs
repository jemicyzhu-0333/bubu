'use strict';

// Reconstructed from the recorded final repair after the executor reset.
// Artwork PNGs are byte-exact; this module requires fresh validation.
import { applyPoint, localMatrix, multiply } from './rig/pose.mjs';
import { refineBrowseContact } from './dango-raster-browse.mjs';

const translation = (x, y) => [1, 0, 0, 1, x, y];
function propMatrix(item, sprite) {
  let matrix = translation(item.x, item.y);
  if (item.scale) matrix = multiply(matrix, [item.scale, 0, 0, item.scale, 0, 0]);
  if (item.pivot) matrix = multiply(matrix, localMatrix(item.pivot, { r: item.rotate || 0 }));
  if (item.flip) matrix = multiply(matrix, [-1, 0, 0, 1, sprite.width, 0]);
  return matrix;
}

function anchoredPawMatrix(anchor, target, { scale = 1, rotation = 0, flip = false } = {}) {
  const c = Math.cos(rotation) * scale, s = Math.sin(rotation) * scale, sign = flip ? -1 : 1;
  const matrix = [c * sign, s * sign, -s, c, 0, 0];
  matrix[4] = target[0] - matrix[0] * anchor[0] - matrix[2] * anchor[1];
  matrix[5] = target[1] - matrix[1] * anchor[0] - matrix[3] * anchor[1];
  return Object.freeze(matrix);
}

function refineSmallPawContact(contact, action, view, toolSprites, groundShift = 0) {
  if (action?.id === 'focus-browse' || action?.id === 'mirror-ai') {
    return refineBrowseContact(contact, action, view, toolSprites, anchoredPawMatrix);
  }
  if (!contact || !['hiccup', 'carry-energy', 'workout'].includes(action?.id)) return contact;
  if (action.id === 'workout') {
    const source = toolSprites?.['support-paw'], sole = source?.anchors?.sole || [6, 10.415094339622641];
    for (const hand of contact.hands) {
      const right = hand.side === 'right', angled = view !== 'front';
      const target = [angled ? right ? 55.5 : 31 : right ? 44 : 22, 64 - groundShift];
      const scale = angled && right ? .9 : 1;
      hand.pawSprite = 'support-paw'; hand.connector = false; hand.attachedArm = false; hand.integrated = false;
      hand.pawMatrix = anchoredPawMatrix(sole, target, { scale });
      hand.points = [hand.points[0], hand.points[0], target];
    }
    return contact;
  }
  const key = action.id === 'hiccup' ? 'cup' : 'energy';
  const item = contact.tools.find(tool => tool.key === key), sprite = toolSprites?.[key];
  if (!item || !sprite) return contact;
  if (key === 'cup') { item.x -= 1; item.y -= 5; contact.details = contact.details.filter(detail => detail.type !== 'steam'); }
  else { item.scale = .84; item.x += 2; item.y += .5; }
  const matrix = propMatrix(item, sprite), fin = toolSprites?.['small-fin'];
  for (const hand of contact.hands) {
    const target = applyPoint(matrix, ...sprite.anchors[hand.side]);
    hand.pawSprite = 'small-fin'; hand.connector = false; hand.attachedArm = false; hand.integrated = false;
    hand.gripPoint = target;
    hand.pawMatrix = anchoredPawMatrix(fin?.anchors?.grip || [7.4, 3.6], target,
      { rotation: hand.side === 'left' ? .15 : -.15, flip: hand.side === 'right' });
    hand.points = [hand.points[0], hand.points[0], target];
  }
  return contact;
}

function paintRasterPaws(context, artwork, palette, { manifest, painter }, layer = 'front') {
  if (!artwork?.layeredReady || !artwork.actionReady) return false;
  let painted = false;
  for (const hand of artwork.contact?.hands || []) {
    if (!hand.pawSprite) continue;
    if (layer !== 'underlay' && (hand.pawOcclusion === 'behind-tool' ? layer !== 'before-tools' : layer !== 'front')) continue;
    const wrapped = hand.pawSprite === 'small-fin' && artwork.pawRootsCovered;
    if (layer === 'underlay' && !wrapped) continue;
    const sprite = manifest.tools?.[hand.pawSprite];
    if (!sprite) continue;
    context.save(); context.transform(...hand.pawMatrix);
    if (layer !== 'underlay' && wrapped) { context.beginPath(); context.rect(3.8, -32, 64, 96); context.clip(); }
    painted = painter.paint(context, sprite, palette, null, hand.opacity ?? 1) || painted;
    context.restore();
  }
  return painted;
}

export { anchoredPawMatrix, refineSmallPawContact, paintRasterPaws };
