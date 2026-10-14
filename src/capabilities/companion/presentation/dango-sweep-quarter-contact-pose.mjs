'use strict';

// PET_VISUAL「配饰分层与五条不变式」: the observed closed quarter
// palm uses one fixed inward shaft contact. Its hidden wrist is not synthesized.
const SWEEP_QUARTER_CONTACT_ID = 'sweep-quarter-grip-v1';
const SWEEP_QUARTER_CONTACT_KEY = 'sweep-quarter-grip-v1-right';
const BODY_RECT = Object.freeze([-2.117949, 8.533333, 70.4, 49.066667]);
const BODY_HASH = '8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450';
const SOURCE_HASH = 'bfcdb099f62522e8384937b6b61fef1f99b1cdc9a2c5adb96fe1ce3ec1ba7435';
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const near = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) < 1e-8);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const plain = o => !o?.matrix && !o?.transform && !o?.pivot && !o?.flip
  && (o?.scale ?? 1) === 1 && (o?.rotate ?? 0) === 0 && (o?.rotation ?? 0) === 0;
const sweepQuarterContactSpriteKeys = () => [SWEEP_QUARTER_CONTACT_KEY];

function sweepQuarterSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const a = options.action;
  if (a?.id !== 'sweep' || a.motion !== 'sweep' || a.prop !== 'broom' || view !== 'three-quarter'
    || options.state === 'dragged' || options.transform || options.matrix || !unit(options.progress)
    || !unit(a.propOpacity ?? 1) || a.handoffRecovery !== undefined && !unit(a.handoffRecovery)) return false;
  const body = manifest?.views?.['three-quarter']?.body, broom = manifest?.tools?.broom;
  if (body?.src !== 'views/three-quarter-right/body.png' || !same(body.rect, BODY_RECT) || !plain(body)
    || broom?.src !== 'tools/broom.png' || !same(broom.rect, [0, 0, 23, 48]) || !plain(broom)
    || !same(broom.anchors?.right, [11.375, 20.75])) return false;
  const contact = pose?.contact, tools = contact?.tools?.filter(t => !t.contextAccessory), tool = tools?.[0];
  const hands = contact?.hands, hand = hands?.[0];
  if (!contact || contact.layer !== 'front' || !unit(contact.phase) || tools?.length !== 1
    || tool?.key !== 'broom' || !plain(tool) || !Number.isFinite(tool.x) || tool.x < 55 - 1e-8
    || tool.x > 61 + 1e-8 || tool.y !== 20 || tool.coversPaw || (tool.opacity ?? 1) !== 1
    || tool.layer && tool.layer !== 'front' || hands?.length !== 1 || hand.side !== 'right'
    || hand.layer !== 'front' || hand.style !== 'mitten' || !plain(hand) || !unit(hand.opacity ?? 1)
    || !near(hand.points?.[0], [58.6, 39.712821])
    || !Array.isArray(hand.points) || hand.points.length !== 3 || !hand.points.every(p => near(p, p))
    || hand.integrated || hand.pawSprite || hand.pawMatrix || hand.sourceContact
    || !near(hand.gripPoint || hand.points?.at(-1), [tool.x + 11.375, 40.75])) return false;
  const sprite = manifest.tools?.[SWEEP_QUARTER_CONTACT_KEY], c = sprite?.sourceContactPose;
  return sprite?.src === 'action-contact/sweep-quarter-grip-v1/right-8x.png' && sprite.tint === 'body'
    && same(sprite.rect, [0, 0, 80, 72]) && plain(sprite) && c?.id === SWEEP_QUARTER_CONTACT_ID
    && c.contractVersion === 1 && c.runtimeReady === true && c.action === 'sweep'
    && c.view === 'three-quarter' && c.side === 'right' && c.layer === 'front'
    && c.sourceSha256 === SOURCE_HASH && c.bodySha256 === BODY_HASH && same(c.bodyRect, BODY_RECT)
    && same(c.rodLocalGrip, [9.375, 20.75]) && same(c.fixedSourceOffset, [-2, 0])
    && same(c.contact, [69.375, 40.75]) && same(c.toolBase, [58, 20]) && same(c.toolXRange, [55, 61])
    && same(c.toolRect, [0, 0, 23, 48]) && same(c.shaftAxis, [0, 1])
    && c.translationOnly === true && c.uniformSourceProjection === true && c.samplesPerArtUnit === 1
    && c.alphaCoverageThreshold === .35 && c.inkCoverageThreshold === .2;
}

function applySweepQuarterSourceContactPose(manifest, pose, options = {}) {
  if (!sweepQuarterSourceContactPoseEligible(manifest, pose, 'three-quarter', options)) return pose;
  const broom = pose.contact.tools.find(t => t.key === 'broom'), target = [broom.x + 9.375, 40.75];
  return { ...pose, sourceContactPose: SWEEP_QUARTER_CONTACT_ID, contact: { ...pose.contact,
    hands: pose.contact.hands.map(hand => ({ ...hand, pawSprite: SWEEP_QUARTER_CONTACT_KEY,
      pawMatrix: [1, 0, 0, 1, broom.x - 58 - 2, 0], gripPoint: target,
      opacity: (hand.opacity ?? 1) * (options.action.propOpacity ?? 1),
      sourceContact: { kind: 'observed-closed-shaft-grip', sourcePoseId: SWEEP_QUARTER_CONTACT_ID,
        target, shaftAxis: [0, 1], hiddenWristUnobserved: true },
      connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' })) } };
}

export { SWEEP_QUARTER_CONTACT_ID, SWEEP_QUARTER_CONTACT_KEY, sweepQuarterContactSpriteKeys,
  sweepQuarterSourceContactPoseEligible, applySweepQuarterSourceContactPose };
