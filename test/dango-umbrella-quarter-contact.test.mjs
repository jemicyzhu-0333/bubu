import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { createDangoRasterArtist } from '../src/capabilities/companion/presentation/dango-raster-art.mjs';
import { createSourceContactPoseSelector } from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import {
  UMBRELLA_QUARTER_CONTACT_ID as ID,
  UMBRELLA_QUARTER_CONTACT_KEYS as KEYS,
  umbrellaQuarterContactSpriteKeys as spriteKeys,
  umbrellaQuarterSourceContactPoseEligible as eligible,
  applyUmbrellaQuarterSourceContactPose as apply
} from '../src/capabilities/companion/presentation/dango-umbrella-quarter-contact-pose.mjs';

// PET_VISUAL「穿搭遮挡与肢体一体轮廓」: validate the accepted source
// contract and its atomic fallback through the real production selector/artist.
const keys = Object.values(KEYS);
const entries = Object.fromEntries(keys.map(key => [key, DANGO_RASTER.tools[key]]));
const assetDir = fileURLToPath(new URL('action-contact/' + ID + '/', DANGO_RASTER.baseUrl));
const assetFile = sprite => fileURLToPath(new URL(sprite.src, DANGO_RASTER.baseUrl));
const manifest = () => structuredClone(DANGO_RASTER);
const options = (patch = {}) => ({
  action: { ...PET_ACTIONS['umbrella-dance'] }, motion: 'umbrella', view: 'three-quarter',
  progress: .5, elapsedMs: 5000, state: 'idle', facing: 1, channel: 'pet',
  actionInstanceKey: 'umbrella-quarter-contract', ...patch
});
const pose = (opacity = .8) => ({
  view: 'three-quarter', data: { body: { canonicalIdentity: 'body-stays-identical' } },
  matrices: { 'foot-left': [1, 0, 0, 1, 2, 3], 'foot-right': [1, 0, 0, 1, 4, 5] },
  face: { eyes: 'smile', mouth: 'open' },
  contact: {
    layer: 'front', phase: .5,
    tools: [{ key: 'umbrella', x: 37, y: -11, layer: 'back' }],
    details: [{ kind: 'contract-sentinel', x: 4, y: 8 }],
    hands: [{ side: 'right', layer: 'front', points: [
      [58.6, 39.712821], [58.474999999999994, 38.46282099999999], [61.875, 35.75]
    ], opacity }]
  }
});
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const CONTACT = [68.375, 43.75];
const LEGACY = [61.875, 35.75];
const OFFSET = [-4, 3];
const SHA = value => createHash('sha256').update(value).digest('hex');
const mutateValue = value => Array.isArray(value) ? value.map((n, i) => i ? n : n + 1)
  : typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : '__invalid__';
function rejected(m, p, o, label, view = 'three-quarter') {
  const beforeManifest = structuredClone(m), beforePose = structuredClone(p), beforeOptions = structuredClone(o);
  assert.equal(eligible(m, p, view, o), false, label);
  if (view === 'three-quarter') assert.equal(apply(m, p, o), p, `${label}: apply returns original pose`);
  assert.deepEqual(m, beforeManifest, `${label}: manifest unchanged`);
  assert.deepEqual(p, beforePose, `${label}: pose unchanged`);
  assert.deepEqual(o, beforeOptions, `${label}: options unchanged`);
}

test('quarter umbrella has exactly four closed source keys and an isolated mutable keys array', () => {
  assert.equal(ID, 'umbrella-quarter-handle-v1');
  assert.deepEqual(KEYS, {
    palmBack: `${ID}-right-back`, palmFront: `${ID}-right-front`,
    propBack: `${ID}-umbrella-back`, propFront: `${ID}-umbrella-front`
  });
  assert.deepEqual(new Set(spriteKeys()), new Set(keys));
  assert.equal(spriteKeys().length, 4);
  assert.equal(Object.keys(entries).length, 4);
  const first = spriteKeys();
  first.pop();
  assert.equal(spriteKeys().length, 4, 'callers cannot shrink the registered group');
  assert.equal(eligible(manifest(), pose(), 'three-quarter', options()), true);
});

