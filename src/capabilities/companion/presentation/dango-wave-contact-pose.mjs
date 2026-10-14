'use strict';

// PET_VISUAL「生图素材优先的当前生产流程」: a complete existing generated
// forearm+palm is sampled once into rigid wave keyposes. This is a free gesture,
// not a grip: the shoulder stays fixed and no prop or body is repositioned.
const WAVE_CONTACT_ID = 'wave-front-v1';
const SHOULDER = Object.freeze([58.5, 45.5]);
const BODY_RECT = Object.freeze([-1.789744, 8.533333, 69.415385, 49.066667]);
const BODY_HASH = '9063d11e0f2d79aa0c67ffb11ee8c4ba8c427d55f21436f7e5021c34084400a9';
const FRAMES = Object.freeze([
  {
    "angleDegrees": -20,
    "target": [
      64.5615377822816,
      36.36598337455134
    ],
    "sha256": "fe851159ebdfdd19d3828499822199be9040d8a027e7f4295d57388982d4ac0d"
  },
  {
    "angleDegrees": -15,
    "target": [
      65.33455380425217,
      36.929038893053935
    ],
    "sha256": "f40850c3f436cfc9b710c9191dcf30ea7a69b402e2a948ff45fa375a9adbc04b"
  },
  {
    "angleDegrees": -10,
    "target": [
      66.05555474495596,
      37.5573246008682
    ],
    "sha256": "1ef803998fa4159e14afb83aee68be77f4aa6d6749bd275f4730b391f6b3e96a"
  },
  {
    "angleDegrees": -5,
    "target": [
      66.71905335188194,
      38.24605886438839
    ],
    "sha256": "8e28d72f28bd1596bdc41b9683ce41942aa8bb4f9554a5a539c532cfe7cb0db3"
  },
  {
    "angleDegrees": 0,
    "target": [
      67.32,
      38.99
    ],
    "sha256": "c5bfb5149042d065d3f921a7a0723d63b31def7027f5cb4884966a4beb519bc4"
  },
  {
    "angleDegrees": 5,
    "target": [
      67.85382112245645,
      39.78348616645708
    ],
    "sha256": "75287904cac7d2d702f92cfd294976beb108ba84eb080d4ba323e80d1fe13f08"
  },
  {
    "angleDegrees": 10,
    "target": [
      68.31645401817939,
      40.62047845491285
    ],
    "sha256": "7f09c098e4d145cf7d42261bce51aa0a469d21ea5f8b715f00bbcfc9fff85b30"
  },
  {
    "angleDegrees": 15,
    "target": [
      68.70437777148699,
      41.4946068486624
    ],
    "sha256": "45414c510b5d7ab37adc0c3ddbf3ae1057586d1f178a74a5e3de5c954e62ad37"
  },
  {
    "angleDegrees": 20,
    "target": [
      69.0146400483818,
      42.399218702816135
    ],
    "sha256": "9afb39cbeb860073616c0ca3bf242744db3d36fed0f221535ebf5ab49ad7467b"
  },
  {
    "angleDegrees": 25,
    "target": [
      69.2448795655952,
      43.32742937494438
    ],
    "sha256": "2801ca7f8dd47480d38881f39079d11cbab79e830d486ee918b966051c2f9097"
  },
  {
    "angleDegrees": 30,
    "target": [
      69.39334406137874,
      44.272174621363305
    ],
    "sha256": "5cf7d0c3ebefd808980248b538153f30557e20bd38d0e046543be7e07e785c2d"
  }
].map(Object.freeze));

const waveContactSpriteKeys = () => FRAMES.map((_, i) => `wave-front-v1-${String(i).padStart(2, '0')}`);
const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((n, i) => n === b[i]);
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };

function sampleWaveSourcePose(progress = 0, calm = false) {
  const p = clamp(Number.isFinite(progress) ? progress : 0);
  const index = calm ? 3 : Math.round(5 - 5 * Math.sin(p * Math.PI * 6));
  return Object.freeze({ index, key: waveContactSpriteKeys()[index], ...FRAMES[index],
    opacity: calm ? 1 : smooth(p / .08) * smooth((1 - p) / .08) });
}

function waveSourceContactPoseEligible(manifest, pose, view, options = {}) {
  const a = options.action;
  if (a?.id !== 'wave' || a.motion !== 'wave' || a.prop !== 'none' || view !== 'front'
    || options.state === 'dragged' || options.transform || options.matrix
    || !unit(a.propOpacity ?? 1)
    || (a.handoffRecovery !== undefined && !unit(a.handoffRecovery))) return false;
  const body = manifest.views?.front?.body;
  if (body?.src !== 'views/front/body.png' || !same(body.rect, BODY_RECT)) return false;
  const hands = pose.contact?.hands || [], hand = hands[0];
  if (hands.length !== 1 || hand.side !== 'right' || hand.layer === 'back'
    || !same(hand.points?.[0], [58.6, 39.712821])
    || (pose.contact?.tools || []).some(t => !t.contextAccessory)) return false;
  return waveContactSpriteKeys().every((key, i) => {
    const sprite = manifest.tools?.[key], c = sprite?.sourceContactPose;
    return sprite?.src === `action-contact/wave-front-v1/wave-${String(i).padStart(2, '0')}-8x.png`
      && sprite.tint === 'body' && same(sprite.rect, [55, 30, 20, 22])
      && c?.id === WAVE_CONTACT_ID && c.contractVersion === 1 && c.runtimeReady === true
      && c.action === 'wave' && c.view === 'front' && c.side === 'right'
      && c.kind === 'free-gesture' && c.frame === i && c.angleDegrees === FRAMES[i].angleDegrees
      && c.bodySha256 === BODY_HASH && c.sourceSha256 === FRAMES[i].sha256
      && same(c.fixedShoulder, SHOULDER) && same(c.target, FRAMES[i].target)
      && c.quantizedOnce === true && c.translationOnly === true;
  });
}

function applyWaveSourceContactPose(manifest, pose, options = {}) {
  const sampled = sampleWaveSourcePose(options.progress, options.calmVisual || options.reducedMotion);
  const opacity = sampled.opacity * (options.action?.propOpacity ?? 1);
  return { ...pose, sourceContactPose: WAVE_CONTACT_ID, contact: { ...pose.contact,
    hands: pose.contact.hands.map(hand => ({ ...hand, pawSprite: sampled.key,
      pawMatrix: [1, 0, 0, 1, 0, 0], opacity: (hand.opacity ?? 1) * opacity,
      legacyGripPoint: hand.gripPoint || hand.points?.at(-1),
      points: [[...SHOULDER], [...SHOULDER], [...sampled.target]], gripPoint: [...sampled.target],
      sourceContact: { kind: 'free-gesture', sourcePoseId: WAVE_CONTACT_ID,
        fixedShoulder: [...SHOULDER], target: [...sampled.target], keypose: sampled.index,
        angleDegrees: sampled.angleDegrees, physicalGripClaim: false },
      connector: false, attachedArm: false, integrated: false, limb: false, pawOcclusion: 'foreground' })) } };
}

export { WAVE_CONTACT_ID, waveContactSpriteKeys, sampleWaveSourcePose,
  waveSourceContactPoseEligible, applyWaveSourceContactPose };
