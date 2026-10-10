'use strict';
import { samplePaperReturn } from './paper-return-story.mjs';
import { anchoredPawMatrix } from './dango-raster-paws.mjs';
function refinePaperReturn(contact, action, progress, toolSprites) {
  if (action?.id !== 'paper-return' || !contact) return contact;
  const story = samplePaperReturn(progress, false, action.paperReturnExit);
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

// Only the tea instance reached through this story's handoff owns this recovery.
function refineHandoffCup(contact, action, data) {
  const t = action?.id === 'sip-tea' ? action.handoffRecovery || 0 : 0;
  if (!contact || !t) return contact;
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const drop = 5 * ease(t / .6), release = ease((t - .7) / .3);
  for (const tool of contact.tools) if (tool.key === 'cup') tool.y += drop;
  for (const detail of contact.details) if (detail.type === 'steam') {
    detail.at = [detail.at[0], detail.at[1] + drop]; detail.opacity = action.propOpacity ?? 1;
  }
  for (const hand of contact.hands) {
    const sprite = data.parts[`hand-${hand.side}`], rest = sprite.pivot;
    const target = hand.points.at(-1), shifted = [target[0], target[1] + drop];
    const home = rest || [sprite.rect[0] + sprite.rect[2] / 2, sprite.rect[1] + sprite.rect[3] / 2];
    const point = shifted.map((n, i) => n + (home[i] - n) * release);
    const elbow = hand.points[1].map((n, i) => { const shifted = n + (i ? drop : 0); return shifted + (home[i] - shifted) * release; });
    hand.points = [hand.points[0], elbow, point];
    hand.opacity = (hand.opacity ?? 1) * (1 - release);
    hand.rotation = 0;
  }
  return contact;
}
export { refineHandoffCup };
