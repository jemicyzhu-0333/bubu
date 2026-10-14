import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.BUBU_REPO_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const packageRoot = path.resolve(process.env.BUBU_WORKOUT_PACKAGE_ROOT || root);
const imp = rel => import(pathToFileURL(path.join(root, rel)).href);
const { DANGO_RASTER } = await imp('assets/companion/dango/raster/dango.raster.mjs');
const { PET_ACTIONS } = await imp('src/content/behaviors.mjs');
const { sampleRasterPose } = await imp('src/capabilities/companion/presentation/dango-raster-pose.mjs');
const { drawRasterActions } = await imp('src/capabilities/companion/presentation/dango-raster-actions.mjs');
const { PALETTES } = await imp('src/core/pet-art.mjs');
const helper = await import(pathToFileURL(path.join(packageRoot, 'src/capabilities/companion/presentation/dango-workout-contact-pose.mjs')).href);
const { WORKOUT_CONTACT_ID: ID, WORKOUT_CONTACT_KEYS: KEYS, workoutContactSpriteKeys: keys,
  workoutSourceContactPoseEligible: eligible, applyWorkoutSourceContactPose: apply } = helper;
const assetDir = path.join(packageRoot, 'assets/companion/dango/raster/action-contact', ID);
const entries = JSON.parse(fs.readFileSync(path.join(assetDir, 'source-spec.json'), 'utf8'));
const backend = createRequire(path.join(root, 'package.json'))('@napi-rs/canvas');
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = () => {
  const m = structuredClone(DANGO_RASTER);
  if (packageRoot !== root) Object.assign(m.tools, structuredClone(entries));
  return m;
};
const options = (p = .25, patch = {}) => ({ action: { ...PET_ACTIONS.workout }, motion: 'pushup', view: 'front',
  progress: p, elapsedMs: p * 8500, state: 'idle', actionInstanceKey: 'workout-contract', channel: 'pet', ...patch });
const pose = (m = manifest(), o = options()) => sampleRasterPose(m.views.front, { ...o,
  toolSprites: Object.fromEntries(Object.entries(m.tools).map(([k, v]) => [k,
    { width: v.rect[2], height: v.rect[3], anchors: v.anchors }])) });
const freeze = v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const mutate = v => Array.isArray(v) ? v.map((n, i) => i ? n : n + 1)
  : typeof v === 'boolean' ? !v : typeof v === 'number' ? v + 1 : '__changed__';

function rejected(m, p, o, view = 'front') {
  const snapshot = structuredClone({ m, p, o });
  assert.equal(eligible(m, p, view, o), false);
  if (view === 'front') assert.equal(apply(m, p, o), p);
  assert.deepEqual({ m, p, o }, snapshot);
}

test('two immutable support keys and source contracts are complete', () => {
  assert.equal(ID, 'workout-front-support-v4');
  assert.deepEqual(keys(), [KEYS.left, KEYS.right]);
  const edited = keys(); edited.pop(); assert.equal(keys().length, 2);
  for (const phase of [0, .25, .3125, 1]) {
    const m = manifest(), o = options(phase); assert.equal(eligible(m, pose(m, o), 'front', o), true);
  }
});

test('frozen original body, feet, face, headband and context accessories are retained', () => {
  const m = manifest(), o = options(.3125), p = pose(m, o);
  const accessory = { key: 'context-accessory-sentinel', x: 2, y: 3, contextAccessory: true };
  p.contact.tools.push(accessory); freeze(m); freeze(p); freeze(o);
  const before = structuredClone({ m, p, o }), r = apply(m, p, o);
  assert.equal(r.sourceContactPose, ID); assert.equal(r.matrices, p.matrices); assert.equal(r.face, p.face);
  assert.equal(r.contact.details, p.contact.details); assert.equal(r.contact.tools[0], accessory);
  assert.equal(r.contact.phase, p.contact.phase); assert.equal(r.contact.layer, p.contact.layer);
  assert.equal(r.contact.hands.length, 2); assert.equal(r.contact.tools.length, p.contact.tools.length + 2);
  for (const [side, x] of [['left', 6.5], ['right', 59.5]]) {
    const h = r.contact.hands.find(h => h.side === side), old = p.contact.hands.find(h => h.side === side);
    const t = r.contact.tools.find(t => t.key === KEYS[side]);
    assert.deepEqual(h.gripPoint, [x, 61.75]); assert.deepEqual(h.legacyGripPoint, old.points.at(-1));
    assert.equal(h.points[0], old.points[0]); assert.equal(h.layer, 'back');
    assert.equal(h.pawSprite, undefined); assert.equal(h.pawMatrix, undefined);
    assert.equal(h.sourceContact.kind, 'planted-support'); assert.equal(h.sourceContact.depth, 'behind-body');
    assert.equal(h.connector, false); assert.equal(h.attachedArm, false); assert.equal(h.integrated, false); assert.equal(h.limb, false);
    assert.deepEqual([t.x, t.y], [0, -2.25]); assert.equal(t.layer, 'back'); assert.equal(t.coversPaw, side);
    assert.equal(t.sourceContact, h.sourceContact); assert.equal(t.opacity, 1);
  }
  assert.deepEqual({ m, p, o }, before); assert.equal(apply(m, r, o), r, 'idempotent with no duplicate back tools');
});

