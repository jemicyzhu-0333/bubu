import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DANGO_RASTER } from '../assets/companion/dango/raster/dango.raster.mjs';
import { createSourceContactPoseSelector } from '../src/capabilities/companion/presentation/dango-source-contact-pose.mjs';
import { SIP_SHORT_CONTACT_ID, sipShortContactSpriteKeys, sipShortSourceContactPoseEligible,
  sipShortSourceOpacity } from '../src/capabilities/companion/presentation/dango-sip-short-contact-pose.mjs';
import { sipContactSpriteKeys } from '../src/capabilities/companion/presentation/dango-sip-contact-pose.mjs';
import { contactContract } from '../src/capabilities/companion/presentation/dango-limb-compose.mjs';
import { smooth } from '../src/capabilities/companion/presentation/motion-core/easing.mjs';

const keys = sipShortContactSpriteKeys();
const opts = { action: { id: 'sip-tea', motion: 'sip', prop: 'cup' }, motion: 'sip', progress: .5, elapsedMs: 4500 };
function enabled() {
  const m = structuredClone(DANGO_RASTER);
  for (const key of keys) m.tools[key].sourceContactPose.runtimeReady = true;
  return m;
}
const pose = (x = 23, y = 43) => ({ contact: { tools: [{ key: 'cup', x, y }], details: [{ type: 'steam', opacity: .6 }],
  hands: ['left', 'right'].map(side => ({ side, points: [[0, 0], [1, 1], [2, 2]], opacity: .8 })) } });
const selector = (manifest = enabled(), state = () => 'ready') => createSourceContactPoseSelector({ manifest, source: { state } });
const hash = src => createHash('sha256').update(readFileSync(new URL(src, DANGO_RASTER.baseUrl))).digest('hex');

test('production short source is enabled and preserves canonical body, preferred PNGs and historical metadata', () => {
  assert.equal(keys.length, 2);
  for (const key of keys) {
    const s = DANGO_RASTER.tools[key], c = s.sourceContactPose;
    assert.equal(c.runtimeReady, true); assert.equal(c.layer, 'front');
    assert.equal(c.sourceSha256, hash(s.src)); assert.equal(c.bodySha256, hash(DANGO_RASTER.views.front.body.src));
    assert.equal(c.fixedShoulder, undefined); assert.equal(c.bodyRegistration, undefined);
  }
  assert.equal(hash('action-contact/sip-front-v1/frames.json'), '671bd615b012fd411fb142a4d30cbdd75ffb986bd58dfb5016dd7d5e5b7098f9');
  assert.equal(sipShortSourceContactPoseEligible(DANGO_RASTER, pose(), 'front', opts), true);
  assert.equal(selector(DANGO_RASTER).apply(pose(), 'front', opts).sourceContactPose, SIP_SHORT_CONTACT_ID);
  for (const key of sipContactSpriteKeys()) assert.equal(DANGO_RASTER.tools[key].sourceContactPose.runtimeReady, false);
  const disabled = structuredClone(DANGO_RASTER);
  for (const key of keys) disabled.tools[key].sourceContactPose.runtimeReady = false;
  assert.equal(sipShortSourceContactPoseEligible(disabled, pose(), 'front', opts), false);
});

test('two foreground source palms follow only actual cup translation and preserve all other sampled fields', () => {
  const p = pose(24.421795, 36.028846), input = structuredClone(p), r = selector().apply(p, 'front', opts);
  assert.equal(r.sourceContactPose, SIP_SHORT_CONTACT_ID);
  assert.equal(r.contact.tools, p.contact.tools); assert.equal(r.contact.details, p.contact.details);
  assert.deepEqual(p, input); assert.equal(r.contact.tools.length, 1, 'no invented back layer');
  const delta = [p.contact.tools[0].x - 23, p.contact.tools[0].y - 43];
  for (const h of r.contact.hands) {
    const left = h.side === 'left', target = [(left ? 24.25 : 40.25) + delta[0], 53.375 + delta[1]];
    assert.equal(h.opacity, .8); assert.deepEqual(h.pawMatrix, [1, 0, 0, 1, ...delta]);
    assert.deepEqual(h.gripPoint, target); assert.deepEqual(h.legacyGripPoint, [2, 2]);
    assert.equal(h.wrist, undefined); assert.equal(h.connector, false); assert.equal(h.attachedArm, false);
    assert.equal(h.integrated, false); assert.equal(h.limb, false);
    const contract = contactContract(h, opts.action);
    assert.equal(contract.role, 'continuous-hold'); assert.equal(contract.sourcePoseId, SIP_SHORT_CONTACT_ID);
    assert.deepEqual(contract.target, target); assert.deepEqual(contract.normal, [left ? 1 : -1, 0]);
    assert.equal(contract.legacyHandleAxisSatisfied, left ? null : false);
  }
});

