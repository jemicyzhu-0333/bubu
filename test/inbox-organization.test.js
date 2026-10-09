'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnitOfWork } = require('../src/application');
const { createOrganizeInboxWorkflow } = require('../src/application/workflows/organize-inbox');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { ROUTINE_EFFECT_PROFILES } = require('../src/content/energy-effects.mjs');
const { inboxRecords, impulseInbox } = require('../src/capabilities/work');
const { validateIpcPayload, allowedSurfacesFor } = require('../src/application/ipc/route-catalog');
const { createTriageCaptureWorkflow } = require('../src/application/workflows/triage-capture');
const { createAnalyzeImpulseEnergyWorkflow } = require('../src/application/workflows/analyze-impulse-energy');
const { iconMotion } = require('../src/surfaces/shared/icon-motion.mjs');
const NOW = new Date(2026, 9, 1, 20).getTime();

function harness(overrides = {}, effects = {}) {
  let state = normalizePersistedState({ impulses: [{ id: 'i1', text: '刚吃了饭', createdAt: NOW - 1000 }], ...overrides }, { now: NOW });
  let revision = 0, sequence = 0;
  const facts = [];
  const repository = { snapshot: () => structuredClone(state), revision: () => revision, commit(candidate) {
    assert.deepEqual(normalizePersistedState(candidate, { now: NOW }), candidate, 'every transition must be canonical');
    state = structuredClone(candidate); revision++; return structuredClone(state);
  } };
  const unitOfWork = createUnitOfWork({ repository });
  const workflow = createOrganizeInboxWorkflow({ unitOfWork, clock: { now: () => NOW }, profiles: ROUTINE_EFFECT_PROFILES,
    idFactory: prefix => `${prefix}-${++sequence}`, publish: fact => facts.push(fact), ...effects });
  const classify = (category, rest = {}) => workflow.execute({ id: 'i1', action: 'classify', category, ...rest });
  return { workflow, classify, repository, unitOfWork, facts };
}

test('missing routine creation, one occurrence and labeled original history commit atomically; retries cannot duplicate', () => {
  const h = harness();
  assert.equal(h.classify('log', { routineKind: 'meal' }).ok, true);
  const before = h.repository.revision();
  assert.equal(h.workflow.execute({ id: 'i1', action: 'log', title: '吃饭' }).ok, true);
  const state = h.repository.snapshot();
  assert.equal(h.repository.revision(), before + 1);
  assert.equal(state.routines.length, 1);
  assert.equal(state.routines[0].schedule, null);
  assert.equal(state.routineLog.days[0].entries.length, 1);
  assert.equal(state.impulses[0].resolution.category, 'log');
  assert.equal(state.impulses[0].text, '刚吃了饭');
  assert.equal(h.facts.at(-1).fact.type, 'routine-logged');
  assert.equal(h.workflow.execute({ id: 'i1', action: 'log', title: '吃饭' }).reason, 'impulse-not-found');
  assert.equal(h.repository.revision(), before + 1);
  assert.equal(state.xp, 0, 'a routine gives no XP');
});

test('invalid destination rolls back without removing or resolving the capture', () => {
  const h = harness(); h.classify('routine', { routineKind: 'movement' });
  const before = h.repository.snapshot(), revision = h.repository.revision();
  assert.equal(h.workflow.execute({ id: 'i1', action: 'routine', title: '' }).ok, false);
  assert.deepEqual(h.repository.snapshot(), before);
  assert.equal(h.repository.revision(), revision);
  assert.equal(h.workflow.execute({ id: 'i1', action: 'log', title: '散步' }).reason, 'impulse-category-changed');
});

test('routine plans do not invent completed occurrences and a failed post-commit effect cannot retry the action', () => {
  const h = harness({}, { publish() { throw new Error('offline view'); } });
  h.classify('routine', { routineKind: 'movement' });
  assert.equal(h.workflow.execute({ id: 'i1', action: 'routine', title: '散步' }).ok, true);
  const state = h.repository.snapshot();
  assert.deepEqual(state.routineLog.days, []);
  assert.equal(state.impulses[0].resolution.action, 'routine');
});

test('an existing daily item is reused, preserving its reminders', () => {
  const h = harness(); h.classify('routine', { routineKind: 'meal' });
  h.workflow.execute({ id: 'i1', action: 'routine', title: '午餐' });
  const draft = h.repository.snapshot();
  impulseInbox.captureImpulse(draft, { text: '吃完了', createdAt: NOW }, { createId: () => 'i2' });
  h.repository.commit(draft);
  h.workflow.execute({ id: 'i2', action: 'classify', category: 'log', routineKind: 'meal' });
  assert.equal(h.workflow.execute({ id: 'i2', action: 'log', title: '新的名字' }).ok, true);
  assert.equal(h.repository.snapshot().routines.length, 1);
  assert.equal(h.repository.snapshot().routines[0].title, '午餐');
});