test('accepted pose only changes the reviewed grip and complementary contact layers', () => {
  const m = deepFreeze(manifest()), p = deepFreeze(pose()), o = deepFreeze(options());
  const before = structuredClone({ m, p, o });
  const result = apply(m, p, o);
  assert.notEqual(result, p);
  assert.equal(result.sourceContactPose, ID);
  assert.equal(result.data, p.data);
  assert.equal(result.matrices, p.matrices);
  assert.equal(result.face, p.face);
  assert.equal(result.contact.details, p.contact.details);
  assert.equal(result.contact.phase, p.contact.phase);
  assert.equal(result.contact.layer, p.contact.layer);
  assert.deepEqual(result.contact.tools.map(t => [t.key, t.layer]), [
    [KEYS.propBack, 'back'], [KEYS.palmBack, 'back'], [KEYS.propFront, 'front']
  ]);
  for (const t of result.contact.tools.filter(t => t.key !== KEYS.palmBack)) {
    assert.deepEqual([t.x, t.y], [37, -11], 'original umbrella placement remains fixed');
  }
  const backPalm = result.contact.tools.find(t => t.key === KEYS.palmBack);
  assert.deepEqual([backPalm.x, backPalm.y], OFFSET);
  const hand = result.contact.hands[0];
  assert.equal(result.contact.hands.length, 1);
  assert.equal(hand.pawSprite, KEYS.palmFront);
  assert.deepEqual(hand.pawMatrix, [1, 0, 0, 1, ...OFFSET]);
  assert.deepEqual(hand.gripPoint, CONTACT);
  assert.deepEqual(hand.legacyGripPoint, LEGACY);
  assert.deepEqual(hand.points, p.contact.hands[0].points, 'canonical source skeleton is retained');
  assert.deepEqual(hand.sourceContact.target, CONTACT);
  assert.deepEqual(hand.sourceContact.shaftAxis, [0, 1]);
  assert.equal(hand.sourceContact.sourcePoseId, ID);
  assert.equal(hand.sourceContact.sourceWristObserved, false);
  assert.equal(hand.connector, false);
  assert.equal(hand.attachedArm, false);
  assert.equal(hand.integrated, false);
  assert.equal(hand.limb, false);
  assert.equal(hand.pawOcclusion, 'foreground');
  assert.deepEqual({ m, p, o }, before, 'deep-frozen inputs remain unchanged');
  assert.equal(apply(m, result, o), result, 'second application cannot add duplicate pieces');
});

test('each source descriptor and each required metadata field fails closed when removed or changed', async t => {
  for (const key of keys) {
    await t.test(`${key}: missing descriptor`, () => {
      const m = manifest(); delete m.tools[key]; rejected(m, pose(), options(), key);
    });
    await t.test(`${key}: missing contract`, () => {
      const m = manifest(); delete m.tools[key].sourceContactPose; rejected(m, pose(), options(), key);
    });
    for (const [field, value] of Object.entries(entries[key].sourceContactPose)) {
      for (const mode of ['missing', 'changed']) await t.test(`${key}.${field}: ${mode}`, () => {
        const m = manifest();
        if (mode === 'missing') delete m.tools[key].sourceContactPose[field];
        else m.tools[key].sourceContactPose[field] = mutateValue(value);
        rejected(m, pose(), options(), `${key}.${field}:${mode}`);
      });
    }
    for (const [field, value] of [['src', 'tools/umbrella.png'], ['rect', [0, 0, 81, 72]],
      ['tint', key.includes('-right-') ? undefined : 'body'], ['scale', 2], ['rotate', .1],
      ['rotation', .1], ['matrix', [1, 0, 0, 1, 0, 0]], ['transform', {}], ['pivot', [0, 0]], ['flip', true]]) {
      await t.test(`${key} descriptor ${field}`, () => {
        const m = manifest(); m.tools[key][field] = value;
        rejected(m, pose(), options(), `${key}.${field}`);
      });
    }
  }
});

