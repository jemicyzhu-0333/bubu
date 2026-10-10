'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, harness } = require('../test-support/inbox-destination-fixture');
const { dom, element } = require('../test-support/manual-growth-dom');
const { createUpdateWorkItemWorkflow, createApplyGuidanceProposalWorkflow } = require('../src/application');
const { ProposalStore } = require('../src/application/ai/proposal-store');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { createPopoverBreakdownFeature } = require('../src/surfaces/popover/features/breakdown.mjs');

const titles = ['打开手机时钟，设一个下午六点的闹钟', '闹钟响后拿上随身包出门去健身', '到健身房热身五分钟，再运动十分钟'];
function fixture(t, { ai = true, failure = false } = {}) {
  const frame = global.requestAnimationFrame;
  global.requestAnimationFrame = () => {};
  t.after(() => frame ? global.requestAnimationFrame = frame : delete global.requestAnimationFrame);
  const h = harness('task', { suggestNextStep: () => ({ title: '打开需要的东西' }) });
  const converted = h.execute('next-step');
  assert.equal(converted.ok, true);
  const task = converted.task;
  let sequence = 0, failSave = false;
  const update = createUpdateWorkItemWorkflow({ unitOfWork: h.unitOfWork, clock: { now: () => NOW },
    idFactory: prefix => `${prefix}-confirmed-${++sequence}`, inferEnergy: () => 'medium', suggestDuration: () => 25 });
  const store = new ProposalStore({ now: () => NOW, idFactory: () => 'proposal-gym' });
  const apply = createApplyGuidanceProposalWorkflow({ proposalStore: store, updateWorkItemWorkflow: update,
    consumeBreakdownProposal: id => store.consume(id) });
  const view = dom();
  view.document.createElement = () => {
    const row = element(), input = element(), remove = element();
    row.querySelector = selector => selector === '.bd-step-input' ? input : remove;
    return row;
  };
  const feature = createPopoverBreakdownFeature({ ...view, $$: () => [], escapeHTML: String, maxSteps: 100,
    syncPressedButtons() {}, bindStepTitleField() {}, taskActionMessage: String, fallbackReasonText: String,
    surfaceClient: {
      previewBreakdown: async () => titles.map(title => ({ title })),
      previewAiBreakdown: async () => {
        if (failure) throw new Error('Synthetic provider failure');
        const entry = store.put({ steps: titles.map((title, i) => ({ title, dependsOn: i ? i - 1 : null,
          safeStopAfter: i === titles.length - 1 })), clarifyingQuestion: null }, { taskId: task.id, title: task.title });
        return { ok: true, provider: 'api', proposalId: entry.id, steps: entry.proposal.steps };
      },
      applyBreakdownProposal: async (proposalId, steps, options) => failSave ? { ok: false, reason: 'synthetic-failure' }
        : apply.execute({ proposalId, steps, ...options }),
      updateTask: async (taskId, patch, scope) => update.execute({ taskId, patch, scope }),
      dismissBreakdownProposal: async id => store.consume(id), cancelAiRequests: async () => ({})
    }, isAiEnabled: () => ai, activeLandingPrompt: () => null, isLandingModalOpen: () => false,
    renderLanding() {}, rememberLandingReturnFocus() {}, restoreModalFocus() {}, showTaskPanelStatus() {} });
  feature.mount(); t.after(() => feature.dispose());
  const saved = () => h.repo.snapshot().tasks.find(value => value.id === task.id);
  return { ...h, view, feature, task, saved, store, update, apply, failSave: value => { failSave = value; } };
}

for (const ai of [true, false]) test(`inbox → ${ai ? 'AI' : 'local'} preview → confirmed steps preserves count, order and wording on hydration`, async t => {
  const h = fixture(t, { ai });
  await h.feature.open(h.task);
  assert.deepEqual(h.feature.context().steps.map(s => s.title), titles);
  await h.view.$('#bdConfirm').emit('click');
  assert.deepEqual(h.saved().steps.map(s => s.title), titles, 'no invisible deterministic starter is prepended');
  const reopened = normalizePersistedState(JSON.parse(JSON.stringify(h.repo.snapshot())), { now: NOW });
  assert.deepEqual(reopened.tasks.find(task => task.id === h.task.id).steps, h.saved().steps);
  assert.equal(h.repo.inspect().commits, 2);
  assert.equal(h.execute('next-step').ok, false, 'a repeated source conversion never creates another task');
  if (ai) {
    assert.equal(h.apply.execute({ proposalId: 'proposal-gym', targetTaskId: h.task.id, steps: titles.map(title => ({ title })) }).ok, false);
    assert.equal(h.saved().steps.length, 3, 'consumed proposal cannot append twice');
  }
});

for (const failure of [false, true]) test(`${failure ? 'failed' : 'cancelled'} preview leaves the converted task intact with no unconfirmed steps`, async t => {
  const h = fixture(t, { failure });
  await h.feature.open(h.task);
  h.feature.close();
  assert.deepEqual(h.saved().steps, []);
  assert.equal(h.saved().title, h.task.title);
  assert.equal(h.repo.snapshot().stats.totalBreakdowns, h.initial.stats.totalBreakdowns);
  assert.equal(h.store.size, 0);
  assert.equal(h.repo.inspect().commits, 1);
});

