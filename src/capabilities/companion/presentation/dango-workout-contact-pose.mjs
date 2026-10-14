'use strict';

// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: two complete generated
// support arms use the existing back-tool pass. Canonical body hides their
// open roots; original feet, body, headband and movement remain untouched.
const WORKOUT_CONTACT_ID = 'workout-front-support-v4';
const WORKOUT_CONTACT_KEYS = Object.freeze({
  left: 'workout-front-support-v4-left', right: 'workout-front-support-v4-right'
});
const BODY_RECT = Object.freeze([-1.789744, 8.533333, 69.415385, 49.066667]);
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const RAW_HASH = 'd53f342877cc1a14ed04cb90c769d51074eaa7a22fb2c71029daa2f211cf8061';
const SOURCES = Object.freeze({
  left: Object.freeze({ target: 6.5, sole: [2, 11], cells: 274,
    sha: '5f7045b75998b125a6f733bce339812e7e4fce8d031fa59b7c9a486c3886bdf5',
    logical: 'd37f552f4b706f47d1012726b87ad588b831e599235ff3cc1169d8d33a31b725' }),
  right: Object.freeze({ target: 59.5, sole: [55, 64], cells: 264,
    sha: '6f9c7d7ff926591759517f7b45938224e463df67928b4c391a0c896f97d0e7cc',
    logical: '7e36c35aaa10120fb8ab995c63d9701e9c56d8f284f6c92370213fe76a9e76d4' })
});
const FOOT_RECTS = Object.freeze({ left: [5.430769, 52.512821, 27.569231, 11.487179],
  right: [33, 52.512821, 27.076923, 11.487179] });
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const near = (a, b) => Array.isArray(a) && a.length === b.length
  && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) < 1e-8);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const plain = o => !o?.matrix && !o?.transform && !o?.pivot && !o?.flip
  && (o?.scale ?? 1) === 1 && (o?.rotate ?? 0) === 0 && (o?.rotation ?? 0) === 0;
const workoutContactSpriteKeys = () => Object.values(WORKOUT_CONTACT_KEYS);

function sourceMatches(manifest, side) {
  const s = manifest.tools?.[WORKOUT_CONTACT_KEYS[side]], c = s?.sourceContactPose, source = SOURCES[side];
  return s?.src === `action-contact/${WORKOUT_CONTACT_ID}/${side}-8x.png` && plain(s)
    && s.tint === 'body' && same(s.rect, [-12, -1, 90, 81])
    && c?.id === WORKOUT_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
    && c.action === 'workout' && c.view === 'front' && c.side === side
    && c.kind === 'planted-support' && c.depth === 'behind-body'
    && c.bodySha256 === BODY_HASH && same(c.bodyRect, BODY_RECT)
    && c.sourceSha256 === source.sha && c.logicalSha256 === source.logical && c.rawSourceSha256 === RAW_HASH
    && same(c.contact, [source.target, 64]) && same(c.normal, [0, 1]) && same(c.soleXInterval, source.sole)
    && c.translationOnly === true && c.quantizedOnce === true && c.samplesPerArtUnit === 1
    && c.uniformSourceScale === 80 / 1254 && c.alphaCoverageThreshold === .25
    && c.paletteSelection === 'maximum-alpha-weighted-area' && c.opaqueCells === source.cells
    && c.binaryAlpha === true && c.exactNearest8x === true && c.rootOcclusion === 'unchanged-canonical-body';
}

