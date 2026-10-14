'use strict';

// PET_VISUAL「配饰分层与五条不变式」: these are two complementary
// material parts of ONE anatomical right arm, never two right hands. The
// caller owns atomic readiness and painting the back material behind the body.
const CATCH_STAR_CONTACT_ID = 'catch-star-quarter-v1';
const CATCH_STAR_CONTACT_KEYS = Object.freeze({ back: 'catch-star-quarter-v1-back',
  front: 'catch-star-quarter-v1-front', helper: 'catch-star-quarter-v1-helper' });
const BODY_HASH = '8d76b379f2d0e2816e19dc2ef9b5efdfe8d64567a4c866e84471cf8fbe44f450';
const BODY_RECT = Object.freeze([-2.117949, 8.533333, 70.4, 49.066667]);
const RAW_HASH = '6849d250973c487264a5913cafcfc4dab0f25115084500758f755d4f1d1edf21';
const MASK_HASH = '42e929c299ed5311cc57487250f448c9ee94ccc09f97dc7cf2dfa8abb8e9b797';
const SOURCE_HASHES = Object.freeze({
  front: '77acf54475664a747636e1fd7f5dda7b108df41e274f41e5696cd5dda864df3d',
  back: '7d3180a8d964f243305e144cc176c6bb9df717017381b817c46d8248a0c54c20',
  helper: '24aa77f75bb2c9d1e615dc971c96094cef4e958d0df8df5bdc8becbd878e683f'
});
const HELPER_ALIAS = 'snack-quarter-near-v1-left';
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const near = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) < 1e-8);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const smooth = n => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const untransformed = o => !o.matrix && !o.transform && !o.pivot && !o.flip
  && (o.scale ?? 1) === 1 && (o.rotate ?? 0) === 0 && (o.rotation ?? 0) === 0;
const catchStarContactSpriteKeys = () => Object.values(CATCH_STAR_CONTACT_KEYS);

function validSource(manifest, part) {
  const sprite = manifest.tools?.[CATCH_STAR_CONTACT_KEYS[part]], c = sprite?.sourceContactPose;
  if (!sprite || !untransformed(sprite) || sprite.tint !== 'body'
    || !same(sprite.rect, part === 'helper' ? [0, 0, 66, 72] : [0, 0, 80, 72])
    || c?.id !== CATCH_STAR_CONTACT_ID || c.contractVersion !== 1 || c.runtimeReady !== true
    || c.action !== 'catch-star' || c.view !== 'three-quarter' || c.part !== part
    || c.side !== (part === 'helper' ? 'left' : 'right') || c.bodySha256 !== BODY_HASH
    || !same(c.bodyRect, BODY_RECT) || c.sourceSha256 !== SOURCE_HASHES[part]
    || c.translationOnly !== true || c.quantizedOnce !== true || c.samplesPerArtUnit !== 1) return false;
  if (part === 'helper') {
    const alias = manifest.tools?.[HELPER_ALIAS], accepted = alias?.sourceContactPose;
    return sprite.src === 'action-contact/snack-quarter-near-v1/near-8x.png'
      && c.sourceAlias === HELPER_ALIAS && c.role === 'free-preparatory-helper' && c.touchesStar === false
      && same(c.palmCenter, [23, 54]) && alias?.src === sprite.src && alias.tint === 'body'
      && same(alias.rect, sprite.rect) && accepted?.id === 'snack-quarter-near-v1'
      && accepted.sourceSha256 === SOURCE_HASHES.helper && accepted.bodySha256 === BODY_HASH
      && accepted.runtimeReady === true && accepted.contractVersion === 1;
  }
  return sprite.src === `action-contact/${CATCH_STAR_CONTACT_ID}/right-${part}-8x.png`
    && c.rawSourceSha256 === RAW_HASH && c.maskSha256 === MASK_HASH
    && c.anatomicalArmId === 'right' && c.materialPartOf === 'single-right-arm'
    && c.depth === (part === 'back' ? 'behind-body' : 'foreground')
    && same(c.sourceOrigin, [944, 569]) && same(c.logicalOrigin, [70, 29])
    && Array.isArray(c.openRootCut) && c.openRootCut.length === 2
    && same(c.openRootCut[0], [850, 615]) && same(c.openRootCut[1], [914, 642])
    && c.uniformScale === .1 && c.minimumAlphaCoverage === .35 && c.minimumInkCoverage === .2
    && c.opaqueCells === (part === 'front' ? 43 : 26) && c.binaryAlpha === true
    && c.exactNearest8x === true && c.disjointPartition === true && c.unionByteExact === true;
}