test('failed confirmation preserves the three-step draft and explicit retry appends only those three', async t => {
  const h = fixture(t);
  await h.feature.open(h.task);
  h.failSave(true);
  await h.view.$('#bdConfirm').emit('click');
  assert.equal(h.feature.isOpen(), true);
  assert.deepEqual(h.feature.context().steps.map(s => s.title), titles);
  assert.deepEqual(h.saved().steps, []);
  h.failSave(false);
  await h.view.$('#bdConfirm').emit('click');
  assert.deepEqual(h.saved().steps.map(s => s.title), titles);
});

test('breakdown remains additive for an existing user-authored first step, even if its wording matches the old template', async t => {
  const h = fixture(t);
  assert.equal(h.update.execute({ taskId: h.task.id, patch: { steps: [{ op: 'add', title: '打开需要的东西' }] } }).ok, true);
  await h.feature.open(h.saved());
  await h.view.$('#bdConfirm').emit('click');
  assert.deepEqual(h.saved().steps.map(s => s.title), ['打开需要的东西', ...titles]);
});

for (const count of [1, 3, 4]) test(`${count} explicitly approved steps survive a real schema19 SQLite close/reopen exactly`, t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
  const { createUnitOfWork, createResolveImpulseWorkflow } = require('../src/application');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-steps-'));
  const handles = [];
  const open = () => {
    const repo = createSqliteStateAdapter({ userDataPath: directory, now: () => NOW });
    handles.push(repo); return repo;
  };
  t.after(() => { handles.forEach(repo => repo.close()); fs.rmSync(directory, { recursive: true, force: true }); });
  const repo = open();
  const initial = normalizePersistedState({ ...repo.snapshot(), impulses: [
    { id: 'capture-gym', text: '下午六点要不去健身好了', createdAt: NOW - 1000 }
  ] }, { now: NOW });
  repo.commit(initial, { now: NOW });
  let sequence = 0;
  const ports = { unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => NOW },
    idFactory: prefix => `${prefix}-${++sequence}`, inferEnergy: () => 'medium', suggestDuration: () => 25,
    nextWorkStart: () => NOW, suggestNextStep: () => assert.fail('conversion cannot create an unconfirmed starter') };
  const converted = createResolveImpulseWorkflow(ports).execute({ impulseId: 'capture-gym', action: 'next-step' });
  assert.equal(converted.ok, true);
  assert.deepEqual(converted.task.steps, []);
  const approved = [...titles, '回家后把运动包放好'].slice(0, count).map(title => ({ title }));
  const store = new ProposalStore({ now: () => NOW, idFactory: () => 'sqlite-proposal' });
  store.put({ steps: titles.map((title, i) => ({ title, dependsOn: i ? i - 1 : null, safeStopAfter: i === 2 })),
    clarifyingQuestion: null }, { taskId: converted.task.id, title: converted.task.title });
  const apply = createApplyGuidanceProposalWorkflow({ proposalStore: store,
    updateWorkItemWorkflow: createUpdateWorkItemWorkflow(ports), consumeBreakdownProposal: id => store.consume(id) });
  const result = apply.execute({ proposalId: 'sqlite-proposal', targetTaskId: converted.task.id, steps: approved });
  assert.equal(result.ok, true);
  const committed = repo.snapshot();
  assert.deepEqual(committed.tasks[0].steps.map(s => s.title), approved.map(s => s.title));
  assert.equal(committed.tasks[0].nextAction, approved[0].title);
  assert.equal(repo.authoritativeWrites.verify().ok, true);
  repo.close();
  const reopened = open();
  assert.deepEqual(reopened.snapshot(), committed, 'same authority restores every canonical field without reseeding');
  assert.equal(reopened.authoritativeWrites.verify().ok, true);
});

test('existing completed first step and unrelated task stay byte-equivalent when suggestions are added', async t => {
  const h = fixture(t);
  const state = h.repo.snapshot();
  const task = state.tasks.find(value => value.id === h.task.id);
  task.steps = [{ id: 'already-done', title: '打开需要的东西', done: true }];
  state.tasks.push({ id: 'unrelated-task', title: 'Unrelated synthetic task', createdAt: NOW - 1000,
    steps: [{ id: 'unrelated-step', title: 'Keep my wording', done: false }] });
  const normalized = normalizePersistedState(state, { now: NOW });
  h.repo.commit(normalized, { now: NOW, expectedRevision: h.repo.revision() });
  const first = h.saved().steps[0];
  const unrelated = h.repo.snapshot().tasks.find(value => value.id === 'unrelated-task');
  await h.feature.open(h.saved());
  await h.view.$('#bdConfirm').emit('click');
  assert.deepEqual(h.saved().steps[0], first);
  assert.deepEqual(h.repo.snapshot().tasks.find(value => value.id === 'unrelated-task'), unrelated);
  assert.deepEqual(h.saved().steps.slice(1).map(s => s.title), titles);
  assert.equal(h.saved().nextAction, titles[0]);
});
