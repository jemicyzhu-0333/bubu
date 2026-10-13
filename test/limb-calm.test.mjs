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
