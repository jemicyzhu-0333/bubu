'use strict';

import { applyPoint } from './rig/pose.mjs';

// The generated reverse-view prop is an actual exterior lid, not a mirrored
// screen. The browse story and AI mirror reuse it; semantic prop/input IDs stay intact.
function refineBrowseContact(contact, action, view, toolSprites, anchoredPawMatrix) {
  const story = action?.id === 'focus-browse' && ['laptop', 'notes'].includes(action.prop);
  const mirror = action?.id === 'mirror-ai' && action.prop === 'ai-chat';
  if (!contact || (!story && !mirror)) return contact;
  const fin = toolSprites?.['small-fin'];
  if (!fin) return contact;
  const laptop = contact.tools.find(tool => tool.key === 'laptop');
  const angled = view === 'three-quarter' || view === 'profile';
  if (laptop && view !== 'back') {
    laptop.key = `laptop-reverse-${angled ? 'three-quarter' : 'front'}`;
    laptop.x = angled ? 27 : 12; laptop.y = angled ? 40 : 42;
    // The old scroll symbol was painted on the viewer-facing screen. The
    // screen is now hidden on Dango's side and must not shine through the lid.
    contact.details = contact.details.filter(detail => detail.type !== 'scroll');
  }
  const sprite = laptop && toolSprites[laptop.key];
  for (const hand of contact.hands) {
    let target = hand.points.at(-1), rotation = hand.side === 'left' ? .45 : -.08;
    if (laptop && sprite) {
      const grip = sprite.anchors[hand.side];
      target = [laptop.x + grip[0], laptop.y + grip[1]];
      rotation = angled ? (hand.side === 'left' ? .4 : -.4) : (hand.side === 'left' ? .65 : -.65);
      hand.pawOcclusion = angled ? 'behind-lid' : 'behind-tool';
    }
    hand.pawSprite = 'small-fin'; hand.connector = false; hand.attachedArm = false; hand.integrated = false;
    hand.gripPoint = target;
    // Follow the existing story's tool hand-off fade, so a hidden grip never
    // jumps visibly between laptop and note coordinates.
    hand.opacity = (hand.opacity ?? 1) * (action.propOpacity ?? 1);
    hand.pawMatrix = anchoredPawMatrix(fin.anchors.grip, target,
      { rotation, flip: hand.side === 'right' });
    const root = applyPoint(hand.pawMatrix, ...fin.anchors.root);
    hand.points = [root, root, target];
  }
  return contact;
}

// The saved angled prop contains a visible keyboard wedge on the pet side.
// Re-composite only its original exterior lid over the fins: keyboard -> paws
// -> lid. These are measured source-pixel boundaries, never a fabricated side.
function paintBrowseLid(context, artwork, palette, { manifest, painter, toolMatrix }, action) {
  if (!artwork?.actionReady) return false;
  const item = artwork.contact?.tools.find(tool => tool.key === 'laptop-reverse-three-quarter');
  if (!item) return false;
  const sprite = manifest.tools[item.key], scale = sprite.rect[2] / 439;
  const polygon = [[180, 0], [439, 0], [439, 245], [118, 245],
    [118, 180], [130, 130], [143, 84], [154, 45], [180, 15]];
  context.save(); context.transform(...toolMatrix(item, sprite));
  context.beginPath(); context.moveTo(polygon[0][0] * scale, polygon[0][1] * scale);
  for (const [x, y] of polygon.slice(1)) context.lineTo(x * scale, y * scale);
  context.closePath(); context.clip();
  const painted = painter.paint(context, sprite, palette, null,
    (item.opacity ?? 1) * (item.persistent ? 1 : action?.propOpacity ?? 1));
  context.restore(); return painted;
}

export { refineBrowseContact, paintBrowseLid };
