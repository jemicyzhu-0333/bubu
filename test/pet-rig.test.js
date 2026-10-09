'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { validateRig, resolveRigView, rigCacheKey } = require('../src/capabilities/companion/presentation/rig/schema.mjs');
const { computeBoneWorld, applyPoint, localMatrix } = require('../src/capabilities/companion/presentation/rig/pose.mjs');
const { sampleMotion, idleProgress } = require('../src/capabilities/companion/presentation/rig/motions.mjs');
const { resolveRigFace } = require('../src/capabilities/companion/presentation/rig/face.mjs');
const { createRigSource } = require('../src/capabilities/companion/presentation/rig/source.mjs');
const { createRigArtist } = require('../src/capabilities/companion/presentation/rig/rig-art.mjs');
const { createPathCache } = require('../src/capabilities/companion/presentation/rig/paint.mjs');
const { compileRig } = require('../tools/rig-build/build.mjs');
const vectorArt = require('../src/capabilities/companion/presentation/usagi-support.mjs').default;
const usagiArt = require('../src/capabilities/companion/presentation/usagi-art.mjs').default;
const art = require('../src/capabilities/companion/presentation/form-art.mjs');
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const { resolvePetStage } = require('../src/core/pet-stage.mjs');
const { createRendererModuleLoader } = require('../test-support/renderer-modules');

const ROOT = path.resolve(__dirname, '..');
const SPROUT = fs.readFileSync(path.join(ROOT, 'tools/rig-build/examples/sprout.rig.svg'), 'utf8');
const sprout = compileRig(SPROUT).doc;
const usagi = PET_FORMS.usagi;

function recorder() {
  const calls = [];
  const record = name => (...args) => calls.push([name, ...args]);
  const context = { calls, globalAlpha: 1 };
  for (const name of ['save', 'restore', 'transform', 'translate', 'scale', 'rotate', 'setTransform',
    'clearRect', 'fill', 'stroke', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo',
    'bezierCurveTo', 'fillText', 'drawImage', 'fillRect']) context[name] = record(name);
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'font']) {
    Object.defineProperty(context, name, { set: value => calls.push([name, value]) });
  }
  return context;
}

const fakePaths = () => createPathCache({ createPath: d => ({ d }) });
const filled = ctx => ctx.calls.filter(([kind]) => kind === 'fill').map(([, p]) => p.d);
const rigOf = doc => validateRig(doc).rig;

test('the committed Usagi 2.0 rig is complete, without reviving retired art when Canvas Path2D is unavailable', async () => {
  const bundled = await import(pathToFileURL(path.join(ROOT, 'assets/companion/usagi/rig/usagi.rig.mjs')).href);
  assert.equal(validateRig(bundled.default).ok, true);
  assert.equal(bundled.default.id, 'usagi-v2');
  assert.equal(Object.keys(bundled.default.views).length, 4);
  assert.equal(usagiArt.describeRig().state, 'unsupported');
  assert.equal(usagiArt.resolveArtwork({ view: 'front' }), null, 'Node without Path2D does not substitute another identity');
  const loaded = createRendererModuleLoader(vm.createContext({ URL }))(
    path.join(ROOT, 'src/capabilities/companion/presentation/usagi-art.mjs'));
  assert.equal(typeof loaded.default.resolveArtwork, 'function', 'the renderer loader resolves the assets import');
});

test('the validator accepts the compiled demo and rejects unsafe or broken documents', () => {
  const ok = validateRig(sprout);
  assert.equal(ok.ok, true, ok.errors.join('\n'));
  assert.equal(rigCacheKey(ok.rig), 'rig:sprout@1');
  const broken = structuredClone(sprout);
  broken.views.front.parts[0].shapes[0].d = 'M0 0 L10 10"/><script>';
  broken.views.front.parts[1].shapes[0].fill = 'url(javascript:alert(1))';
  broken.views.front.bones.arm_r.parent = 'nowhere';
  const result = validateRig(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /plain SVG path data/.test(error)));
  assert.ok(result.errors.some(error => /bad color/.test(error)));
  assert.ok(result.errors.some(error => /unknown parent/.test(error)));
  const cyclic = structuredClone(sprout);
  cyclic.views.front.bones.body.parent = 'hand_r';
  assert.ok(validateRig(cyclic).errors.some(error => /cycle/.test(error)));
  assert.equal(validateRig({ ...sprout, views: { back: sprout.views.back } }).ok, false, 'front is required');
  assert.equal(validateRig({ ...sprout, formatVersion: 2 }).ok, false);
});

