'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverTaskDraft } = require('../src/surfaces/popover/features/task-draft.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const { createPopoverMessages } = require('../src/surfaces/popover/ui/messages.mjs');
const { proposalPreviewFixture, validSteps } = require('../test-support/proposal-preview-fixture');
const messages = createPopoverMessages({ pad2: value => String(value).padStart(2, '0') });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const suggestion = (proposalId = 'preview-1') => ({
  ok: true, provider: 'api', fallback: false, proposalId,
  steps: [{ title: 'Open the report' }], completionCriteria: 'Report checked',
  energy: 'low', estimateMinutes: 15, tags: ['report']
});

// The shared fixture supplies real markup IDs. Only step rows and controllable
// scheduling are added here; this is behavior coverage, not browser/layout QA.
function harness(t, { save, enrich } = {}) {
  const dom = createCollaborationDom();
  const calls = [], restored = [], frames = [], tickers = new Map(), rows = [];
  const oldFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  t.after(() => {
    if (oldFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', oldFrame);
    else delete globalThis.requestAnimationFrame;
  });
  let timerId = 0;
  t.mock.method(globalThis, 'setInterval', callback => {
    const id = ++timerId; tickers.set(id, callback); return id;
  });
  t.mock.method(globalThis, 'clearInterval', id => tickers.delete(id));
  Object.defineProperty(dom.$('#createSteps'), 'innerHTML', {
    set() { rows.length = 0; }, get() { return ''; }
  });
  dom.$('#createSteps').appendChild = row => rows.push(row);
  dom.document.createElement = () => {
    const input = { value: '', focus() {} };
    const remove = { addEventListener(type, handler) { this[type] = handler; } };
    return {
      set innerHTML(html) { input.value = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1]; },
      querySelector: selector => selector === '.bd-step-input' ? input : remove
    };
  };
  dom.$('#btnEnrichDraft').textContent = '让伙伴补全';
  const client = {
    addTask(payload) { calls.push(['addTask', structuredClone(payload)]); return save ? save(payload) : Promise.resolve({ ok: true }); },
    addWithBreakdown(payload) { calls.push(['addWithBreakdown', structuredClone(payload)]); return save ? save(payload) : Promise.resolve({ ok: true }); },
    previewEnrich(payload) { calls.push(['preview', payload]); return enrich ? enrich(payload) : Promise.resolve(suggestion()); },
    async cancelAiRequests() { calls.push(['cancel']); },
    async dismissBreakdownProposal(id) { calls.push(['dismiss', id]); }
  };
  const feature = createPopoverTaskDraft({
    document: dom.document, $: dom.$, $$: selector => selector === '#createSteps .bd-step-input'
      ? rows.map(row => row.querySelector('.bd-step-input')) : [],
    escapeHTML: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    syncPressedButtons() {}, readNumberInput: selector => Number(dom.$(selector).value) || null,
    bindStepTitleField: (input, onInput) => { input.input = onInput; },
    parseTagList: value => value ? value.split('，') : [], tagInputError: () => '',
    estimateInputError: () => '', maxSteps: 100, surfaceClient: client,
    breakdownProviderLabel: () => 'AI', fallbackReasonSuffix: messages.fallbackReasonSuffix,
    whenFields: { values: () => ({}), validate: () => '', reset() {}, mount() {}, dispose() {} },
    restoreModalFocus: target => restored.push(target),
    showStatus: text => { dom.$('#taskFormStatus').textContent = text; }
  });
  feature.mount();
  t.after(() => feature.dispose());
  const fire = (selector, type, event = {}) => dom.fire(selector, type, {
    target: dom.$(selector), preventDefault() {}, ...event
  });
  return {
    dom, feature, calls, restored, frames, tickers,
    save: () => fire('#taskCreateConfirm', 'click'),
    enrich: () => fire('#btnEnrichDraft', 'click'),
    enter: event => fire('#taskInput', 'keydown', { key: 'Enter', ...event }),
    status: () => dom.$('#taskFormStatus').textContent,
    saved: () => calls.filter(([name]) => name === 'addTask' || name === 'addWithBreakdown'),
    steps: () => rows.map(row => row.querySelector('.bd-step-input').value)
  };
}

test('click and Enter share one in-flight task save', async t => {
  const pending = deferred(), h = harness(t, { save: () => pending.promise });
  h.feature.open({ title: 'Report' });
  const first = h.save(), second = h.enter(), third = h.save();
  assert.equal(h.saved().length, 1);
  assert.equal(h.dom.$('#taskCreateConfirm').disabled, true);
  pending.resolve({ ok: true }); await Promise.all([first, second, third]);
  assert.equal(h.feature.isOpen(), false);
  assert.equal(h.restored.length, 1);
});

test('IME confirmation Enter never saves or prevents composition', async t => {
  const h = harness(t); h.feature.open({ title: '整理报告' });
  const preventDefault = () => { throw new Error('composition must finish'); };
  await h.enter({ isComposing: true, preventDefault });
  await h.enter({ keyCode: 229, preventDefault });
  assert.equal(h.saved().length, 0);
  await h.enter(); assert.equal(h.saved().length, 1);
});

