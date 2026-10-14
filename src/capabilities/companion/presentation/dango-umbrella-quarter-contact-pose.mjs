'use strict';

// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: a genuine quarter far palm
// is partitioned without lost pixels. Its observed heel goes behind the body;
// the front palm grips the unchanged green J handle. No wrist is synthesized.
const UMBRELLA_QUARTER_CONTACT_ID = 'umbrella-quarter-handle-v1';
const UMBRELLA_QUARTER_CONTACT_KEYS = Object.freeze({
  palmBack: 'umbrella-quarter-handle-v1-right-back',
  palmFront: 'umbrella-quarter-handle-v1-right-front',
  propBack: 'umbrella-quarter-handle-v1-umbrella-back',
  propFront: 'umbrella-quarter-handle-v1-umbrella-front'
});
const BODY_RECT = Object.freeze([-2.117949, 8.533333, 70.4, 49.066667]);
const BODY_HASH = '8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450';
const PROP_HASH = '7f9d08df9039c22e676259682855e8635639a8192af3e917847bf60aa32b350a';
const MASTER_HASH = '4be119389cbbb474899cb40353313181f5860f407e1403419fe940a605d46747';
const MASK_HASH = '3b8c2d760e39a1bc8e8684555aceb42be13739a00d1fa8af6097a66c8b20e6d7';
const PALM_HASH = '6f99e1ff4421787a06cbd324b1a28297b1ec814ec720363239c472257aa1b4cd';
const PARTS = Object.freeze({
  palmBack: ['right-back', 'right-back-8x.png', '1c4d279cc2151e0dbd10cb493dd649644b52d8fbce86c9f3eaab57ade371a8aa'],
  palmFront: ['right-front', 'right-front-8x.png', '05a06626ff3447a03b42826c78d1108026aa96cab16a59ada0c19998bc542093'],
  propBack: ['umbrella-back', 'umbrella-back.png', 'f46df007e4f6dfe1d85448b30685277f886360d19873c778659f2cb3c5ee43b1'],
  propFront: ['umbrella-front', 'umbrella-front.png', 'f31f8b4d4d83038314602ddc25cc7c5deb7b92f5b32018fd20b64e40dff0501e']
});
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const near = (a, b) => Array.isArray(a) && a.length === b.length
  && a.every((v, i) => Number.isFinite(v) && Math.abs(v - b[i]) < 1e-8);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const plain = o => !o?.matrix && !o?.transform && !o?.pivot && !o?.flip
  && (o?.scale ?? 1) === 1 && (o?.rotate ?? 0) === 0 && (o?.rotation ?? 0) === 0;
const umbrellaQuarterContactSpriteKeys = () => Object.values(UMBRELLA_QUARTER_CONTACT_KEYS);

function sourceMatches(manifest, name) {
  const [part, file, hash] = PARTS[name], palm = name.startsWith('palm');
  const s = manifest.tools?.[UMBRELLA_QUARTER_CONTACT_KEYS[name]], c = s?.sourceContactPose;
  return s?.src === `action-contact/umbrella-quarter-handle-v1/${file}` && plain(s)
    && same(s.rect, palm ? [0, 0, 80, 72] : [0, 0, 50, 66])
    && (palm ? s.tint === 'body' : s.tint === undefined)
    && c?.id === UMBRELLA_QUARTER_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
    && c.action === 'umbrella-dance' && c.view === 'three-quarter' && c.part === part
    && c.bodySha256 === BODY_HASH && same(c.bodyRect, BODY_RECT) && c.propSha256 === PROP_HASH
    && c.sourceSha256 === hash && c.sourceMasterSha256 === MASTER_HASH
    && c.sourceMaskSha256 === MASK_HASH && c.fullPalmLogicalSha256 === PALM_HASH
    && same(c.contact, [68.375, 43.75]) && same(c.legacyContact, [61.875, 35.75])
    && same(c.fixedPalmTranslation, [-4, 3]) && same(c.shaftAxis, [0, 1])
    && c.palmPartitionX === 68 && c.propPartitionPixelY === 392
    && c.samplesPerArtUnit === 1 && c.alphaCoverageThreshold === .35 && c.inkCoverageThreshold === .2
    && c.translationOnly === true && c.quantizedOnce === true && c.sourceWristObserved === false
    && c.gripRegion === 'original-green-j-right-upright';
}

function umbrellaQuarterSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const a = options.action;
  if (a?.id !== 'umbrella-dance' || a.motion !== 'umbrella' || a.prop !== 'umbrella'
    || view !== 'three-quarter' || options.state === 'dragged' || options.transform || options.matrix
    || !unit(options.progress ?? 0) || !unit(a.propOpacity ?? 1)
    || a.handoffRecovery !== undefined && !unit(a.handoffRecovery)) return false;
  const body = manifest?.views?.['three-quarter']?.body, umbrella = manifest?.tools?.umbrella;
  if (body?.src !== 'views/three-quarter-right/body.png' || !same(body.rect, BODY_RECT) || !plain(body)
    || umbrella?.src !== 'tools/umbrella.png' || !same(umbrella.rect, [0, 0, 50, 66]) || !plain(umbrella)
    || !same(umbrella.anchors?.right, [24.875, 46.75])) return false;
  const contact = pose?.contact, tools = contact?.tools?.filter(t => !t.contextAccessory), tool = tools?.[0];
  const hands = contact?.hands, hand = hands?.[0];
  if (!contact || contact.layer !== 'front' || !unit(contact.phase) || tools?.length !== 1
    || tool?.key !== 'umbrella' || tool.x !== 37 || tool.y !== -11 || tool.layer !== 'back'
    || !plain(tool) || tool.coversPaw || tool.surface || tool.behindAnatomy || tool.persistent
    || !unit(tool.opacity ?? 1) || hands?.length !== 1 || hand.side !== 'right' || hand.layer !== 'front'
    || !plain(hand) || !unit(hand.opacity ?? 1) || hand.integrated || hand.pawSprite || hand.pawMatrix
    || hand.sourceContact || !Array.isArray(hand.points) || hand.points.length !== 3
    || !near(hand.points[0], [58.6, 39.712821]) || !near(hand.points[1], [58.475, 38.462821])
    || !near(hand.points[2], [61.875, 35.75])
    || !near(hand.gripPoint || hand.points[2], [61.875, 35.75])) return false;
  return Object.keys(PARTS).every(name => sourceMatches(manifest, name));
}

function applyUmbrellaQuarterSourceContactPose(manifest, pose, options = {}) {
  if (!umbrellaQuarterSourceContactPoseEligible(manifest, pose, 'three-quarter', options)) return pose;
  const umbrella = pose.contact.tools.find(t => !t.contextAccessory && t.key === 'umbrella');
  const hand = pose.contact.hands[0], keys = UMBRELLA_QUARTER_CONTACT_KEYS;
  // Both prop fragments retain every original transform/opacity field. The
  // hand's rear piece shares its fixed translation and the same action envelope.
  const tools = pose.contact.tools.flatMap(item => item !== umbrella ? [item] : [
    { ...item, key: keys.propBack, layer: 'back' },
    { key: keys.palmBack, x: -4, y: 3, layer: 'back', opacity: hand.opacity ?? 1 },
    { ...item, key: keys.propFront, layer: 'front' }
  ]);
  return { ...pose, sourceContactPose: UMBRELLA_QUARTER_CONTACT_ID, contact: { ...pose.contact, tools,
    hands: [{ ...hand, pawSprite: keys.palmFront, pawMatrix: [1, 0, 0, 1, -4, 3],
      opacity: (hand.opacity ?? 1) * (options.action.propOpacity ?? 1),
      legacyGripPoint: hand.gripPoint || hand.points[2], gripPoint: [68.375, 43.75],
      sourceContact: { kind: 'observed-quarter-far-palm-hook-grip', sourcePoseId: UMBRELLA_QUARTER_CONTACT_ID,
        target: [68.375, 43.75], shaftAxis: [0, 1], sourceWristObserved: false,
        gripRegion: 'original-green-j-right-upright' },
      connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground'
    }] } };
}

export { UMBRELLA_QUARTER_CONTACT_ID, UMBRELLA_QUARTER_CONTACT_KEYS, umbrellaQuarterContactSpriteKeys,
  umbrellaQuarterSourceContactPoseEligible, applyUmbrellaQuarterSourceContactPose };
