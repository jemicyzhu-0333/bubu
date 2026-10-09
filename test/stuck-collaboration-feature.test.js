'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverStuck } = require('../src/surfaces/popover/features/stuck.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');

test('shared stuck proposal fills the existing editor without creating or mutating a task, and confirmation rechecks identity', async () => {
  const dom = createCollaborationDom(); const writes = []; const entries = []; const statuses = [];
  let task = { id: 't1', title: '报告', blocker: 'too-big' };
  const feature = createPopoverStuck({ document: dom.document, $: dom.$, $$: () => [],
    syncPressedButtons() {}, showTransientStatus: (...args) => statuses.push(args), hideTransientStatus() {},
    blockerLabels: { 'too-big': '太大' },
    surfaceClient: { clarifyNowTask: (...args) => { writes.push(args); return { ok: true }; }, previewBreakdown() {}, requestStrategy() {} },
    taskActionMessage: value => value, unstickAdvice: { request() {}, clear() {} }, currentTask: () => task,
    renderNowCard() {}, canReceiveFocus: () => true, restoreModalFocus() {}, isAiEnabled: () => true,
    isStrategyGuidanceEnabled: () => true, openCollaboration: args => entries.push(args) });
  feature.mount(); dom.fire('#btnStuckCollaborate', 'click');
  assert.deepEqual(entries, [{ purpose: 'stuck', mode: 'small-step', taskId: 't1' }]);
  assert.deepEqual(feature.stageNextAction({ steps: [{ title: '打开空白文档' }] }, 't1'), { ok: true });
  assert.equal(dom.$('#shrinkNextAction').value, '打开空白文档'); assert.deepEqual(writes, []);
  assert.equal(dom.$('#stuckStepShrink').classList.contains('hidden'), false);
  task = { id: 't2', title: '另一个任务' };
  dom.fire('#shrinkConfirm', 'click'); await Promise.resolve();
  assert.deepEqual(writes, []); assert.match(statuses.at(-1)[1], /任务已变化/);
  assert.deepEqual(feature.stageNextAction({ steps: [{ title: '旧建议' }] }, 't1'), { ok: false, reason: 'target-changed' });
  task = { id: 't1', title: '报告' };
  dom.fire('#shrinkConfirm', 'click'); await Promise.resolve();
  assert.deepEqual(writes, [['t1', { nextAction: '打开空白文档', blocker: 'too-big' }]]);
  feature.dispose();
});

test('locale repaint preserves staged raw next action and its pending confirmation', async t => {
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN'); t.after(() => setLocale('zh-CN'));
  const dom = createCollaborationDom(), writes = []; let resolve;
  const feature = createPopoverStuck({ document: dom.document, $: dom.$, $$: () => [],
    syncPressedButtons() {}, showTransientStatus: (id, message) => { dom.$(id).textContent = message; }, hideTransientStatus() {},
    blockerLabels: {}, surfaceClient: { clarifyNowTask: (...args) => { writes.push(args); return new Promise(done => { resolve = done; }); },
      previewBreakdown() {}, requestStrategy() {} }, taskActionMessage: value => value,
    unstickAdvice: { request() {}, clear() {} }, currentTask: () => ({ id: 't1', title: '私有标题' }),
    renderNowCard() {}, canReceiveFocus: () => true, restoreModalFocus() {}, isAiEnabled: () => true, isStrategyGuidanceEnabled: () => true });
  feature.mount(); t.after(() => feature.dispose());
  feature.stageNextAction({ nextAction: '设置 <raw> {number}' }, 't1');
  const input = dom.$('#shrinkNextAction'); input.focus();
  dom.fire('#shrinkConfirm', 'click');
  setLocale('en');
  assert.equal(dom.$('#shrinkNextAction'), input); assert.equal(input.value, '设置 <raw> {number}');
  assert.equal(dom.document.activeElement, input); assert.equal(writes.length, 1);
  assert.match(dom.$('#shrinkSource').textContent, /Collaboration draft/);
  dom.fire('#shrinkConfirm', 'click'); assert.equal(writes.length, 1);
  resolve({ ok: false, reason: 'task-in-focus' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(feature.isOpen(), true); assert.equal(input.value, '设置 <raw> {number}');
});