test('a rejected save preserves input and allows an explicit retry', async t => {
  let attempts = 0;
  const h = harness(t, { save: async () => ++attempts === 1 ? { ok: false, reason: 'invalid-date' } : { ok: true } });
  h.feature.open({ title: 'Report' }); h.dom.$('#taskDescriptionInput').value = 'Keep these notes';
  await h.save();
  assert.equal(h.feature.isOpen(), true);
  assert.equal(h.dom.$('#taskDescriptionInput').value, 'Keep these notes');
  assert.match(h.status(), /输入内容还在/);
  assert.equal(h.dom.$('#taskCreateConfirm').disabled, false);
  await h.save(); assert.equal(h.saved().length, 2); assert.equal(h.feature.isOpen(), false);
});

test('an old enrichment cannot fill a reopened draft with the same title', async t => {
  const pending = deferred(), h = harness(t, { enrich: () => pending.promise });
  h.feature.open({ title: 'Report' }); const first = h.enrich();
  h.feature.close(); h.feature.open({ title: 'Report' });
  pending.resolve(suggestion()); await first;
  assert.deepEqual(h.steps(), []); assert.equal(h.dom.$('#taskDescriptionInput').value, '');
  assert.equal(h.dom.$('#estimateInput').value, ''); assert.equal(h.status(), '');
  assert.deepEqual(h.calls.filter(([name]) => name === 'dismiss'), [['dismiss', 'preview-1']]);
});

test('old enrichment rejection and finally cannot repaint a newer running preview', async t => {
  const old = deferred(), current = deferred(); let attempts = 0;
  const h = harness(t, { enrich: () => ++attempts === 1 ? old.promise : current.promise });
  h.feature.open({ title: 'Report' }); const first = h.enrich();
  h.feature.close(); h.feature.open({ title: 'Report' }); const second = h.enrich();
  h.dom.$('#taskFormStatus').textContent = 'Current draft';
  old.reject(new Error('late cancellation')); await first;
  assert.equal(h.status(), 'Current draft');
  assert.equal(h.dom.$('#btnEnrichDraft').disabled, true);
  assert.match(h.dom.$('#btnEnrichDraft').textContent, /正在补全/);
  assert.equal(h.tickers.size, 1);
  current.resolve(suggestion('preview-2')); await second;
  assert.deepEqual(h.steps(), ['Open the report']); assert.equal(h.tickers.size, 0);
  assert.equal(h.dom.$('#btnEnrichDraft').textContent, '让伙伴补全');
});

test('adopting a proposal invalidates previous enrichment even for the same title', async t => {
  const pending = deferred(), h = harness(t, { enrich: () => pending.promise });
  h.feature.open({ title: 'Report' }); const first = h.enrich();
  h.feature.adopt({ ...suggestion(null), title: 'Report', steps: [{ title: 'Adopted step' }], notes: 'Conversation notes' });
  const before = h.status(); pending.resolve(suggestion()); await first;
  assert.deepEqual(h.steps(), ['Adopted step']); assert.equal(h.status(), before);
  assert.equal(h.dom.$('#taskDescriptionInput').value, 'Conversation notes');
});

test('old save success cannot close a reopened draft or release its pending save', async t => {
  const old = deferred(), current = deferred(); let attempts = 0;
  const h = harness(t, { save: () => ++attempts === 1 ? old.promise : current.promise });
  h.feature.open({ title: 'First' }); const first = h.save();
  h.feature.close(); h.feature.open({ title: 'Second' });
  assert.equal(h.dom.$('#taskCreateConfirm').disabled, false);
  const second = h.save(); h.dom.$('#taskFormStatus').textContent = 'Second draft';
  old.resolve({ ok: true }); await first;
  assert.equal(h.feature.isOpen(), true); assert.equal(h.dom.$('#taskInput').value, 'Second');
  assert.equal(h.status(), 'Second draft'); assert.equal(h.dom.$('#taskCreateConfirm').disabled, true);
  await h.enter(); assert.equal(h.saved().length, 2);
  current.resolve({ ok: true }); await second;
  assert.equal(h.feature.isOpen(), false); assert.equal(h.restored.length, 2);
});

test('old save failure cannot replace the status of an adopted draft', async t => {
  const pending = deferred(), h = harness(t, { save: () => pending.promise });
  h.feature.open({ title: 'First' }); const first = h.save();
  h.feature.adopt({ ...suggestion(null), title: 'Second', notes: 'New notes' });
  const before = h.status(); pending.reject(new Error('old failure')); await first;
  assert.equal(h.feature.isOpen(), true); assert.equal(h.status(), before);
  assert.equal(h.dom.$('#taskInput').value, 'Second');
});

