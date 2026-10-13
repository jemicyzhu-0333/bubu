import test from 'node:test';
import assert from 'node:assert/strict';
import rig from '../assets/companion/usagi/rig/usagi.rig.mjs';
import { PET_ACTIONS } from '../src/content/behaviors.mjs';
import { createRigArtist } from '../src/capabilities/companion/presentation/rig/rig-art.mjs';
import { createPathCache } from '../src/capabilities/companion/presentation/rig/paint.mjs';
import support from '../src/capabilities/companion/presentation/usagi-support.mjs';
import { limbState, limbGeometry, usagiLimbFilters } from '../src/capabilities/companion/presentation/usagi-limbs.mjs';

const artist = createRigArtist({ fallback: support, paths: createPathCache({ createPath: d => ({ d }) }) });
const art = (id, t, calmVisual, channel) => artist.resolve(rig, { action: PET_ACTIONS[id], motion: PET_ACTIONS[id].motion,
  progress: .5, elapsedMs: t, calmVisual, channel, view: 'front' });

function switchFade(calm) {
  const ch = `calm-test-${calm}`, data = rig.views.front;
  let fading = false;
  for (const side of ['l', 'r']) limbState(art('wave', 0, calm, ch), side, data);
  for (const side of ['l', 'r']) {
    const s = limbState(art('sip-tea', 16, calm, ch), side, data);
    if (s.leaving || s.arriving < 1) fading = true;
  }
  return fading;
}

test('live limbs cross-fade an intent switch (control)', () => assert.equal(switchFade(false), true));
test('calm / reduced motion limbs switch to the static pose immediately, no fade', () => assert.equal(switchFade(true), false));
test('calm limbs are not speed-filtered and leave no channel filter state', () => {
  const data = rig.views.front, ch = 'calm-filter';
  usagiLimbFilters.clear();
  for (const id of ['wave', 'sip-tea', 'catch-star']) for (const side of ['l', 'r']) {
    const a = art(id, 16, true, ch); limbState(a, side, data);
    const g = limbGeometry(a, data, side);
    if (g) { const plain = limbGeometry({ ...a, clock: { channel: ch } }, data, side); assert.deepEqual(g.elbow, plain.elbow, id); }
  }
  assert.ok(usagiLimbFilters.size === 0, 'no filter state for a calm channel');
});

import usagiArt from '../src/capabilities/companion/presentation/usagi-art.mjs';
import { USAGI_LIMB_RIG } from '../src/content/companion/usagi-limbs.mjs';
import { PET_APPEARANCE_ITEMS } from '../src/content/appearance.mjs';

test('cross-action switch on one channel: the fade closes within intentFadeMs', () => {
  const data = rig.views.front, ch = 'cross-action';
  for (let t = 0; t <= 100; t += 16) limbState(art('wave', t, false, ch), 'r', data);
  let last = 0;
  for (let t = 116; t <= 116 + 600; t += 16) { const s = limbState(art('sip-tea', t, false, ch), 'r', data); if (s.leaving || s.arriving < 1) last = t; }
  assert.ok(last > 0, 'a fade happened');
  assert.ok(last - 116 < USAGI_LIMB_RIG.intentFadeMs, `fade lasted ${last - 116}ms`);
});

import { createRequire } from 'node:module';
const canvasPkg = process.env.USAGI_CANVAS_PACKAGE;
test('wardrobe change mid-action does not move limbs (limb geometry is outfit-independent)', { skip: !canvasPkg && !globalThis.Path2D && 'needs USAGI_CANVAS_PACKAGE' }, () => {
  globalThis.Path2D ||= createRequire(import.meta.url)(canvasPkg).Path2D;
  const outfit = ids => ({ items: ids.map(id => PET_APPEARANCE_ITEMS.find(i => i.id === id)) });
  const a = PET_ACTIONS['sip-tea'], base = { view: 'front', motion: a.motion, action: a, progress: .5, elapsedMs: 1000, channel: 'wardrobe-change' };
  const bare = usagiArt.resolveArtwork({ ...base, appearance: outfit([]) });
  const dressed = usagiArt.resolveArtwork({ ...base, elapsedMs: 1016, appearance: outfit(['usagi.pastel-scarf', 'usagi.sunhat', 'usagi.paper-plane-clip']) });
  const data = rig.views.front;
  for (const side of ['l', 'r']) {
    const g0 = limbGeometry({ ...bare, clock: { channel: 'x' } }, data, side), g1 = limbGeometry({ ...dressed, clock: { channel: 'x' } }, data, side);
    assert.deepEqual(g1?.to, g0?.to, side); assert.deepEqual(g1?.elbow, g0?.elbow, side);
  }
});