function originalGroundShift(manifest, pose) {
  const contact = pose?.contact, hands = contact?.hands;
  if (contact?.layer !== 'front' || !unit(contact.phase) || !Array.isArray(contact.tools)
    || contact.tools.some(t => !t.contextAccessory) || !Array.isArray(hands) || hands.length !== 2) return null;
  const sole = manifest.tools?.['support-paw']?.anchors?.sole;
  if (!near(sole, [6, 10.415094339622641])) return null;
  const shifts = [];
  for (const side of ['left', 'right']) {
    if (hands.filter(h => h.side === side).length !== 1) return null;
    const h = hands.find(h => h.side === side), target = h.points?.at(-1), left = side === 'left';
    if (h.layer !== 'front' || !plain(h) || !unit(h.opacity ?? 1) || h.pawSprite !== 'support-paw'
      || h.sourceContact || h.sourcePart || !Array.isArray(h.points) || h.points.length !== 3
      || !near(h.points[0], [left ? 7.4 : 58.6, 39.712821]) || !near(h.points[1], h.points[0])
      || !near(target, target) || target[0] !== (left ? 22 : 44)) return null;
    const shift = 64 - target[1];
    if (!Number.isFinite(shift) || shift < -1e-8 || shift > 2.25 + 1e-8
      || !near(h.pawMatrix, [1, 0, 0, 1, target[0] - sole[0], target[1] - sole[1]])
      || !near(pose.matrices?.[`foot-${side}`], [1, 0, 0, 1, 0, -shift])) return null;
    shifts.push(shift);
  }
  return Math.abs(shifts[0] - shifts[1]) < 1e-8 ? shifts[0] : null;
}

function workoutSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const a = options.action, data = manifest?.views?.front, body = data?.body;
  if (a?.id !== 'workout' || a.motion !== 'pushup' || a.prop !== 'headband' || view !== 'front'
    || options.motion !== undefined && options.motion !== 'pushup'
    || options.state === 'dragged' || options.transform || options.matrix || !unit(options.progress ?? 0)
    || !unit(a.propOpacity ?? 1) || a.handoffRecovery !== undefined && !unit(a.handoffRecovery)) return false;
  if (body?.src !== 'views/front/body.png' || !same(body.rect, BODY_RECT) || !plain(body)
    || body.sha256 !== undefined && body.sha256 !== BODY_HASH) return false;
  for (const side of ['left', 'right']) {
    const foot = data.parts?.[`foot-${side}`];
    if (foot?.src !== `views/front/foot-${side}.png` || !same(foot.rect, FOOT_RECTS[side])
      || foot.matrix || foot.transform || foot.flip || (foot.scale ?? 1) !== 1
      || (foot.rotate ?? 0) !== 0 || (foot.rotation ?? 0) !== 0) return false;
  }
  return originalGroundShift(manifest, pose) !== null && ['left', 'right'].every(side => sourceMatches(manifest, side));
}

function applyWorkoutSourceContactPose(manifest, pose, options = {}) {
  if (!workoutSourceContactPoseEligible(manifest, pose, 'front', options)) return pose;
  const groundShift = originalGroundShift(manifest, pose), tools = [...pose.contact.tools];
  const hands = pose.contact.hands.map(hand => {
    const key = WORKOUT_CONTACT_KEYS[hand.side], target = [SOURCES[hand.side].target, 64 - groundShift];
    const contact = { kind: 'planted-support', sourcePoseId: WORKOUT_CONTACT_ID,
      anatomicalArmId: hand.side, depth: 'behind-body', target, boundaryNormal: [0, 1], groundY: 64, groundShift };
    // These whole arms are real back-tool draws. coversPaw suppresses the old
    // short hand in the same back pass; deleting pawSprite prevents front paw
    // routing. Tool opacity applies the action envelope exactly once.
    tools.push({ key, x: 0, y: -groundShift, layer: 'back', opacity: hand.opacity ?? 1,
      coversPaw: hand.side, anatomicalArmId: hand.side, sourceContact: contact });
    const semanticHand = { ...hand };
    delete semanticHand.pawSprite; delete semanticHand.pawMatrix; delete semanticHand.pawOcclusion;
    return { ...semanticHand, layer: 'back', legacyGripPoint: hand.gripPoint || hand.points.at(-1),
      gripPoint: [...target], points: [hand.points[0], hand.points[0], [...target]], sourceContact: contact,
      connector: false, attachedArm: false, integrated: false, limb: false };
  });
  return { ...pose, sourceContactPose: WORKOUT_CONTACT_ID, contact: { ...pose.contact, hands, tools } };
}

export { WORKOUT_CONTACT_ID, WORKOUT_CONTACT_KEYS, workoutContactSpriteKeys,
  workoutSourceContactPoseEligible, applyWorkoutSourceContactPose };
