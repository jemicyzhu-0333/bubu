import test from 'node:test';
import assert from 'node:assert/strict';
import rig from '../assets/companion/usagi/rig/usagi.rig.mjs';
import { MIRROR_ACTIVITIES } from '../src/content/session-activities.mjs';
import { USAGI_FORM } from '../src/content/companion/usagi-form.mjs';
import { PET_APPEARANCE_ITEMS } from '../src/content/appearance.mjs';
import { applyPoint } from '../src/capabilities/companion/presentation/rig/pose.mjs';
import { contactPawGeometry, integratedUsagiPaw } from '../src/capabilities/companion/presentation/usagi-contact-limbs.mjs';
import { sampleUsagiEventBody } from '../src/capabilities/companion/presentation/usagi-event-actions.mjs';
import { USAGI_EVENT_ROBOT_BOUNDS, sampleUsagiEventRobot, paintUsagiEventRobot } from '../src/capabilities/companion/presentation/usagi-event-robot.mjs';
import { resolveUsagiView } from '../src/capabilities/companion/presentation/usagi-view-policy.mjs';

globalThis.Path2D = class ResolutionPath { constructor(d) { this.d = d; } };
const { default: artist } = await import('../src/capabilities/companion/presentation/usagi-art.mjs');
const action = (id, extra = {}) => ({ ...MIRROR_ACTIVITIES[id], ...extra });
const at = (id, progress, view = 'front', options = {}) => artist.resolveArtwork({
  view, progress, action: action(id, options.action), motion: MIRROR_ACTIVITIES[id].motion,
  face: { eyes: 'neutral', mouth: 'neutral' }, ...options,
  ...(options.action ? { action: action(id, options.action) } : {})
});
function trace() {
  const calls = [];
  const context = new Proxy({ globalAlpha: 1 }, {
    get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  return { context, calls };
}

test('production Usagi wrapper keeps canonical rig and suppresses decorative music notes and AI dots', () => {
  const canonical = artist.resolveArtwork({ view: 'front', motion: 'idle' }).rig;
  for (const view of ['front', 'three-quarter']) {
    const music = at('mirror-music', .37, view), ai = at('mirror-ai', .37, view);
    assert.strictEqual(music.rig, canonical); assert.strictEqual(ai.rig, canonical);
    assert.deepEqual(music.pose.sample.props, []);
    assert.deepEqual(ai.pose.sample.props, ['laptop']);
    assert.equal(music.face.eyes, 'content'); assert.equal(ai.face.eyes, 'waiting');
    assert.equal(music.face.mouth, 'neutral'); assert.equal(ai.face.mouth, 'neutral');
    const { context, calls } = trace();
    artist.action(context, { artwork: music, layer: 'back', action: action('mirror-music'), palette: {} });
    artist.action(context, { artwork: music, layer: 'front', action: action('mirror-music'), palette: {} });
    assert.ok(calls.some(call => call[0] === 'ellipse'), 'actual production headset paint path runs');
  }
});

test('quiet AI wrists are integrated short paws and stable key contacts, not generic browse rails', () => {
  for (const view of ['front', 'three-quarter']) for (let i = 0; i <= 120; i++) {
    const artwork = at('mirror-ai', i / 120, view), data = rig.views[view];
    for (const side of ['l', 'r']) {
      assert.equal(integratedUsagiPaw(artwork, side), true);
      const geometry = contactPawGeometry(artwork, data, side);
      assert.equal(geometry.openRoot, true);
      assert.ok(Math.hypot(geometry.to[0] - geometry.from[0], geometry.to[1] - geometry.from[1]) < 18);
      const wrist = applyPoint(artwork.pose.world[`hand_${side}`], ...data.bones[`hand_${side}`].pivot);
      assert.ok(wrist[1] >= 46.3 && wrist[1] <= 51.01);
    }
  }
});

test('one-time lifecycle envelope returns body, paws and equipment smoothly to rest', () => {
  for (const id of ['mirror-music', 'mirror-ai']) {
    const paused = { mirrorPresentation: { phase: 'exit', progress: .7, loopProgress: .31, static: false }, propOpacity: 0 };
    const a = at(id, .9, 'front', { action: paused });
    assert.equal(a.pose.sample.event.weight, 0);
    assert.deepEqual(sampleUsagiEventBody(action(id, paused), .9, false), { x: 0, y: 0, r: 0, sx: 1, sy: 1 });
    if (id === 'mirror-ai') for (const side of ['l', 'r']) {
      const wrist = applyPoint(a.pose.world[`hand_${side}`], ...rig.views.front.bones[`hand_${side}`].pivot);
      assert.ok(Math.hypot(...wrist.map((value, index) => value - rig.views.front.bones[`hand_${side}`].pivot[index])) < 1e-8);
    }
  }
});

test('calm poses ignore both category-loop progress and entering opacity', () => {
  for (const id of ['mirror-music', 'mirror-ai']) for (const view of ['front', 'three-quarter']) {
    const a = at(id, .13, view, { calmVisual: true, action: { propOpacity: .1 } });
    const b = at(id, .79, view, { calmVisual: true, action: { propOpacity: .8 } });
    assert.deepEqual(a.pose, b.pose); assert.deepEqual(a.face, b.face);
    assert.equal(a.pose.sample.event.weight, 1);
    assert.deepEqual(sampleUsagiEventBody(action(id), .13, true), sampleUsagiEventBody(action(id), .79, true));
  }
});

test('selected hat remains equipped and headset cups paint before its complete foreground cloth', () => {
  const hat = PET_APPEARANCE_ITEMS.find(item => item.formId === 'usagi' && item.renderKey === 'usagi-sunhat');
  assert.ok(hat);
  const appearance = Object.freeze({ items: Object.freeze([hat]) });
  const artwork = at('mirror-music', .32, 'front', { appearance });
  assert.equal(artwork.headphoneFrontItemId, hat.id);
  assert.strictEqual(appearance.items[0], hat);
  const { context, calls } = trace();
  artist.appearance(context, { artwork, item: hat, appearance, form: USAGI_FORM, view: 'front', layer: 'front', palette: {} });
  const cups = calls.filter(call => call[0] === 'ellipse');
  assert.ok(cups.length >= 4, 'both cups and inner cushions are rendered beneath hat');
  calls.length = 0;
  artist.action(context, { artwork, layer: 'front', action: action('mirror-music'), palette: {} });
  assert.equal(calls.filter(call => call[0] === 'ellipse').length, 0, 'cups do not repaint over hat');
});

test('feedback wins and only the two category mirrors gain quarter view support', () => {
  const face = { eyes: 'surprised', mouth: 'surprised' };
  assert.deepEqual(at('mirror-ai', .3, 'front', { face, expressionId: 'react.surprised' }).face, face);
  for (const id of ['mirror-music', 'mirror-ai']) {
    assert.equal(resolveUsagiView('three-quarter', { action: action(id) }), 'three-quarter');
    assert.equal(resolveUsagiView('profile', { action: action(id) }), 'front');
  }
  assert.equal(resolveUsagiView('three-quarter', { action: { id: 'focus-browse', motion: 'browse' } }), 'front');
  assert.equal(sampleUsagiEventBody({ id: 'sing' }, .4, false), null);
});

test('tiny collaborator uses the AI envelope only and paints after the intact canonical body', () => {
  for (const view of ['front', 'three-quarter']) {
    const artwork = at('mirror-ai', .37, view, { action: { propOpacity: .6 } });
    const pose = sampleUsagiEventRobot(artwork);
    assert.equal(pose.opacity, .6);
    assert.strictEqual(pose.bounds, USAGI_EVENT_ROBOT_BOUNDS);
    assert.ok(pose.x >= 76 && pose.x < 78);
    const { context, calls } = trace();
    assert.equal(paintUsagiEventRobot(context, artwork, 'back'), false);
    assert.equal(calls.length, 0);
    assert.equal(paintUsagiEventRobot(context, artwork, 'front'), true);
    assert.ok(calls.some(call => call[0] === 'fill'), 'collaborator has actual native-vector shapes');
    assert.equal(sampleUsagiEventRobot(at('mirror-music', .37, view)), null);
    assert.equal(sampleUsagiEventRobot(at('mirror-ai', .37, view, { action: { propOpacity: 0 } })), null);
    assert.equal(sampleUsagiEventRobot(artist.resolveArtwork({ view, motion: 'idle' })), null);
  }
});

test('collaborator stays clear of stage edges, clothing and reserved lower badge; calm is fully static', () => {
  const { x, y, width, height } = USAGI_EVENT_ROBOT_BOUNDS;
  assert.ok(x >= 74 && x + width < 106);
  assert.ok(y >= 35 && y + height < 80, 'reserved badge begins at art y80.33');
  const first = sampleUsagiEventRobot(at('mirror-ai', .1, 'front', { calmVisual: true }));
  const last = sampleUsagiEventRobot(at('mirror-ai', .9, 'front', { calmVisual: true }));
  assert.deepEqual(first, last);
  const a = sampleUsagiEventRobot(at('mirror-ai', .001));
  const b = sampleUsagiEventRobot(at('mirror-ai', .999));
  assert.ok(Math.abs(a.headTurn - b.headTurn) < .005);
  assert.ok(Math.abs(a.handY - b.handY) < .005);
});