test('undrawn views borrow the nearest drawn silhouette', () => {
  const rig = rigOf(sprout);
  assert.deepEqual(['front', 'three-quarter', 'profile', 'back'].map(view => resolveRigView(rig, view).view),
    ['front', 'profile', 'profile', 'back']);
  const frontOnly = rigOf({ ...sprout, views: { front: sprout.views.front } });
  assert.equal(resolveRigView(frontOnly, 'back').view, 'front');
  assert.equal(resolveRigView(frontOnly, 'back').exact, false);
});

test('bones rotate about their pivot and children inherit the parent transform', () => {
  const bones = {
    root: { parent: null, pivot: [33, 64] },
    arm: { parent: 'root', pivot: [54, 41] },
    hand: { parent: 'arm', pivot: [57, 48] }
  };
  const world = computeBoneWorld(bones, { arm: { r: Math.PI / 2 } });
  assert.deepEqual(applyPoint(world.arm, 54, 41).map(v => Math.round(v * 1000) / 1000), [54, 41]);
  const [hx, hy] = applyPoint(world.hand, 57, 48);
  assert.ok(Math.abs(hx - 47) < 1e-9 && Math.abs(hy - 44) < 1e-9, 'the hand swings with its arm');
  const wild = localMatrix([0, 0], { x: 500, sx: 9 });
  assert.equal(wild[4], 24, 'travel is bounded');
  assert.equal(wild[0], 1.6, 'scale is bounded');
});

test('motions sample keyframes, honour view overrides and hold still for calm visuals', () => {
  const front = sampleMotion('sip', { view: 'front', progress: 0.5 });
  const profile = sampleMotion('sip', { view: 'profile', progress: 0.5 });
  assert.equal(front.key, 'sip');
  assert.equal(profile.key, 'sip@profile');
  assert.ok(front.bones.arm_r.r > profile.bones.arm_r.r);
  assert.deepEqual(front.props, ['cup']);
  const calmA = sampleMotion('wave', { progress: 0.1, calmVisual: true });
  const calmB = sampleMotion('wave', { progress: 0.9, calmVisual: true });
  assert.deepEqual(calmA.bones, calmB.bones);
  assert.ok(calmA.bones.arm_r.r < -2, 'the calm pose still reads as a wave');
  assert.equal(sampleMotion('no-such-motion').motion, 'idle');
  assert.equal(idleProgress(4800), 0.5);
});

test('faces fall back to the nearest drawn state and report the requested eye mask', () => {
  const face = rigOf(sprout).views.profile.face;
  const sparkle = resolveRigFace(face, { eyes: 'sparkle', mouth: 'grin' });
  assert.equal(sparkle.eyes.state, 'neutral');
  assert.equal(sparkle.mouth.state, 'open');
  assert.equal(sparkle.mask, 'sparkle');
  const blink = resolveRigFace(face, { eyes: 'neutral' }, true);
  assert.equal(blink.eyes.state, 'closed');
  assert.equal(blink.mask, 'closed');
  assert.deepEqual(resolveRigFace(face, { eyeOffsetX: 9, eyeOffsetY: -9 }).gaze, { x: 2, y: -2 });
  assert.equal(resolveRigFace(null, {}), null);
});

test('the rig source validates once and steps aside without Path2D or for another form', () => {
  const ready = createRigSource(sprout, { form: 'usagi', canPaint: () => true });
  assert.equal(ready.get().id, 'sprout');
  assert.equal(ready.describe().state, 'ready');
  const headless = createRigSource(sprout, { form: 'usagi', canPaint: () => false });
  assert.equal(headless.get(), null);
  assert.equal(headless.describe().state, 'unsupported');
  assert.equal(createRigSource(sprout, { form: 'dango' }).describe().state, 'invalid');
  assert.equal(createRigSource({ format: 'nope' }).get(), null);
});