test('ordinary source envelope fades cup, details and original hand opacity together without moving them', () => {
  const p = pose();
  for (const [progress, opacity] of [[0, 0], [.02, .5], [.04, 1], [.5, 1], [.96, 1], [.98, .5], [1, 0]]) {
    const o = { ...opts, progress }, r = selector().apply(p, 'front', o);
    assert.ok(Math.abs(sipShortSourceOpacity(o) - opacity) < 1e-12);
    assert.ok(Math.abs((r.contact.tools[0].opacity ?? 1) - opacity) < 1e-12);
    assert.ok(Math.abs(r.contact.details[0].opacity - .6 * opacity) < 1e-12);
    for (const h of r.contact.hands) assert.ok(Math.abs(h.opacity - .8 * opacity) < 1e-12);
    assert.deepEqual([r.contact.tools[0].x, r.contact.tools[0].y], [23, 43]);
    assert.deepEqual(r.contact.hands[0].pawMatrix, [1, 0, 0, 1, 0, 0]);
  }
  assert.deepEqual(p, pose());
  for (const flag of ['calmVisual', 'reducedMotion']) for (const progress of [0, .5, 1]) {
    assert.equal(sipShortSourceOpacity({ ...opts, [flag]: true, progress }), 1);
    assert.equal(sipShortSourceOpacity({ ...opts, [flag]: true, progress, action: { ...opts.action, staticProgress: 0 } }), 0);
  }
});

test('finite recovery keeps the same source through lowering and zero visibility, with original hand opacity', () => {
  const s = selector();
  for (let i = 0; i <= 256; i++) {
    const recovery = i / 256, drop = 5 * smooth(recovery / .6);
    const p = pose(23, 43 + drop), o = { ...opts, progress: .8 + recovery * .2, elapsedMs: 7200 + recovery * 1800,
      action: { ...opts.action, handoffRecovery: recovery, propOpacity: 1 - recovery } };
    p.contact.hands.forEach(h => h.opacity = 1 - smooth((recovery - .7) / .3));
    assert.equal(sipShortSourceContactPoseEligible(enabled(), p, 'front', o), true);
    const r = s.apply(p, 'front', o);
    assert.equal(r.sourceContactPose, SIP_SHORT_CONTACT_ID); assert.equal(r.contact.tools, p.contact.tools);
    assert.equal(r.contact.details, p.contact.details); assert.equal(sipShortSourceOpacity(o), 1);
    for (let j = 0; j < 2; j++) {
      assert.equal(r.contact.hands[j].opacity, p.contact.hands[j].opacity);
      assert.deepEqual(r.contact.hands[j].pawMatrix, [1, 0, 0, 1, 0, p.contact.tools[0].y - 43]);
    }
  }
});

test('unreviewed action, view, outfit, transform, cup geometry and malformed recovery fail closed', () => {
  for (const change of [o => o.action.id = 'hiccup', o => o.action.motion = 'idle', o => o.action.prop = 'book',
    o => o.action.propOpacity = .9, o => o.action.handoffRecovery = true,
    o => o.transform = [1, 0, 0, 1, 0, 0],
    o => o.matrix = [1, 0, 0, 1, 0, 0], o => o.state = 'dragged']) {
    const o = structuredClone(opts); change(o); assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(), 'front', o), false);
  }
  // Worn accessories keep the short-arm pair (same paw pass as legacy paws).
  assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(), 'front', { ...opts, appearance: { items: [{ id: 'hat' }] } }), true);
  const withAccessory = pose(); withAccessory.contact.tools.push({ key: 'scarf-tail', contextAccessory: true });
  assert.equal(sipShortSourceContactPoseEligible(enabled(), withAccessory, 'front', opts), true);
  for (const view of ['back', 'three-quarter', 'three-quarter-left', 'three-quarter-right', 'profile']) {
    assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(), view, opts), false);
  }
  for (const change of [p => p.contact.tools[0].x = 25, p => p.contact.tools[0].y = 48, p => p.contact.tools[0].y = 35,
    p => p.contact.tools[0].x = NaN, p => p.contact.tools[0].scale = .9, p => p.contact.tools[0].rotate = .1,
    p => p.contact.tools[0].flip = true, p => p.contact.tools[0].matrix = [1, 0, 0, 1, 0, 0],
    p => p.contact.tools[0].coversPaw = 'left', p => p.contact.tools[0].opacity = .9,
    p => p.contact.tools.push({ key: 'other' }), p => p.contact.hands.pop()]) {
    const p = pose(); change(p); assert.equal(sipShortSourceContactPoseEligible(enabled(), p, 'front', opts), false);
  }
  for (const value of [undefined, null, true, '0.5', -.1, 1.1, NaN, Infinity]) {
    if (value !== undefined) assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(), 'front',
      { ...opts, action: { ...opts.action, handoffRecovery: value, propOpacity: 1 } }), false);
    assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(), 'front',
      { ...opts, action: { ...opts.action, handoffRecovery: 0, propOpacity: value } }), false);
  }
  assert.equal(sipShortSourceContactPoseEligible(enabled(), pose(23, 48), 'front',
    { ...opts, action: { ...opts.action, handoffRecovery: .1, propOpacity: .9 } }), false, 'not a blanket widened cup range');
});

