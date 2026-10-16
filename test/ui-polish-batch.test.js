'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('outfit set registry exposes 南瓜之夜 for dango through the same recipe path as usagi', async () => {
  const { PET_OUTFIT_SETS, outfitSetsFor } = await import('../src/content/companion/outfit-sets.mjs');
  const { PET_APPEARANCE_ITEMS } = await import('../src/content/appearance.mjs');
  const halloween = outfitSetsFor('dango').find(look => look.id === 'halloween-night');
  assert.ok(halloween);
  assert.deepEqual([...halloween.itemIds], ['seasonal.pumpkin-beret', 'seasonal.plum-cape']);
  assert.equal(new Set(PET_OUTFIT_SETS.map(look => look.id)).size, PET_OUTFIT_SETS.length);
  for (const look of PET_OUTFIT_SETS) for (const id of look.itemIds) {
    const item = PET_APPEARANCE_ITEMS.find(candidate => candidate.id === id);
    assert.ok(item, id); assert.equal(item.formId, look.formId);
  }
  assert.ok(outfitSetsFor('usagi').every(look => look.formId === 'usagi'));
});

test('apply-outfit accepts the dango halloween recipe (opt-in pieces stay explicit)', async () => {
  const { applyOutfit } = require('../src/capabilities/companion/domain/outfit-applying');
  const { outfitSetsFor } = await import('../src/content/companion/outfit-sets.mjs');
  const { PET_APPEARANCE_ITEMS } = await import('../src/content/appearance.mjs');
  const state = { currentSkin: 'pink', unlockedSkins: ['pink'], level: 1, companion: {} };
  const result = applyOutfit(state, { look: outfitSetsFor('dango')[0], expectedSkin: 'pink', items: PET_APPEARANCE_ITEMS, now: 1 });
  assert.equal(result.ok, true);
  assert.equal(state.companion.appearance.equipped.headwear, 'seasonal.pumpkin-beret');
  assert.equal(state.companion.appearance.equipped.backwear, 'seasonal.plum-cape');
});

test('dango view keeps a front-only outfit visible unless the action has no compatible view', async () => {
  const { resolveDangoView } = await import('../src/core/dango-view-policy.mjs');
  const front = ['front'];
  // Petting (tail-wiggle) prefers three-quarter but also allows front.
  assert.equal(resolveDangoView('auto', { action: { id: 'tail-wiggle' } }), 'three-quarter');
  assert.equal(resolveDangoView('auto', { action: { id: 'tail-wiggle' }, outfitViews: front }), 'front');
  // Telescope is authored three-quarter only: genuine conflict, unchanged.
  assert.equal(resolveDangoView('auto', { action: { id: 'telescope' }, outfitViews: front }), 'three-quarter');
  // Walking keeps its travel view.
  assert.equal(resolveDangoView('auto', { state: 'walking', outfitViews: front }), 'three-quarter');
  // Full-coverage outfits change nothing.
  assert.equal(resolveDangoView('auto', { action: { id: 'tail-wiggle' }, outfitViews: null }), 'three-quarter');
});

test('routine history labels relative days and reads older days read-only from the timeline', async () => {
  const { createRoutineHistory, dayLabel } = await import('../src/surfaces/popover/features/routine-history.mjs');
  assert.equal(dayLabel(1, 0), '昨天');
  assert.equal(dayLabel(2, 0), '前天');
  const nodes = {}, handlers = {};
  const node = id => nodes[id] ||= { id, textContent: '', innerHTML: '', disabled: false, attributes: {},
    classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, contains(name) { return this.set.has(name); } },
    setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(type, fn) { handlers[id] = fn; } };
  const NOW = new Date(2026, 9, 16, 12).getTime();
  const reads = [];
  const history = createRoutineHistory({ $: node, escapeHTML: value => String(value), now: () => NOW,
    getState: () => ({ routines: { items: [{ id: 'r1', title: '散步', kind: 'movement' }] } }),
    surfaceClient: { getTimelineDay: async dayKey => { reads.push(dayKey); return { ok: true, day: { markers: dayKey === '2026-10-13'
      ? [{ kind: 'routine.logged', routineId: 'r1', status: 'done', occurredAt: NOW - 3 * 864e5 }] : [] } }; } } });
  history.render({ yesterday: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(reads.includes('2026-10-13'));
  assert.equal(nodes['#yesterdayRoutineRecords'].classList.contains('hidden'), false);
  handlers['#routineHistoryPrev'](); handlers['#routineHistoryPrev'](); await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(nodes['#routineHistoryList'].innerHTML, /散步/);
  assert.doesNotMatch(nodes['#routineHistoryList'].innerHTML, /data-act=/);
});