test('the body sprite holds only the static layer; a fitted portrait holds all three at rest', () => {
  const artist = createRigArtist({ fallback: vectorArt, paths: fakePaths() });
  const rig = rigOf(sprout);
  const artwork = artist.resolve(rig, { view: 'front' });
  const cached = recorder();
  artist.body(cached, {}, 'front', artwork);
  const portrait = recorder();
  artist.body(portrait, {}, 'front', artwork, { fit: true });
  const bodyShapes = rig.views.front.parts.filter(part => part.layer === 'body').flatMap(part => part.shapes);
  assert.equal(filled(cached).length, bodyShapes.filter(shape => shape.fill && shape.fill !== 'none').length);
  assert.ok(filled(portrait).length > filled(cached).length, 'ears, feet and hands appear in portraits');
  assert.ok(!cached.calls.some(([kind]) => kind === 'bezierCurveTo'), 'no vector body is painted underneath');
});

test('form-art keys the cache by rig version and paints the live layer even with no action', () => {
  const artist = createRigArtist({ fallback: vectorArt, paths: fakePaths() });
  const artwork = artist.resolve(rigOf(sprout), { view: 'front', motion: 'idle', elapsedMs: 800 });
  const key = art.bodySpriteKey(usagi, 'usagi', 'normal', 'front', false, artwork);
  assert.match(key, /\|rig:sprout@1$/);
  const stage = resolvePetStage({ devicePixelRatio: 2 });
  const context = recorder();
  // form-art routes to the usagi artist, which has no rig loaded in Node, so
  // exercise the rig artist through the same option bag form-art forwards.
  assert.equal(art.drawActionLayer(context, { form: usagi, action: null, motion: 'curious', progress: 0,
    palette: {}, layer: 'front', offX: 0, offY: 0, view: 'front', stage, artwork: { kind: 'none' } }), false);
  const live = recorder();
  assert.equal(artist.action(live, { artwork, layer: 'front', view: 'front', palette: {}, motion: null }), true);
  assert.ok(filled(live).length >= 2, 'both hands are painted at rest');
});

test('rig props are drawn from the rig; missing props do not revive old artwork', () => {
  const artist = createRigArtist({ fallback: vectorArt, paths: fakePaths() });
  const rig = rigOf(sprout);
  const front = recorder();
  artist.action(front, { artwork: artist.resolve(rig, { view: 'front', motion: 'read', progress: 0.5 }),
    motion: 'read', progress: 0.5, layer: 'front', view: 'front', palette: {}, form: usagi });
  const book = rig.views.front.props.book.shapes[0].d;
  assert.ok(filled(front).includes(book));
  assert.ok(!front.calls.some(([kind]) => kind === 'quadraticCurveTo'), 'no vector book on top');
  const side = recorder();
  artist.action(side, { artwork: artist.resolve(rig, { view: 'profile', motion: 'read', progress: 0.5 }),
    motion: 'read', progress: 0.5, layer: 'front', view: 'profile', palette: {}, form: usagi });
  assert.ok(!side.calls.some(([kind]) => kind === 'quadraticCurveTo'), 'no historical vector prop is substituted');
});

test('accessories follow their bone and gaze moves only the pupils', () => {
  const artist = createRigArtist({ fallback: vectorArt, paths: fakePaths() });
  const rig = rigOf(sprout);
  const artwork = artist.resolve(rig, { view: 'front', motion: 'curious', progress: 0.5 });
  const item = { renderKey: 'usagi-ear-bow', exclusiveGroup: 'usagi.earwear', parts: ['front'] };
  const context = recorder();
  assert.equal(artist.appearance(context, { item, layer: 'front', palette: {}, form: usagi, view: 'front', artwork }), true);
  const transform = context.calls.find(([kind]) => kind === 'transform');
  assert.deepEqual(transform.slice(1), artwork.pose.world.ear_r);
  assert.ok(Math.abs(transform[2]) > 0.1, 'the curious ear tilt rotates the bow');
  const translate = context.calls.find(([kind]) => kind === 'translate');
  assert.deepEqual(translate.slice(1), [44, -6], 'drawn at the rig anchor, not the form default');
  const face = recorder();
  const mask = artist.face(face, {}, { eyes: 'neutral', mouth: 'neutral', eyeOffsetX: 1.5, eyeOffsetY: 0 },
    false, 'front', usagi.faceRig, artwork);
  assert.equal(mask, 'neutral');
  assert.ok(face.calls.some(([kind, ...m]) => kind === 'transform' && m[4] === 1.5 && m[5] === 0));
  assert.equal(artist.face(recorder(), {}, {}, false, 'back', usagi.faceRig, artwork), 'back');
});