test('each source binds the fixed PNG, body, dimensions, layer, boundary and normal', () => {
  for (const key of keys) for (const change of [s => s.sourceContactPose.runtimeReady = false,
    s => s.sourceContactPose.contractVersion++, s => s.sourceContactPose.bodySha256 = 'wrong',
    s => s.sourceContactPose.bodyRect[0]++, s => s.sourceContactPose.sourceSha256 = 'wrong',
    s => s.sourceContactPose.boundary[0]++, s => s.sourceContactPose.normal[0] *= -1,
    s => s.sourceContactPose.layer = 'back', s => s.sourceContactPose.quantizedOnce = false,
    s => s.sourceContactPose.translationOnly = false, s => s.rect[2]++, s => s.tint = 'none', s => s.src = 'other.png']) {
    const m = enabled(); change(m.tools[key]); assert.equal(sipShortSourceContactPoseEligible(m, pose(), 'front', opts), false, key);
  }
});

test('cold source readiness is atomic and stays locked across interleaved channels and sampled recovery fields', () => {
  let ready = false; const seen = [], s = selector(enabled(), sprite => { seen.push(sprite.src); return ready ? 'ready' : 'loading'; });
  const p = pose(), o = { ...opts, channel: 'pet' };
  assert.equal(s.apply(p, 'front', o), p); assert.equal(new Set(seen).size, 2);
  ready = true; s.apply({ contact: { tools: [], hands: [] } }, 'front', { channel: 'portrait' });
  for (let i = 0; i <= 10; i++) {
    const r = i / 10, next = pose(23, 43 + 5 * smooth(r / .6));
    assert.equal(s.apply(next, 'front', { ...o, progress: .6 + r * .4, elapsedMs: 5400 + r * 3600,
      action: { ...o.action, handoffRecovery: r, propOpacity: 1 - r } }), next);
  }
  assert.equal(s.apply(p, 'front', { ...o, progress: 0, elapsedMs: 0 }).sourceContactPose, SIP_SHORT_CONTACT_ID);
});

test('one-image failure or later cache loss disables both hands until a new explicit episode or reset', () => {
  for (const key of keys) {
    const m = enabled(); let lost = true;
    const s = selector(m, sprite => lost && sprite.src === m.tools[key].src ? 'failed' : 'ready');
    const p = pose(), o = { ...opts, actionInstanceKey: 'first' };
    assert.equal(s.apply(p, 'front', o), p);
    lost = false; assert.equal(s.apply(p, 'front', { ...o, progress: .6 }), p);
    const next = { ...o, actionInstanceKey: 'next' };
    assert.equal(s.apply(p, 'front', next).sourceContactPose, SIP_SHORT_CONTACT_ID);
    lost = true; assert.equal(s.apply(p, 'front', { ...next, progress: .7 }), p);
    lost = false; assert.equal(s.apply(p, 'front', { ...next, progress: .8 }), p);
    s.dispose(); assert.equal(s.apply(p, 'front', next).sourceContactPose, SIP_SHORT_CONTACT_ID);
  }
});

test('wrong view locks the bounded channel episode and switching source registrations cannot unlock it', () => {
  for (const extra of [{ view: 'back' }]) {
    const s = selector(), p = pose(), o = { ...opts, channel: 'pet', actionInstanceKey: 'first' };
    assert.equal(s.apply(p, extra.view || 'front', { ...o, ...extra }), p);
    for (let i = 0; i < 100; i++) s.apply(p, 'front', { ...o, channel: `gallery:${i}` });
    assert.equal(s.stats().channels, 16); assert.equal(s.apply(p, 'front', { ...o, progress: .7 }), p);
    assert.equal(s.apply(p, 'front', { ...o, channel: 'overflow' }), p);
    s.dispose(); assert.equal(s.stats().channels, 3);
  }
  const m = enabled(), s = selector(m), p = pose(), o = { ...opts, actionInstanceKey: 'fixed' };
  assert.equal(s.apply(p, 'front', o).sourceContactPose, SIP_SHORT_CONTACT_ID);
  for (const k of keys) m.tools[k].sourceContactPose.runtimeReady = false;
  for (const k of sipContactSpriteKeys()) m.tools[k].sourceContactPose.runtimeReady = true;
  assert.equal(s.apply(p, 'front', { ...o, progress: .7 }), p);
  assert.equal(s.apply(p, 'front', { ...o, actionInstanceKey: 'next' }).sourceContactPose, 'sip-front-v2');
});

test('competing enabled short and v2 registrations fail closed, including a partially enabled competing set', () => {
  for (const set of [sipContactSpriteKeys(), sipContactSpriteKeys().slice(0, 1)]) {
    const m = enabled(); for (const k of set) m.tools[k].sourceContactPose.runtimeReady = true;
    const p = pose(); assert.equal(selector(m).apply(p, 'front', opts), p);
  }
});