test('every source metadata field and all source transforms fail closed', async t => {
  for (const key of keys()) {
    for (const [field, value] of Object.entries(entries[key].sourceContactPose)) for (const mode of ['missing', 'changed']) {
      await t.test(`${key}.${field}.${mode}`, () => {
        const m = manifest(), o = options(), p = pose(m, o);
        if (mode === 'missing') delete m.tools[key].sourceContactPose[field];
        else m.tools[key].sourceContactPose[field] = mutate(value);
        rejected(m, p, o);
      });
    }
    for (const [field, value] of [['src', 'tools/cup.png'], ['rect', [0, 0, 90, 81]], ['tint', 'none'],
      ['matrix', [1, 0, 0, 1, 0, 0]], ['transform', {}], ['flip', true], ['scale', 2],
      ['rotate', .1], ['rotation', .1], ['pivot', [0, 0]]]) await t.test(`${key}.${field}`, () => {
      const m = manifest(), o = options(), p = pose(m, o); m.tools[key][field] = value; rejected(m, p, o);
    });
    const m = manifest(), o = options(), p = pose(m, o); delete m.tools[key]; rejected(m, p, o);
  }
});

test('unsupported actions, views, transforms, ground disagreement and changed canonical parts fall back', () => {
  for (const patch of [{ action: { ...PET_ACTIONS.workout, id: 'wave' } }, { action: { ...PET_ACTIONS.workout, prop: 'cup' } },
    { action: { ...PET_ACTIONS.workout, motion: 'hop' } }, { state: 'dragged' }, { transform: {} },
    { matrix: [1, 0, 0, 1, 0, 0] }, { progress: NaN }, { motion: 'hop' },
    { action: { ...PET_ACTIONS.workout, propOpacity: 1.1 } }, { action: { ...PET_ACTIONS.workout, handoffRecovery: -1 } }]) {
    const m = manifest(), o = options(.25, patch); rejected(m, pose(m, options()), o);
  }
  for (const view of ['three-quarter', 'back', 'profile']) {
    const m = manifest(), o = options(); rejected(m, pose(m, o), o, view);
  }
  for (const edit of [p => p.contact.hands.pop(), p => p.contact.hands[1].side = 'left',
    p => p.contact.hands[0].points[2][0] += 1, p => p.contact.hands[0].points[0][0] += 1,
    p => p.contact.hands[0].pawMatrix[5] += 1, p => p.matrices['foot-right'] = [1, 0, 0, 1, 0, 1],
    p => p.contact.tools.push({ key: 'cup' }), p => p.contact.layer = 'back', p => p.contact.phase = NaN,
    p => p.contact.hands[0].opacity = -1]) {
    const m = manifest(), o = options(), p = structuredClone(pose(m, o)); edit(p); rejected(m, p, o);
  }
  for (const edit of [m => m.views.front.body.rect[0] += 1, m => m.views.front.body.src = 'views/back/body.png',
    m => m.views.front.body.matrix = [1, 0, 0, 1, 0, 0], m => m.views.front.parts['foot-left'].rect[3] += 1,
    m => m.views.front.parts['foot-right'].src = 'views/back/foot-right.png']) {
    const m = manifest(), o = options(), p = pose(m, o); edit(m); rejected(m, p, o);
  }
});