test('canonical quarter body and original umbrella descriptors are pinned without transforms', async t => {
  const edits = [
    ['body missing', m => delete m.views['three-quarter'].body],
    ['body source', m => m.views['three-quarter'].body.src = 'views/front/body.png'],
    ['body rect', m => m.views['three-quarter'].body.rect[0] += .01],
    ['umbrella missing', m => delete m.tools.umbrella],
    ['umbrella source', m => m.tools.umbrella.src = 'tools/broom.png'],
    ['umbrella rect', m => m.tools.umbrella.rect[2] += .01],
    ['umbrella grip', m => m.tools.umbrella.anchors.right[0] += .01]
  ];
  for (const [label, edit] of edits) await t.test(label, () => {
    const m = manifest(); edit(m); rejected(m, pose(), options(), label);
  });
  for (const target of ['body', 'umbrella']) for (const [field, value] of [
    ['scale', 2], ['rotate', .01], ['rotation', .01], ['matrix', [1, 0, 0, 1, 0, 0]],
    ['transform', {}], ['pivot', [0, 0]], ['flip', true]
  ]) await t.test(`${target}.${field}`, () => {
    const m = manifest(); (target === 'body' ? m.views['three-quarter'].body : m.tools.umbrella)[field] = value;
    rejected(m, pose(), options(), `${target}.${field}`);
  });
});

test('unreviewed contact geometry is rejected atomically', async t => {
  const edits = [
    ['no contact', p => delete p.contact], ['wrong layer', p => p.contact.layer = 'back'],
    ['bad phase', p => p.contact.phase = NaN], ['no tool', p => p.contact.tools = []],
    ['extra tool', p => p.contact.tools.push({ key: 'cup' })],
    ['wrong tool', p => p.contact.tools[0].key = 'broom'],
    ['tool x', p => p.contact.tools[0].x += .01], ['tool y', p => p.contact.tools[0].y += .01],
    ['tool layer', p => p.contact.tools[0].layer = 'front'],
    ['tool covers paw', p => p.contact.tools[0].coversPaw = true],
    ['tool surface', p => p.contact.tools[0].surface = true],
    ['tool behind anatomy', p => p.contact.tools[0].behindAnatomy = true],
    ['persistent tool', p => p.contact.tools[0].persistent = true],
    ['tool opacity', p => p.contact.tools[0].opacity = NaN],
    ['no hand', p => p.contact.hands = []], ['extra hand', p => p.contact.hands.push({ ...p.contact.hands[0] })],
    ['wrong side', p => p.contact.hands[0].side = 'left'], ['hand layer', p => p.contact.hands[0].layer = 'back'],
    ['bad root', p => p.contact.hands[0].points[0][0] += .1],
    ['bad elbow', p => p.contact.hands[0].points[1][0] = NaN],
    ['shifted elbow', p => p.contact.hands[0].points[1][0] += .01],
    ['bad endpoint', p => p.contact.hands[0].points[2][0] += .1],
    ['bad explicit grip', p => p.contact.hands[0].gripPoint = [62, 36]],
    ['short chain', p => p.contact.hands[0].points.pop()],
    ['long chain', p => p.contact.hands[0].points.push([61.875, 35.75])],
    ['invalid hand opacity', p => p.contact.hands[0].opacity = Infinity],
    ['negative hand opacity', p => p.contact.hands[0].opacity = -.1],
    ['overflow hand opacity', p => p.contact.hands[0].opacity = 1.1],
    ['integrated hand', p => p.contact.hands[0].integrated = true],
    ['preexisting sprite', p => p.contact.hands[0].pawSprite = KEYS.palmFront],
    ['preexisting paw matrix', p => p.contact.hands[0].pawMatrix = [1, 0, 0, 1, 0, 0]],
    ['preexisting contact', p => p.contact.hands[0].sourceContact = {}]
  ];
  for (const target of ['tool', 'hand']) for (const [field, value] of [
    ['scale', 2], ['rotate', .1], ['rotation', .1], ['matrix', [1, 0, 0, 1, 0, 0]],
    ['transform', {}], ['pivot', [0, 0]], ['flip', true]
  ]) edits.push([`${target}.${field}`, p => p.contact[target === 'tool' ? 'tools' : 'hands'][0][field] = value]);
  for (const [label, edit] of edits) await t.test(label, () => {
    const p = pose(); edit(p); rejected(manifest(), p, options(), label);
  });
});

