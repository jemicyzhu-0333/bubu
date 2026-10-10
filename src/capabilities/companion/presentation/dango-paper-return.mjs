'use strict';
import { samplePaperReturn } from './paper-return-story.mjs';
import { anchoredPawMatrix } from './dango-raster-paws.mjs';
function refinePaperReturn(contact, action, progress, toolSprites) {
  if (action?.id !== 'paper-return' || !contact) return contact;
  const story = samplePaperReturn(progress);
  const plane = toolSprites['paper-plane'], fin = toolSprites['small-fin'];
  const anchor = plane?.anchors?.right || [6.625, 9.25];
  const hand = contact.hands.find(value => value.side === 'right');
  contact.tools = [{ key: 'paper-plane', x: story.grip[0] - anchor[0], y: story.grip[1] - anchor[1],
    pivot: anchor, rotate: story.angle, opacity: story.opacity }];
  contact.details = [];
  if (hand) {
    hand.points = [hand.points[0], hand.points[0], story.hand];
    hand.pawSprite = 'small-fin'; hand.connector = false; hand.integrated = false;
    // This outward reach uses the fin's native root-left/grip-right direction.
    // Mirroring a cross-body holding fin would put its root beyond the hand.
    hand.pawMatrix = anchoredPawMatrix(fin?.anchors?.grip || [7.4, 3.6], story.hand);
    hand.opacity = Math.min(1, story.opacity * 2);
    hand.gripPoint = story.hand;
    contact.hands = [hand];
  }
  return contact;
}
export { refinePaperReturn };