test('calm and reduced motion use the original sampled ground compensation', () => {
  for (const flag of ['calmVisual', 'reducedMotion']) {
    const m = manifest(), o = options(.3125, { [flag]: true }), p = pose(m, o), r = apply(m, p, o);
    assert.equal(r.sourceContactPose, ID); assert.equal(r.matrices, p.matrices); assert.equal(r.face, p.face);
    for (const h of r.contact.hands) {
      assert.equal(h.sourceContact.groundShift, 0); assert.equal(h.gripPoint[1], 64);
    }
  }
});

test('real action painter draws two back tools, no legacy support paws or generic short hands', () => {
  for (const propOpacity of [0, .3, 1]) for (const phase of [.25, .3125]) {
    const m = manifest(), o = options(phase, { action: { ...PET_ACTIONS.workout, propOpacity } });
    const p = pose(m, o); p.contact.hands.forEach(h => h.opacity = .6);
    const r = { ...apply(m, p, o), layeredReady: true, actionReady: true, data: m.views.front, hiddenParts: [] };
    const drawn = [], painter = { paint(ctx, sprite, palette, matrix, opacity = 1) {
      if (opacity <= 0) return false; drawn.push({ src: sprite.src, matrix, opacity }); return true;
    } };
    const context = backend.createCanvas(1, 1).getContext('2d');
    drawRasterActions(context, { ...o, artwork: r, layer: 'back', palette: PALETTES.pink }, { manifest: m, painter });
    const backCount = drawn.length;
    drawRasterActions(context, { ...o, artwork: r, layer: 'front', palette: PALETTES.pink }, { manifest: m, painter });
    const arms = drawn.filter(d => d.src.includes(`/${ID}/`));
    assert.equal(arms.length, propOpacity ? 2 : 0);
    if (propOpacity) for (const arm of arms) {
      assert.ok(drawn.indexOf(arm) < backCount); assert.equal(arm.opacity, .6 * propOpacity);
      assert.deepEqual(arm.matrix, [1, 0, 0, 1, 0, -(64 - p.contact.hands[0].points.at(-1)[1])]);
    }
    for (const original of ['support-paw', 'hand-left', 'hand-right']) {
      const src = original === 'support-paw' ? m.tools[original].src : m.views.front.parts[original].src;
      assert.equal(drawn.filter(d => d.src === src).length, 0, `${original} must not draw a duplicate`);
    }
    for (const side of ['left', 'right']) assert.equal(drawn.filter(d => d.src === m.views.front.parts[`foot-${side}`].src).length, 1);
  }
});

test('runtime files have pinned hashes, exact NN8x, four colors, binary alpha and one-art contact', async () => {
  const allowed = new Set(['26,27,38', '240,80,104', '248,104,120', '248,128,128']);
  for (const side of ['left', 'right']) {
    const c = entries[KEYS[side]].sourceContactPose;
    const raw = fs.readFileSync(path.join(assetDir, `${side}-8x.png`));
    const logical = fs.readFileSync(path.join(assetDir, `${side}-logical.png`));
    assert.equal(hash(raw), c.sourceSha256); assert.equal(hash(logical), c.logicalSha256);
    const images = await Promise.all([backend.loadImage(logical), backend.loadImage(raw)]);
    const pixels = images.map(im => { const cv = backend.createCanvas(im.width, im.height), cx = cv.getContext('2d'); cx.drawImage(im, 0, 0); return cx.getImageData(0, 0, im.width, im.height).data; });
    assert.deepEqual(images.map(im => [im.width, im.height]), [[90, 81], [720, 648]]);
    let count = 0, lastY = -1;
    for (let y = 0; y < 81; y++) for (let x = 0; x < 90; x++) {
      const i = (y * 90 + x) * 4, cell = [...pixels[0].slice(i, i + 4)];
      assert.ok(cell[3] === 0 || cell[3] === 255);
      if (cell[3]) { count++; lastY = y; assert.ok(allowed.has(cell.slice(0, 3).join(','))); }
      else assert.deepEqual(cell, [0, 0, 0, 0]);
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) {
        const j = ((y * 8 + dy) * 720 + x * 8 + dx) * 4;
        assert.deepEqual([...pixels[1].slice(j, j + 4)], cell);
      }
    }
    assert.equal(count, c.opaqueCells); assert.equal(lastY - 1 + 1, 64);
  }
});