test('action, view, progress and opacity scope remains narrow', async t => {
  for (const view of ['front', 'profile', 'back', 'three-quarter-left', undefined]) {
    assert.equal(eligible(manifest(), pose(), view, options()), false, `unsupported view ${view}`);
  }
  const patches = [
    ['no action', { action: undefined }], ['wrong id', { action: { ...options().action, id: 'sweep' } }],
    ['wrong motion', { action: { ...options().action, motion: 'sweep' } }],
    ['wrong prop', { action: { ...options().action, prop: 'broom' } }],
    ['dragged', { state: 'dragged' }], ['option transform', { transform: {} }],
    ['option matrix', { matrix: [1, 0, 0, 1, 0, 0] }]
  ];
  for (const progress of [NaN, Infinity, -.01, 1.01]) patches.push([`progress ${progress}`, { progress }]);
  for (const field of ['propOpacity', 'handoffRecovery']) for (const value of [NaN, Infinity, -.1, 1.1]) {
    patches.push([`${field} ${value}`, { action: { ...options().action, [field]: value } }]);
  }
  for (const [label, patch] of patches) await t.test(label, () => rejected(manifest(), pose(), options(patch), label));
  for (const facing of [-1, 1]) for (const progress of [0, .12, .37, .5, .999, 1]) {
    assert.equal(eligible(manifest(), pose(), 'three-quarter', options({ facing, progress })), true);
  }
  assert.equal(eligible(manifest(), pose(), 'three-quarter', options({ progress: undefined })), true,
    'omitted optional progress defaults to the initial phase');
});

test('context accessories remain identical and do not count as a second held prop', () => {
  const p = pose();
  const accessory = { key: 'context-robot', contextAccessory: true, x: 78, y: 50, layer: 'front' };
  p.contact.tools.unshift(accessory);
  assert.equal(eligible(manifest(), p, 'three-quarter', options()), true);
  const result = apply(manifest(), p, options());
  assert.equal(result.contact.tools[0], accessory);
  assert.equal(result.contact.tools.filter(t => t.contextAccessory).length, 1);
  assert.equal(result.contact.tools.length, 4);
});

test('front and back palm share hand opacity and receive prop fade exactly once', () => {
  const m = manifest();
  for (const opacity of [0, .1, .5, .7, 1]) for (const handOpacity of [0, .25, .8, 1]) {
    const p = pose(handOpacity), o = options({ action: { ...options().action, propOpacity: opacity, handoffRecovery: 1 - opacity } });
    assert.equal(eligible(m, p, 'three-quarter', o), true);
    const result = apply(m, p, o), back = result.contact.tools.find(t => t.key === KEYS.palmBack);
    assert.equal(result.contact.hands[0].opacity, handOpacity * opacity);
    // The tool painter applies propOpacity to every tool; store only the hand envelope here.
    assert.equal(back.opacity, handOpacity);
    assert.equal(back.opacity * opacity, result.contact.hands[0].opacity);
    for (const prop of result.contact.tools.filter(t => [KEYS.propBack, KEYS.propFront].includes(t.key))) {
      assert.equal(prop.opacity ?? 1, 1, 'do not square the common prop fade');
    }
  }
});

