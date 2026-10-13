import test from 'node:test';
import assert from 'node:assert/strict';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createSourceContactPoseSelector } from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import { sipSourceContactPoseEligible, sipContactSpriteKeys } from '../src/capabilities/companion/presentation/dango-sip-contact-pose.mjs';
import { contactContract } from '../src/capabilities/companion/presentation/dango-limb-compose.mjs';

const keys = sipContactSpriteKeys();
const opts = { action: { id: 'sip-tea', motion: 'sip', prop: 'cup' }, motion: 'sip', progress: 0, elapsedMs: 0 };
function enabled() {
  const m = structuredClone(DANGO_RASTER);
  for (const key of keys) m.tools[key].sourceContactPose.runtimeReady = true;
  return m;
}
const pose = (x = 23, y = 43) => ({ contact: { tools: [{ key: 'cup', x, y }], details: [{ type: 'steam' }],
  hands: ['left', 'right'].map(side => ({ side, points: [[0, 0], [1, 1], [2, 2]], opacity: 1 })) } });
const selector = (manifest = enabled(), state = () => 'ready') => createSourceContactPoseSelector({ manifest, source: { state } });

test('sip source delivery remains disabled in production and never opens the generic rig', () => {
  assert.equal(keys.length, 4);
  for (const key of keys) assert.equal(DANGO_RASTER.tools[key].sourceContactPose.runtimeReady, false);
  assert.equal(sipSourceContactPoseEligible(DANGO_RASTER, pose(), 'front', opts), false);
});
test('four ready layers select atomically while preserving the original cup, details and input', () => {
  const p = pose(), s = selector(), r = s.apply(p, 'front', opts);
  assert.equal(r.sourceContactPose, 'sip-front-v2');
  assert.equal(r.contact.tools[0], p.contact.tools[0]);
  assert.equal(r.contact.details, p.contact.details);
  assert.equal(p.contact.tools.length, 1);
  assert.equal(p.contact.hands[0].pawSprite, undefined);
  assert.deepEqual(r.contact.tools.slice(1).map(t => [t.layer, t.x, t.y, t.bodyColor]), [['back', 0, 0, true], ['back', 0, 0, true]]);
  for (const h of r.contact.hands) {
    assert.equal(h.limb, false); assert.equal(h.connector, false); assert.equal(h.attachedArm, false);
    assert.equal(h.integrated, false); assert.deepEqual(h.pawMatrix, [1, 0, 0, 1, 0, 0]);
  }
});
test('one unchanged source pose follows the actual cup translation without an invented wrist', () => {
  const p = pose(24.421795, 36.028846), r = selector().apply(p, 'front', { ...opts, progress: .5 });
  const dx = p.contact.tools[0].x - 23, dy = p.contact.tools[0].y - 43;
  for (const h of r.contact.hands) {
    const left = h.side === 'left', expected = [(left ? 24.25 : 40.25) + dx, 53.375 + dy];
    assert.deepEqual(h.gripPoint, expected); assert.deepEqual(h.legacyGripPoint, [2, 2]);
    assert.deepEqual(h.pawMatrix, [1, 0, 0, 1, dx, dy]); assert.equal(h.wrist, undefined);
    const c = contactContract(h, opts.action);
    assert.equal(c.role, 'continuous-hold'); assert.deepEqual(c.target, expected);
    assert.deepEqual(c.normal, [left ? 1 : -1, 0]); assert.equal(c.sourcePoseId, 'sip-front-v2');
    assert.equal(c.legacyHandleAxisSatisfied, left ? null : false);
  }
  for (const t of r.contact.tools.slice(1)) assert.deepEqual([t.x, t.y], [dx, dy]);
});
test('unreviewed action, view, outfit, transformations and prop changes fail closed', () => {
  for (const change of [o => o.action.id = 'hiccup', o => o.action.motion = 'idle', o => o.action.prop = 'book',
    o => o.action.propOpacity = .9, o => o.action.handoffRecovery = true, o => o.appearance = { items: [{ id: 'hat' }] },
    o => o.transform = [1, 0, 0, 1, 0, 0], o => o.matrix = [1, 0, 0, 1, 0, 0], o => o.state = 'dragged']) {
    const o = structuredClone(opts); change(o); assert.equal(sipSourceContactPoseEligible(enabled(), pose(), 'front', o), false);
  }
  for (const view of ['back', 'three-quarter', 'three-quarter-right']) assert.equal(sipSourceContactPoseEligible(enabled(), pose(), view, opts), false);
  for (const change of [p => p.contact.tools[0].x = 25, p => p.contact.tools[0].y = 35, p => p.contact.tools[0].x = NaN,
    p => p.contact.tools[0].scale = .9, p => p.contact.tools[0].rotate = .1, p => p.contact.tools[0].flip = true,
    p => p.contact.tools[0].coversPaw = 'left', p => p.contact.tools.push({ key: 'other' }), p => p.contact.hands.pop()]) {
    const p = pose(); change(p); assert.equal(sipSourceContactPoseEligible(enabled(), p, 'front', opts), false);
  }
});
test('each layer is bound to the body, actual registration, depth split, target and normal', () => {
  for (const key of keys) for (const change of [s => s.sourceContactPose.runtimeReady = false,
    s => s.sourceContactPose.contractVersion++, s => s.sourceContactPose.bodySha256 = 'wrong',
    s => s.sourceContactPose.bodyRegistration.fixedShoulder[0]++, s => s.sourceContactPose.boundary[0]++,
    s => s.sourceContactPose.normal[0] *= -1, s => s.sourceContactPose.depthSourceY++,
    s => s.sourceContactPose.layer = 'wrong', s => s.sourceContactPose.quantizedOnce = false,
    s => s.sourceContactPose.translationOnly = false, s => s.rect[2]++, s => s.tint = 'none']) {
    const m = enabled(); change(m.tools[key]); assert.equal(sipSourceContactPoseEligible(m, pose(), 'front', opts), false, key);
  }
});
test('late readiness cannot enable part of a live instance; a new explicit instance can retry', () => {
  let ready = false; const seen = [], s = selector(enabled(), sprite => { seen.push(sprite.src); return ready ? 'ready' : 'loading'; });
  const p = pose(), o = { ...opts, channel: 'pet', actionInstanceKey: 'first' };
  assert.equal(s.apply(p, 'front', o), p); assert.equal(new Set(seen).size, 4);
  ready = true; assert.equal(s.apply(p, 'front', { ...o, progress: .5 }), p);
  s.apply({ contact: { tools: [], hands: [] } }, 'front', { channel: 'portrait' });
  assert.equal(s.apply(p, 'front', { ...o, progress: .6 }), p);
  assert.equal(s.apply(p, 'front', { ...o, actionInstanceKey: 'next' }).sourceContactPose, 'sip-front-v2');
});
test('loss of any single layer disables both hands and both roots until next instance', () => {
  for (const key of keys) {
    const m = enabled(); let lost = false;
    const s = selector(m, sprite => lost && sprite.src === m.tools[key].src ? 'failed' : 'ready');
    const p = pose(), o = { ...opts, actionInstanceKey: 'first' };
    assert.equal(s.apply(p, 'front', o).sourceContactPose, 'sip-front-v2');
    lost = true; assert.equal(s.apply(p, 'front', { ...o, progress: .3 }), p);
    lost = false; assert.equal(s.apply(p, 'front', { ...o, progress: .6 }), p);
    assert.equal(s.apply(p, 'front', { ...o, actionInstanceKey: 'next' }).sourceContactPose, 'sip-front-v2');
  }
});
test('changed view or outfit locks fallback and channel pressure never re-enables a live window', () => {
  const s = selector(), p = pose(), o = { ...opts, channel: 'pet', actionInstanceKey: 'first' };
  assert.equal(s.apply(p, 'three-quarter', o), p);
  for (let i = 0; i < 100; i++) s.apply(p, 'front', { ...o, channel: `gallery:${i}` });
  assert.equal(s.stats().channels, 16); assert.equal(s.apply(p, 'front', { ...o, progress: .5 }), p);
  assert.equal(s.apply(p, 'front', { ...o, channel: 'overflow' }), p);
  s.dispose(); assert.equal(s.stats().channels, 3);
});
