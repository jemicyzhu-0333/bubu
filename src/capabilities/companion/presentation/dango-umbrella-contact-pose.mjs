'use strict';

// PET_VISUAL「配饰分层与五条不变式」: the existing umbrella pixels are
// partitioned into complementary depth layers. The source-observed short wrist
// and palm stay continuous; no generic forearm, body mask or prop shift is used.
const UMBRELLA_CONTACT_ID = 'umbrella-front-v1';
const UMBRELLA_CONTACT_KEYS = Object.freeze({
  back: 'umbrella-front-v1-back', front: 'umbrella-front-v1-front', right: 'umbrella-front-v1-right'
});
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const BODY_RECT = Object.freeze([-1.789744, 8.533333, 69.415385, 49.066667]);
const PROP_HASH = '7f9d08df9039c22e676259682855e8635639a8192af3e917847bf60aa32b350a';
const SOURCE_HASHES = Object.freeze({
  back: 'b34bcd4b3e3425e5bfc971cdef78f62d43aedafdcd3de218298b511b5b75175c',
  front: 'b1cd9b03b483c01694ae4508ef05893132aac789bb12c4b69fd1800ebf0a9eb2',
  right: '0d5edeac3eb9c6013792288e38325e0d88a68fb66679511b147ae668520906e9'
});
const SAME = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const UNIT = value => Number.isFinite(value) && value >= 0 && value <= 1;
const umbrellaContactSpriteKeys = () => Object.values(UMBRELLA_CONTACT_KEYS);

function umbrellaSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const action = options.action;
  if (action?.id !== 'umbrella-dance' || action.motion !== 'umbrella' || action.prop !== 'umbrella'
    || view !== 'front' || options.state === 'dragged' || options.transform || options.matrix
    || !UNIT(action.propOpacity ?? 1)) return false;
  const body = manifest.views?.front?.body;
  if (body?.src !== 'views/front/body.png' || !SAME(body.rect, BODY_RECT)) return false;
  const tools = (pose.contact?.tools || []).filter(t => !t.contextAccessory), item = tools.find(t => t.key === 'umbrella');
  if (tools.length !== 1 || !item || item.x !== 37 || item.y !== -11 || item.layer !== 'back'
    || manifest.tools?.umbrella?.src !== 'tools/umbrella.png'
    || !SAME(manifest.tools?.umbrella?.rect, [0, 0, 50, 66])
    || !SAME(manifest.tools?.umbrella?.anchors?.right, [24.875, 46.75])
    || (item.scale ?? 1) !== 1 || (item.rotate ?? 0) !== 0 || item.flip || item.pivot || item.matrix
    || item.coversPaw || !UNIT(item.opacity ?? 1)) return false;
  const hands = pose.contact?.hands || [];
  if (hands.length !== 1 || hands[0].side !== 'right' || hands[0].layer !== 'front'
    || !SAME(hands[0].gripPoint || hands[0].points?.at(-1), [61.875, 35.75])) return false;
  return ['back', 'front', 'right'].every(part => {
    const sprite = manifest.tools?.[UMBRELLA_CONTACT_KEYS[part]], c = sprite?.sourceContactPose, hand = part === 'right';
    return sprite?.src === `action-contact/umbrella-front-v1/${hand ? 'right-8x' : `umbrella-${part}`}.png`
      && SAME(sprite.rect, hand ? [0, 0, 72, 72] : [0, 0, 50, 66])
      && (hand ? sprite.tint === 'body' : sprite.tint === undefined)
      && c?.id === UMBRELLA_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
      && c.action === 'umbrella-dance' && c.view === 'front' && c.part === part
      && c.bodySha256 === BODY_HASH && SAME(c.bodyRect, BODY_RECT) && c.propSha256 === PROP_HASH
      && c.sourceSha256 === SOURCE_HASHES[part]
      && SAME(c.contact, [61.875, 35.75]) && SAME(c.shaftAxis, [0, 1])
      && c.translationOnly === true && c.quantizedOnce === true;
  });
}

function applyUmbrellaSourceContactPose(manifest, pose, options = {}) {
  const umbrella = pose.contact.tools.find(t => t.key === 'umbrella');
  const tools = pose.contact.tools.flatMap(item => item !== umbrella ? [item] : [
    { ...item, key: UMBRELLA_CONTACT_KEYS.back, layer: 'back' },
    { ...item, key: UMBRELLA_CONTACT_KEYS.front, layer: 'front' }
  ]);
  return { ...pose, sourceContactPose: UMBRELLA_CONTACT_ID, contact: { ...pose.contact, tools,
    hands: pose.contact.hands.map(hand => ({ ...hand,
      opacity: (hand.opacity ?? 1) * (options.action?.propOpacity ?? 1),
      pawSprite: UMBRELLA_CONTACT_KEYS.right, pawMatrix: [1, 0, 0, 1, 0, 0],
      legacyGripPoint: hand.gripPoint || hand.points?.at(-1), gripPoint: [61.875, 35.75],
      sourceContact: { kind: 'source-shaft-grip', sourcePoseId: UMBRELLA_CONTACT_ID,
        target: [61.875, 35.75], shaftAxis: [0, 1], visibleRoot: [55.68, 35.75] },
      connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground'
    })) } };
}

export { UMBRELLA_CONTACT_ID, UMBRELLA_CONTACT_KEYS, umbrellaContactSpriteKeys,
  umbrellaSourceContactPoseEligible, applyUmbrellaSourceContactPose };