test('an old capture cannot overwrite a newer energy report or silently backdate a pruned routine log', () => {
  const h = harness({ energyCheckIn: { level: 80, state: 'high', timestamp: NOW } });
  h.classify('state', { level: 20 });
  assert.equal(h.workflow.execute({ id: 'i1', action: 'state' }).reason, 'newer-check-in-exists');
  assert.equal(h.repository.snapshot().energyCheckIn.level, 80);
  assert.equal(h.workflow.execute({ id: 'i1', action: 'keep' }).ok, true);
  const old = harness({ impulses: [{ id: 'i1', text: '吃饭', createdAt: NOW - 3 * 86400000 }] });
  old.classify('log', { routineKind: 'meal' });
  assert.equal(old.workflow.execute({ id: 'i1', action: 'log', title: '吃饭' }).reason, 'capture-too-old-for-log');
  assert.equal(old.repository.snapshot().routines.length, 0);
});

test('late AI cannot replace a confirmed classification or reclassify a resolved item', async () => {
  for (const resolution of [false, true]) {
    const h = harness({ settings: { aiBreakdownEnabled: true, aiCaptureTriageEnabled: true } });
    let answer;
    const pending = new Promise(resolve => { answer = resolve; });
    const triage = createTriageCaptureWorkflow({ unitOfWork: h.unitOfWork, readSnapshot: h.repository.snapshot,
      clock: { now: () => NOW }, triage: () => pending });
    const result = triage.handleCaptured({ type: 'impulse-captured', impulseId: 'i1', capturedAt: NOW - 1000 });
    if (resolution) h.workflow.execute({ id: 'i1', action: 'keep' });
    else h.classify('feeling');
    answer({ ok: true, triage: { category: 'task', confidence: 90, title: '吃饭' } });
    assert.equal((await result).changed, false);
    assert.equal(h.repository.snapshot().impulses[0].triage, undefined);
  }
});

test('a confirmed emotion removes only its AI energy correction and rejects a late energy inference', async () => {
  const h = harness({ settings: { aiBreakdownEnabled: true, aiImpulseEnergyEnabled: true },
    energySignals: [{ id: 'i1', source: 'impulse-ai', referenceId: 'i1', at: NOW - 1000, delta: -4, confidence: 90, reason: '状态' }] });
  let answer;
  const energy = createAnalyzeImpulseEnergyWorkflow({ unitOfWork: h.unitOfWork, readSnapshot: h.repository.snapshot,
    clock: { now: () => NOW }, classify: () => new Promise(resolve => { answer = resolve; }) });
  const pending = energy.handleCaptured({ type: 'impulse-captured', impulseId: 'i1', capturedAt: NOW - 1000 });
  h.classify('feeling');
  assert.deepEqual(h.repository.snapshot().energySignals, []);
  answer({ ok: true, classification: { direction: 'down', delta: -4, confidence: 90, reason: '状态' } });
  assert.equal((await pending).changed, false);
  assert.deepEqual(h.repository.snapshot().energySignals, []);
});

test('multiple routines of the same kind require an explicit destination', () => {
  const h = harness();
  for (const [id, title] of [['i1', '午餐'], ['i2', '晚餐']]) {
    if (id === 'i2') {
      const state = h.repository.snapshot();
      impulseInbox.captureImpulse(state, { text: title, createdAt: NOW }, { createId: () => id }); h.repository.commit(state);
    }
    h.workflow.execute({ id, action: 'classify', category: 'routine', routineKind: 'meal' });
    h.workflow.execute({ id, action: 'routine', title });
  }
  const state = h.repository.snapshot();
  impulseInbox.captureImpulse(state, { text: '吃好了', createdAt: NOW }, { createId: () => 'i3' }); h.repository.commit(state);
  h.workflow.execute({ id: 'i3', action: 'classify', category: 'log', routineKind: 'meal' });
  assert.equal(h.workflow.execute({ id: 'i3', action: 'log' }).reason, 'routine-choice-required');
  const dinner = state.routines.find(item => item.title === '晚餐');
  assert.equal(h.workflow.execute({ id: 'i3', action: 'log', routineId: dinner.id }).ok, true);
  assert.equal(h.repository.snapshot().routineLog.days[0].entries[0].routineId, dinner.id);
});

test('inbox IPC rejects unknown properties, invalid metadata and unbounded history queries', () => {
  for (const payload of [{ id: 'i1', action: 'classify', category: 'fake' }, { id: 'i1', action: 'keep', writes: [] },
    { id: 'i1', action: 'classify', category: 'state', level: 99 }]) assert.equal(validateIpcPayload('impulses:organize', payload).ok, false);
  assert.equal(validateIpcPayload('impulses:history', { limit: 101 }).ok, false);
  assert.deepEqual(allowedSurfacesFor('impulses:history'), ['popover']);
});

test('icon recipes have distinct semantic motion and all return to baseline', () => {
  const variants = ['bell', 'settings', 'capture', 'today', 'arrange', 'tasks', 'routines', 'inbox', 'archive', 'review', 'sorting', 'history', 'companion', 'form', 'wardrobe', 'food', 'journey'];
  const recipes = variants.map(name => iconMotion(name));
  assert.equal(new Set(recipes.map(recipe => JSON.stringify(recipe.keyframes))).size, variants.length);
  recipes.forEach(recipe => assert.deepEqual([recipe.keyframes.at(-1).x, recipe.keyframes.at(-1).y, recipe.keyframes.at(-1).rotation], [0,0,0]));
  assert.ok(!('y' in iconMotion('bell').keyframes[0]));
});