test('shared selector keeps four-layer cold, late and lost resource fallback atomic per episode', async t => {
  const createSelector = createSourceContactPoseSelector;
  for (const key of keys) for (const fault of ['loading', 'missing', 'failed']) await t.test(`${key}: ${fault}`, () => {
    const m = manifest(), p = pose(), o = options(); let state = fault;
    const s = createSelector({ manifest: m, source: { state: sprite => sprite === m.tools[key] ? state : 'ready' } });
    try {
      assert.equal(s.apply(p, 'three-quarter', o), p);
      state = 'ready';
      assert.equal(s.apply(p, 'three-quarter', { ...o, progress: .6, action: { ...o.action, propOpacity: .5 } }), p);
      assert.equal(s.apply(p, 'three-quarter', { ...o, actionInstanceKey: 'next' }).sourceContactPose, ID);
    } finally { s.dispose(); }
  });
  for (const key of keys) await t.test(`${key}: mid-episode loss`, () => {
    const m = manifest(), p = pose(), o = options(); let state = 'ready';
    const s = createSelector({ manifest: m, source: { state: sprite => sprite === m.tools[key] ? state : 'ready' } });
    try {
      assert.equal(s.apply(p, 'three-quarter', o).sourceContactPose, ID);
      state = 'failed';
      assert.equal(s.apply(p, 'three-quarter', { ...o, progress: .6 }), p);
      state = 'ready';
      assert.equal(s.apply(p, 'three-quarter', { ...o, progress: .7 }), p);
      assert.equal(s.apply(p, 'three-quarter', { ...o, actionInstanceKey: 'next' }).sourceContactPose, ID);
    } finally { s.dispose(); }
  });
  const m = manifest(), p = pose(), o = options(); let petCold = true;
  const s = createSelector({ manifest: m, source: { state: () => petCold ? 'loading' : 'ready' } });
  try {
    assert.equal(s.apply(p, 'three-quarter', o), p); petCold = false;
    assert.equal(s.apply(p, 'three-quarter', { ...o, channel: 'gallery:test' }).sourceContactPose, ID);
    assert.equal(s.apply(p, 'three-quarter', o), p, 'gallery may not reopen the pet episode');
    s.dispose();
    assert.equal(s.apply(p, 'three-quarter', o).sourceContactPose, ID, 'dispose resets the readiness windows');
  } finally { s.dispose(); }
});

test('source hashes, complementary layers and nearest-neighbour 8x are exact', async () => {
  const decode = async file => {
    const image = await loadImage(file), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
  };
  for (const key of keys) {
    assert.equal(SHA(readFileSync(assetFile(entries[key]))), entries[key].sourceContactPose.sourceSha256, key);
  }
  const c = entries[KEYS.palmBack].sourceContactPose;
  assert.equal(SHA(readFileSync(new URL(DANGO_RASTER.views['three-quarter'].body.src, DANGO_RASTER.baseUrl))), c.bodySha256);
  assert.equal(SHA(readFileSync(new URL(DANGO_RASTER.tools.umbrella.src, DANGO_RASTER.baseUrl))), c.propSha256);
  assert.equal(SHA(readFileSync(join(assetDir, 'whole-logical.png'))), c.fullPalmLogicalSha256);
  async function complementary(originalFile, backFile, frontFile) {
    const [original, back, front] = await Promise.all([originalFile, backFile, frontFile].map(decode));
    assert.deepEqual([back.width, back.height, front.width, front.height], [original.width, original.height, original.width, original.height]);
    for (let i = 0; i < original.data.length; i += 4) {
      assert.ok(!(back.data[i + 3] && front.data[i + 3]), `overlapping alpha at ${i / 4}`);
      const picked = front.data[i + 3] ? front : back;
      assert.deepEqual(picked.data.subarray(i, i + 4), original.data.subarray(i, i + 4), `union RGBA at ${i / 4}`);
    }
  }
  await complementary(new URL(DANGO_RASTER.tools.umbrella.src, DANGO_RASTER.baseUrl), assetFile(entries[KEYS.propBack]), assetFile(entries[KEYS.propFront]));
  await complementary(join(assetDir, 'whole-logical.png'), join(assetDir, 'right-back-logical.png'), join(assetDir, 'right-front-logical.png'));
  for (const part of ['right-back', 'right-front']) {
    const [lo, hi] = await Promise.all(['-logical.png', '-8x.png'].map(suffix => decode(join(assetDir, part + suffix))));
    assert.deepEqual([hi.width, hi.height], [lo.width * 8, lo.height * 8]);
    for (let y = 0; y < hi.height; y++) for (let x = 0; x < hi.width; x++) {
      const a = (y * hi.width + x) * 4, b = (Math.floor(y / 8) * lo.width + Math.floor(x / 8)) * 4;
      for (let channel = 0; channel < 4; channel++) assert.equal(hi.data[a + channel], lo.data[b + channel], `${part} nearest8x ${x},${y},${channel}`);
    }
  }
});