function validOriginalContact(pose) {
  const contact = pose?.contact;
  if (!contact || !unit(contact.phase) || contact.layer !== 'front' || !Array.isArray(contact.hands)
    || !Array.isArray(contact.tools)) return false;
  const p = contact.phase, lower = smooth((p - .67) / .23);
  const held = mix([70, 29], [51, 46], lower);
  const target = mix([62, 42], held, smooth((p - .12) / .25));
  const starAt = mix([76, 0], held, smooth((p - .08) / .34));
  const hands = contact.hands, right = hands.find(h => h.side === 'right'), left = hands.find(h => h.side === 'left');
  if (hands.length !== (lower > .3 ? 2 : 1) || hands.filter(h => h.side === 'right').length !== 1
    || (lower > .3 && hands.filter(h => h.side === 'left').length !== 1)
    || !right || right.style !== 'open' || !near(right.points?.at(-1), target)
    || !same(right.points?.[0], [58.6, 39.712821])) return false;
  if (left && (left.style !== 'mitten' || !same(left.points?.[0], [7.4, 39.712821])
    || !near(left.points?.at(-1), [held[0] - 10, held[1] + 3]))) return false;
  if (!hands.every(h => h.layer === 'front' && unit(h.opacity ?? 1) && untransformed(h)
    && !h.pawMatrix && !h.pawSprite && !h.sourcePart && !h.sourceContact
    && Array.isArray(h.points) && h.points.length === 3 && h.points.every(xy => near(xy, xy)))) return false;
  const tools = contact.tools.filter(t => !t.contextAccessory), star = tools[0];
  return tools.length === 1 && star?.key === 'star' && untransformed(star)
    && !star.coversPaw && (!star.layer || star.layer === 'front') && unit(star.opacity ?? 1)
    && near([star.x, star.y], [starAt[0] - 8.5, starAt[1] - 14]);
}

function catchStarSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const a = options.action;
  if (a?.id !== 'catch-star' || a.motion !== 'reach' || a.prop !== 'star' || view !== 'three-quarter'
    || options.state === 'dragged' || options.transform || options.matrix || !unit(options.progress)
    || !unit(a.propOpacity ?? 1) || (a.handoffRecovery !== undefined && !unit(a.handoffRecovery))) return false;
  const body = manifest?.views?.['three-quarter']?.body;
  if (body?.src !== 'views/three-quarter-right/body.png' || !same(body.rect, BODY_RECT)
    || !untransformed(body) || body.sha256 !== undefined && body.sha256 !== BODY_HASH) return false;
  const star = manifest.tools?.star;
  if (star?.src !== 'tools/star.png' || !same(star.rect, [0, 0, 17, 17]) || !untransformed(star)) return false;
  return validOriginalContact(pose) && ['back', 'front', 'helper'].every(part => validSource(manifest, part));
}

function applyCatchStarSourceContactPose(manifest, pose, options = {}) {
  if (!catchStarSourceContactPoseEligible(manifest, pose, 'three-quarter', options)) return pose;
  const hands = [], tools = [...pose.contact.tools], propOpacity = options.action.propOpacity ?? 1;
  for (const hand of pose.contact.hands) {
    if (hand.side === 'right') {
      const target = hand.points.at(-1), matrix = [1, 0, 0, 1, target[0] - 70, target[1] - 29];
      // Tool back is an existing production layer painted before canonical body.
      // Its painter applies propOpacity; do not apply that envelope twice here.
      tools.push({ key: CATCH_STAR_CONTACT_KEYS.back, x: matrix[4], y: matrix[5],
        layer: 'back', opacity: hand.opacity ?? 1,
        anatomicalArmId: 'right', materialPartOf: 'single-right-arm', sourcePart: 'back',
        sourceContact: { kind: 'source-star-reach', sourcePoseId: CATCH_STAR_CONTACT_ID,
          anatomicalArmId: 'right', materialPartOf: 'single-right-arm', part: 'back', target: [...target] } });
      const part = 'front';
      hands.push({ ...hand,
        anatomicalArmId: 'right', materialPartOf: 'single-right-arm', sourcePart: part,
        pawSprite: CATCH_STAR_CONTACT_KEYS[part], pawMatrix: [...matrix],
        opacity: (hand.opacity ?? 1) * propOpacity, gripPoint: [...target],
        sourceContact: { kind: 'source-star-reach', sourcePoseId: CATCH_STAR_CONTACT_ID,
          anatomicalArmId: 'right', materialPartOf: 'single-right-arm', part, target: [...target] },
        connector: false, attachedArm: false, integrated: false, limb: false,
        pawOcclusion: 'foreground' });
    } else {
      const p = pose.contact.phase, lift = 2.5 * smooth((p - .75) / .08), target = [23, 54 - lift];
      hands.push({ ...hand, pawSprite: CATCH_STAR_CONTACT_KEYS.helper, pawMatrix: [1, 0, 0, 1, 0, -lift],
        opacity: (hand.opacity ?? 1) * propOpacity * smooth((p - .75) / .04),
        legacyGripPoint: hand.gripPoint || hand.points.at(-1), points: [hand.points[0], hand.points[0], target],
        gripPoint: [...target], sourceContact: { kind: 'free-preparatory-helper',
          sourcePoseId: CATCH_STAR_CONTACT_ID, touchesStar: false, physicalGripClaim: false },
        connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' });
    }
  }
  return { ...pose, sourceContactPose: CATCH_STAR_CONTACT_ID, contact: { ...pose.contact, hands, tools } };
}

export { CATCH_STAR_CONTACT_ID, CATCH_STAR_CONTACT_KEYS, catchStarContactSpriteKeys,
  catchStarSourceContactPoseEligible, applyCatchStarSourceContactPose };
