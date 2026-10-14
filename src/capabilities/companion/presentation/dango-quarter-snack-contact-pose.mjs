'use strict';

// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: a source-authored fore/palm
// replaces only the quarter near resting hand. The eating hand and props stay
// in their original action path. The open cut is not a skeletal shoulder.
const QUARTER_SNACK_CONTACT_ID = 'snack-quarter-near-v1';
const QUARTER_SNACK_CONTACT_KEY = 'snack-quarter-near-v1-left';
const BODY_HASH = '8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450';
const BODY_RECT = Object.freeze([-2.117949, 8.533333, 70.4, 49.066667]);
const SOURCE_HASH = '24aa77f75bb2c9d1e615dc971c96094cef4e958d0df8df5bdc8becbd878e683f';
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const quarterSnackContactSpriteKeys = () => [QUARTER_SNACK_CONTACT_KEY];

function quarterSnackSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const action = options.action;
  if (action?.id !== 'snack-picnic' || action.motion !== 'picnic' || action.prop !== 'picnic'
    || view !== 'three-quarter' || options.state === 'dragged' || options.transform || options.matrix) return false;
  const body = manifest.views?.['three-quarter']?.body;
  if (body?.src !== 'views/three-quarter-right/body.png' || !same(body.rect, BODY_RECT)) return false;
  const hands = pose.contact?.hands || [], hand = hands.find(h => h.side === 'left');
  if (hands.length !== 2 || hands.filter(h => h.side === 'left').length !== 1
    || hands.filter(h => h.side === 'right').length !== 1 || !same(hand?.points?.at(-1), [23, 54])
    || hand.integrated || hand.layer !== 'front') return false;
  const sprite = manifest.tools?.[QUARTER_SNACK_CONTACT_KEY], c = sprite?.sourceContactPose;
  return sprite?.src === 'action-contact/snack-quarter-near-v1/near-8x.png'
    && sprite.tint === 'body' && same(sprite.rect, [0, 0, 66, 72])
    && c?.id === QUARTER_SNACK_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
    && c.action === 'snack-picnic' && c.view === 'three-quarter' && c.side === 'left' && c.layer === 'front'
    && c.bodySha256 === BODY_HASH && same(c.bodyRect, BODY_RECT) && c.sourceSha256 === SOURCE_HASH
    && same(c.palmCenter, [23, 54]) && c.role === 'free-rest' && c.translationOnly === true
    && c.quantizedOnce === true && c.samplesPerArtUnit === 1;
}

function applyQuarterSnackSourceContactPose(manifest, pose) {
  return { ...pose, sourceContactPose: QUARTER_SNACK_CONTACT_ID, contact: { ...pose.contact,
    hands: pose.contact.hands.map(hand => hand.side !== 'left' ? hand : { ...hand,
      pawSprite: QUARTER_SNACK_CONTACT_KEY, pawMatrix: [1, 0, 0, 1, 0, 0],
      sourceContact: { kind: 'continuous-rest', sourcePoseId: QUARTER_SNACK_CONTACT_ID, palmCenter: [23, 54] },
      connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' }) } };
}

export { QUARTER_SNACK_CONTACT_ID, QUARTER_SNACK_CONTACT_KEY, quarterSnackContactSpriteKeys,
  quarterSnackSourceContactPoseEligible, applyQuarterSnackSourceContactPose };
