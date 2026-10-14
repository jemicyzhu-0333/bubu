'use strict';

import { smooth } from './motion-core/easing.mjs';

// PET_RIG「并发配件的姿势隔离」: the reviewed short foreground pair
// follows the actual cup. Its visible source cut is not an anatomical shoulder.
const SIP_SHORT_CONTACT_ID = 'sip-front-short-v1';
const SIP_SHORT_CONTACT_KEYS = Object.freeze({
  left: 'sip-front-short-v1-left', right: 'sip-front-short-v1-right'
});
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const BODY_RECT = Object.freeze([-1.789744, 8.533333, 69.415385, 49.066667]);
const SOURCE_HASHES = Object.freeze({
  left: '9e66aeb66814f3e6384217ddce99a445dfd4b1edbebeb1bf8b76847bee390fcd',
  right: '017c8747173f71ef4c9b3ec8b79b8c0b397733fdb68cc4d4eca37ef662f32515'
});
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const sipShortContactSpriteKeys = () => Object.values(SIP_SHORT_CONTACT_KEYS);

function sipShortSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const action = options.action, recovery = action?.handoffRecovery;
  if (action?.id !== 'sip-tea' || action.motion !== 'sip' || action.prop !== 'cup'
    || view !== 'front' || options.state === 'dragged'
    || options.transform || options.matrix) return false;
  // Explicit numeric recovery owns its original cup and hand fades. Ordinary
  // sip cannot opt into unrelated partial prop visibility or a wider cup range.
  if (recovery !== undefined ? !unit(recovery) || !unit(action.propOpacity)
    : (action.propOpacity ?? 1) !== 1) return false;
  const body = manifest.views?.front?.body;
  if (body?.src !== 'views/front/body.png' || !same(body.rect, BODY_RECT)) return false;
  // Worn accessories do not change the hands: the source pair is a posed paw
  // pair (pawSprite) and so takes the same garment paw pass as legacy paws
  // (accessory-resolver pawPass / pawsAboveCloth). Context accessories ride
  // along as extra tools; only the cup is the sip contact.
  const tools = (pose.contact?.tools || []).filter(t => !t.contextAccessory), cup = tools.find(t => t.key === 'cup');
  const ordinaryY = cup?.y - (recovery === undefined ? 0 : 5 * smooth(recovery / .6));
  if (tools.length !== 1 || !cup || ![cup.x, cup.y].every(Number.isFinite)
    || cup.x < 23 - 1e-8 || cup.x > 24.421795 + 1e-8
    || ordinaryY < 36.028846 - 1e-8 || ordinaryY > 43 + 1e-8
    || !same(manifest.tools?.cup?.rect, [0, 0, 22, 19])
    || (cup.scale ?? 1) !== 1 || (cup.rotate ?? 0) !== 0 || cup.flip || cup.pivot || cup.matrix
    || cup.coversPaw || (cup.opacity ?? 1) !== 1) return false;
  const hands = pose.contact?.hands || [];
  if (hands.length !== 2 || !['left', 'right'].every(side => hands.filter(h => h.side === side).length === 1)) return false;
  return ['left', 'right'].every(side => {
    const sprite = manifest.tools?.[SIP_SHORT_CONTACT_KEYS[side]], c = sprite?.sourceContactPose, left = side === 'left';
    return sprite?.src === `action-contact/sip-front-v1/${side}-8x.png`
      && sprite.tint === 'body' && same(sprite.rect, [0, 0, 66, 72])
      && c?.id === SIP_SHORT_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
      && c.action === 'sip-tea' && c.view === 'front' && c.side === side && c.layer === 'front'
      && c.bodySha256 === BODY_HASH && same(c.bodyRect, BODY_RECT) && c.sourceSha256 === SOURCE_HASHES[side]
      && same(c.boundary, [left ? 24.25 : 40.25, 53.375]) && same(c.normal, [left ? 1 : -1, 0])
      && c.cup?.x === 23 && c.cup.y === 43 && c.cup.width === 22 && c.cup.height === 19
      && c.translationOnly === true && c.quantizedOnce === true;
  });
}

function sipShortSourceOpacity(options = {}) {
  if (options.action?.handoffRecovery !== undefined) return 1;
  const p = options.calmVisual || options.reducedMotion ? options.action?.staticProgress ?? .5 : options.progress ?? 0;
  return smooth(p / .04) * smooth((1 - p) / .04);
}

function applySipShortSourceContactPose(manifest, pose, options = {}) {
  const cup = pose.contact.tools.find(t => t.key === 'cup'), delta = [cup.x - 23, cup.y - 43];
  const opacity = sipShortSourceOpacity(options);
  const fade = item => ({ ...item, opacity: (item.opacity ?? 1) * opacity });
  return { ...pose, sourceContactPose: SIP_SHORT_CONTACT_ID, contact: { ...pose.contact,
    tools: opacity === 1 ? pose.contact.tools : pose.contact.tools.map(fade),
    details: opacity === 1 ? pose.contact.details : pose.contact.details?.map(fade),
    hands: pose.contact.hands.map(hand => {
      const key = SIP_SHORT_CONTACT_KEYS[hand.side], c = manifest.tools[key].sourceContactPose;
      const target = c.boundary.map((n, i) => n + delta[i]);
      return { ...hand, ...(opacity === 1 ? {} : { opacity: (hand.opacity ?? 1) * opacity }),
        pawSprite: key, pawMatrix: [1, 0, 0, 1, ...delta],
        legacyGripPoint: hand.gripPoint || hand.points?.at(-1), gripPoint: target,
        sourceContact: { kind: 'continuous-hold', target, boundaryNormal: [...c.normal],
          sourcePoseId: SIP_SHORT_CONTACT_ID, legacyHandleAxisSatisfied: hand.side === 'right' ? false : null },
        connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' };
    }) } };
}

export { SIP_SHORT_CONTACT_ID, SIP_SHORT_CONTACT_KEYS, sipShortContactSpriteKeys,
  sipShortSourceContactPoseEligible, sipShortSourceOpacity, applySipShortSourceContactPose };