test('enrichment is single-flight and a late answer cannot revise a submitted draft', async t => {
  const preview = deferred(), saving = deferred();
  const h = harness(t, { enrich: () => preview.promise, save: () => saving.promise });
  h.feature.open({ title: 'Report' }); const enriching = h.enrich();
  const duplicate = h.enrich(); assert.equal(h.calls.filter(([name]) => name === 'preview').length, 1);
  const submitted = h.save(); preview.resolve(suggestion()); await Promise.all([enriching, duplicate]);
  assert.deepEqual(h.steps(), []); assert.equal(h.saved()[0][1].steps, undefined);
  assert.equal(h.dom.$('#taskDescriptionInput').value, '');
  saving.resolve({ ok: true }); await submitted;
});

test('an adopted AI step list retains its closed payload and save route', async t => {
  const pending = deferred(), h = harness(t, { save: () => pending.promise });
  h.feature.adopt({ ...suggestion(null), title: 'Report' });
  const first = h.save(), duplicate = h.enter();
  assert.equal(h.saved().length, 1); assert.equal(h.saved()[0][0], 'addWithBreakdown');
  assert.deepEqual(h.saved()[0][1].steps, [{ title: 'Open the report' }]);
  pending.resolve({ ok: true }); await Promise.all([first, duplicate]);
});

test('close and disposal clear preview timers and invalidate every late callback', async t => {
  const preview = deferred(), saving = deferred();
  const h = harness(t, { enrich: () => preview.promise, save: () => saving.promise });
  h.feature.open({ title: 'Report' }); const enriching = h.enrich();
  assert.equal(h.tickers.size, 1); h.feature.close(); assert.equal(h.tickers.size, 0);
  h.feature.open({ title: 'Second' }); const submitted = h.save(); h.feature.dispose();
  const before = h.status(), restored = h.restored.length;
  assert.equal(h.dom.listeners.size, 0);
  preview.resolve(suggestion()); saving.resolve({ ok: true }); await Promise.all([enriching, submitted]);
  assert.deepEqual(h.steps(), []); assert.equal(h.status(), before); assert.equal(h.restored.length, restored);
  h.feature.mount(); h.feature.open({ title: 'Third' }); await h.save();
  assert.equal(h.feature.isOpen(), false);
});

test('disposing an active enrichment releases its timer without awaiting the provider', async t => {
  const pending = deferred(), h = harness(t, { enrich: () => pending.promise });
  h.feature.open({ title: 'Report' }); const first = h.enrich();
  const oldTick = [...h.tickers.values()][0];
  h.feature.dispose(); assert.equal(h.tickers.size, 0);
  h.dom.$('#btnEnrichDraft').textContent = 'Disposed';
  oldTick(); assert.equal(h.dom.$('#btnEnrichDraft').textContent, 'Disposed');
  pending.resolve(suggestion()); await first;
  assert.deepEqual(h.steps(), []); assert.equal(h.dom.$('#btnEnrichDraft').textContent, 'Disposed');
  assert.deepEqual(h.calls.filter(([name]) => name === 'dismiss'), [['dismiss', 'preview-1']]);
});

test('an enrichment error for a changed title preserves the current draft status', async t => {
  const pending = deferred(), h = harness(t, { enrich: () => pending.promise });
  h.feature.open({ title: 'Report' }); const first = h.enrich();
  h.dom.$('#taskInput').value = 'Different task';
  h.dom.$('#taskFormStatus').textContent = 'New task';
  pending.reject(new Error('provider unavailable')); await first;
  assert.equal(h.status(), 'New task'); assert.equal(h.dom.$('#btnEnrichDraft').disabled, false);
  assert.equal(h.tickers.size, 0);
});

test('queued focus callbacks cannot steal focus after close or a newer open', t => {
  const h = harness(t); h.feature.open({ title: 'First' }); h.feature.close();
  h.frames.shift()(); assert.equal(h.dom.$('#taskInput').focused, 0);
  h.feature.open({ title: 'Second' }); h.feature.open({ title: 'Third' });
  h.frames.shift()(); assert.equal(h.dom.$('#taskInput').focused, 0);
  h.frames.shift()(); assert.equal(h.dom.$('#taskInput').focused, 1);
});

test('real enrichment validation detail reaches the draft status through the mock IPC client', async t => {
  for (const fallbackError of [undefined, new Error('no-local-fallback')]) {
    const provider = proposalPreviewFixture({ steps: validSteps(), completionCriteria: null,
      energy: null, estimateMinutes: 999, tags: [] }, { fallbackError });
    const h = harness(t, { enrich: async payload => structuredClone(await provider.preview.previewEnrichProposal(payload)) });
    h.feature.open({ title: 'PRIVATE_DRAFT_TITLE' });
    h.dom.$('#taskDescriptionInput').value = 'PRIVATE_DRAFT_NOTES';
    await h.enrich();
    assert.match(h.status(), /estimateMinutes is invalid/);
    assert.doesNotMatch(h.status(), /PRIVATE|proposal-rejected/);
    assert.equal(h.dom.$('#taskFormStatus').innerHTML, '');
    assert.equal(h.dom.$('#taskDescriptionInput').value, 'PRIVATE_DRAFT_NOTES');
    assert.deepEqual(h.steps(), []);
    assert.equal(provider.sent.length, 2);
    h.feature.dispose();
  }
});