test('real production artist keeps canonical geometry for 257 phases in both facings', async () => {
  const current = manifest();
  for (const key of keys) current.tools[key].sourceContactPose.runtimeReady = false;
  const make = m => createDangoRasterArtist({ manifest: m, createSurface: createCanvas,
    loadImage: url => loadImage(fileURLToPath(url)) });
  const a = make(DANGO_RASTER), b = make(current);
  try {
    await Promise.all([a.ready({ all: true }), b.ready({ all: true })]);
    for (const facing of [-1, 1]) for (let i = 0; i <= 256; i++) {
      const o = options({ facing, progress: i / 256, elapsedMs: i * 40,
        actionInstanceKey: `quarter-facing-${facing}` });
      const result = a.resolveArtwork(o), legacy = b.resolveArtwork(o);
      assert.equal(result.sourceContactPose, ID);
      assert.equal(legacy.sourceContactPose, undefined);
      assert.deepEqual(result.data, legacy.data);
      assert.deepEqual(result.matrices, legacy.matrices);
      assert.deepEqual(result.face, legacy.face);
      assert.deepEqual(result.contact.details, legacy.contact.details);
      assert.deepEqual(result.contact.hands[0].points, legacy.contact.hands[0].points);
      assert.deepEqual(result.contact.hands[0].gripPoint, CONTACT);
      assert.deepEqual(result.contact.tools.filter(t => [KEYS.propBack, KEYS.propFront].includes(t.key))
        .map(t => [t.x, t.y]), [[37, -11], [37, -11]]);
    }
    const front = options({ view: 'front', actionInstanceKey: 'front-regression' });
    assert.equal(a.resolveArtwork(front).sourceContactPose, 'umbrella-front-v1');
    assert.equal(b.resolveArtwork(front).sourceContactPose, 'umbrella-front-v1');
  } finally { a.dispose(); b.dispose(); }
});

test('real loader decode failure of any quarter layer retains the complete ready legacy action', async t => {
  for (const key of keys) await t.test(key, async () => {
    const failedSource = DANGO_RASTER.tools[key].src;
    const a = createDangoRasterArtist({ manifest: DANGO_RASTER, createSurface: createCanvas,
      loadImage: url => {
        if (String(url).includes(failedSource)) throw Error('intentional quarter source decode failure');
        return loadImage(fileURLToPath(url));
      } });
    try {
      await a.ready({ all: true });
      const result = a.resolveArtwork(options({ actionInstanceKey: `failed-${key}` }));
      assert.equal(result.sourceContactPose, undefined);
      assert.deepEqual(result.contact.tools.map(t => t.key), ['umbrella']);
      assert.equal(result.contact.hands.some(h => keys.includes(h.pawSprite)), false);
      assert.equal(result.actionReady, true, 'valid legacy resources remain usable');
    } finally { a.dispose(); }
  });
});
