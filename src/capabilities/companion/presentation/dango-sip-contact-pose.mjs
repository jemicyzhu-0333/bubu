'use strict';

// PET_RIG「并发配件的姿势隔离」: one authored fore+palm pose follows the
// existing cup translation. Neither the body nor the generic shoulder rig moves.
const SIP_CONTACT_ID = 'sip-front-v2';
const SIP_CONTACT_KEYS = Object.freeze({
  left: Object.freeze({ back: 'sip-front-v2-left-root-back', front: 'sip-front-v2-left-fore-palm-front' }),
  right: Object.freeze({ back: 'sip-front-v2-right-root-back', front: 'sip-front-v2-right-fore-palm-front' })
});
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const sipContactSpriteKeys = () => Object.values(SIP_CONTACT_KEYS).flatMap(keys => [keys.back, keys.front]);

function sipSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const action = options.action;
  if (action?.id !== 'sip-tea' || action.motion !== 'sip' || action.prop !== 'cup'
    || view !== 'front' || (options.appearance?.items || []).length || options.state === 'dragged'
    || options.transform || options.matrix || action.handoffRecovery || (action.propOpacity ?? 1) !== 1) return false;
  const body = manifest.views?.front?.body;
  if (body?.src !== 'views/front/body.png' || !same(body.rect, [-1.789744, 8.533333, 69.415385, 49.066667])) return false;
  const tools = pose.contact?.tools || [], cup = tools.find(t => t.key === 'cup');
  if (tools.length !== 1 || !cup || !pair([cup.x, cup.y])
    || cup.x < 23 - 1e-8 || cup.x > 24.421795 + 1e-8 || cup.y < 36.028846 - 1e-8 || cup.y > 43 + 1e-8
    || !same(manifest.tools?.cup?.rect, [0, 0, 22, 19])
    || (cup.scale ?? 1) !== 1 || (cup.rotate ?? 0) !== 0 || cup.flip || cup.pivot || cup.matrix
    || cup.coversPaw || (cup.opacity ?? 1) !== 1) return false;
  const hands = pose.contact?.hands || [];
  if (hands.length !== 2 || !['left', 'right'].every(side => hands.filter(h => h.side === side).length === 1)) return false;
  return ['left', 'right'].every(side => ['back', 'front'].every(layer => {
    const sprite = manifest.tools?.[SIP_CONTACT_KEYS[side][layer]], c = sprite?.sourceContactPose, left = side === 'left';
    return sprite?.tint === 'body' && same(sprite.rect, [0, 0, 66, 72])
      && c?.id === SIP_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
      && c.action === 'sip-tea' && c.view === 'front' && c.side === side && c.layer === layer
      && c.bodySha256 === BODY_HASH && same(c.bodyRegistration?.fixedShoulder, [left ? 4.5 : 58.5, 45.5])
      && same(c.boundary, [left ? 24.25 : 40.25, 53.375]) && same(c.normal, [left ? 1 : -1, 0])
      && c.cup?.x === 23 && c.cup.y === 43 && c.cup.width === 22 && c.cup.height === 19
      && c.translationOnly === true && c.quantizedOnce === true && c.depthSourceY === 260;
  }));
}

function applySipSourceContactPose(manifest, pose) {
  const cup = pose.contact.tools.find(t => t.key === 'cup'), delta = [cup.x - 23, cup.y - 43];
  const roots = ['left', 'right'].map(side => ({ key: SIP_CONTACT_KEYS[side].back,
    x: delta[0], y: delta[1], layer: 'back', bodyColor: true, persistent: true,
    sourceContactLayer: SIP_CONTACT_ID, opacity: pose.contact.hands.find(h => h.side === side).opacity ?? 1 }));
  return { ...pose, sourceContactPose: SIP_CONTACT_ID, contact: { ...pose.contact,
    tools: [...pose.contact.tools, ...roots], hands: pose.contact.hands.map(hand => {
      const key = SIP_CONTACT_KEYS[hand.side].front, c = manifest.tools[key].sourceContactPose;
      const target = c.boundary.map((n, i) => n + delta[i]);
      return { ...hand, pawSprite: key, pawMatrix: [1, 0, 0, 1, ...delta],
        legacyGripPoint: hand.gripPoint || hand.points?.at(-1), gripPoint: target,
        sourceContact: { kind: 'continuous-hold', target, boundaryNormal: [...c.normal],
          sourcePoseId: SIP_CONTACT_ID, legacyHandleAxisSatisfied: hand.side === 'right' ? false : null },
        connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' };
    }) } };
}

export { SIP_CONTACT_ID, SIP_CONTACT_KEYS, sipContactSpriteKeys, sipSourceContactPoseEligible, applySipSourceContactPose };
