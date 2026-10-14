import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccessories } from '../src/capabilities/companion/presentation/motion-core/accessory-resolver.mjs';
import { PET_APPEARANCE_ITEMS } from '../src/content/appearance.mjs';

const items = [PET_APPEARANCE_ITEMS.find(i => i.id === 'usagi.sunhat')];
const plain = { id: 'custom-hop', motion: 'hop', duration: 2000 };
const stows = { ...plain, motionCaps: { wear: { stow: [{ region: 'crown', why: 'test' }], holds: false } } };
const vis = plan => (plan.get ? plan.get('usagi.sunhat') : plan.list.find(e => e.id === 'usagi.sunhat'))?.visible;

test('plan cache keys on motionCaps identity, not only id/prop/duration', () => {
  const o = { items, formId: 'usagi', view: 'front', phase: .5 };
  const a = resolveAccessories({ ...o, action: plain });
  const b = resolveAccessories({ ...o, action: stows });
  assert.notEqual(vis(a), vis(b), 'stow caps must change the plan');
  assert.equal(vis(resolveAccessories({ ...o, action: plain })), vis(a), 'plain served again');
});
