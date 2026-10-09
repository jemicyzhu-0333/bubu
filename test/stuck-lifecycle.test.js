'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverStuck } = require('../src/surfaces/popover/features/stuck.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function setup(t, ports = {}) {
  const dom = createCollaborationDom(), writes = [], statuses = [], advice = [];
  let feedbackClick;
  const feedback = { dataset: { helpful: 'true' }, addEventListener(type, fn) { feedbackClick = fn; }, removeEventListener() {} };
  let task = { id: 'a', title: '报告', blocker: 'too-big' };
  const previous = global.requestAnimationFrame;
  global.requestAnimationFrame = fn => fn();
  t.after(() => { global.requestAnimationFrame = previous; feature.dispose(); });
  const feature = createPopoverStuck({ document: dom.document, $: dom.$, $$: selector => selector === '.strategy-feedback' ? [feedback] : [],
    syncPressedButtons() {}, showTransientStatus: (...args) => statuses.push(args), hideTransientStatus() {},
    blockerLabels: { 'too-big': '太大' },
    surfaceClient: { clarifyNowTask: (...args) => { writes.push(args); return { ok: true }; },
      previewBreakdown: () => [], requestStrategy: () => ({ ok: false }), ...ports },
    taskActionMessage: value => value, unstickAdvice: { request: value => advice.push(value), clear() {} },
    currentTask: () => task, renderNowCard() {}, canReceiveFocus: () => true, restoreModalFocus() {},
    isAiEnabled: () => false, isStrategyGuidanceEnabled: () => true });
  feature.mount(); dom.fire('#btnStuck', 'click');
  return { ...dom, feature, writes, statuses, advice, rate() { feedbackClick(); }, setTask(value) { task = value; feature.syncBlockerForTask(task); } };
}
test('rendering a changed current task cannot remove the next-action draft target guard', async t => {
  const h = setup(t);
  h.feature.stageNextAction({ nextAction: '打开文档' }, 'a');
  h.setTask({ id: 'b', title: '另一件事' });
  h.fire('#shrinkConfirm', 'click'); await flush();
  assert.deepEqual(h.writes, []);
  assert.match(h.statuses.at(-1)[1], /任务已变化/);
});
test('an empty suggestion result still binds manually entered next action to its original task', async t => {
  const h = setup(t);
  h.fire('#btnRouteShrink', 'click'); await flush();
  h.$('#shrinkNextAction').value = '自己写的一步';
  h.setTask({ id: 'b', title: '另一件事' });
  h.fire('#shrinkConfirm', 'click'); await flush();
  assert.deepEqual(h.writes, []);
});
test('canceling a pending smaller-step request keeps its late result out of the route screen', async t => {
  const pending = deferred(); const h = setup(t, { previewBreakdown: () => pending.promise });
  h.fire('#btnRouteShrink', 'click');
  h.fire('#shrinkCancel', 'click');
  pending.resolve([{ title: '旧建议' }]); await flush();
  assert.equal(h.$('#stuckStepShrink').classList.contains('hidden'), true);
});
test('a strategy response arriving after close and reopen does not become rateable', async t => {
  const pending = deferred(); const feedback = []; const h = setup(t, { requestStrategy: () => pending.promise,
    sendStrategyFeedback: (...args) => feedback.push(args) });
  h.fire('#btnRouteTip', 'click'); h.feature.close(); h.fire('#btnStuck', 'click');
  pending.resolve({ ok: true, strategy: { id: 'old', text: '旧策略', detail: '', sourceTier: '' } }); await flush();
  assert.notEqual(h.$('#strategyText').textContent, '旧策略');
});
test('a delayed next-action save cannot close a reopened stuck dialog and repeated confirmation writes once', async t => {
  const pending = deferred(); let calls = 0;
  const h = setup(t, { clarifyNowTask: () => { calls++; return pending.promise; } });
  h.feature.stageNextAction({ nextAction: '打开文档' }, 'a');
  h.fire('#shrinkConfirm', 'click'); h.fire('#shrinkConfirm', 'click');
  assert.equal(calls, 1);
  h.feature.close(); h.fire('#btnStuck', 'click');
  pending.resolve({ ok: true }); await flush();
  assert.equal(h.feature.isOpen(), true);
});
test('switching away and back invalidates an earlier strategy request', async t => {
  const pending = deferred(); const h = setup(t, { requestStrategy: () => pending.promise });
  h.fire('#btnRouteTip', 'click');
  h.setTask({ id: 'b', title: '别的任务' }); h.setTask({ id: 'a', title: '报告' });
  pending.resolve({ ok: true, strategy: { id: 'old', text: '旧策略', detail: '', sourceTier: '' } }); await flush();
  assert.notEqual(h.$('#strategyText').textContent, '旧策略');
});
test('delayed strategy feedback cannot clear a newer strategy or submit the old rating twice', async t => {
  const pending = deferred(); const rated = []; let sequence = 0;
  const h = setup(t, { requestStrategy: () => ({ ok: true, strategy: { id: `s${++sequence}`, text: '办法', detail: '', sourceTier: '' } }),
    sendStrategyFeedback: id => { rated.push(id); return id === 's1' ? pending.promise : Promise.resolve({ ok: true }); } });
  h.fire('#btnRouteTip', 'click'); await flush(); h.rate(); h.rate();
  assert.deepEqual(rated, ['s1']);
  h.fire('#btnStrategyRequest', 'click'); await flush();
  pending.resolve({ ok: true }); await flush(); h.rate(); await flush();
  assert.deepEqual(rated, ['s1', 's2']);
});
test('a failed strategy request is handled without installing a rateable stale strategy', async t => {
  const h = setup(t, { requestStrategy: () => Promise.reject(new Error('offline')) });
  h.fire('#btnRouteTip', 'click'); await flush();
  assert.match(h.statuses.at(-1)[1], /重试/);
});

test('a resolved feedback refusal stays retryable and never reports a successful save', async t => {
  const rated = [];
  const h = setup(t, {
    requestStrategy: () => ({ ok: true, strategy: { id: 's1', text: '办法', detail: '', sourceTier: '' } }),
    sendStrategyFeedback: id => {
      rated.push(id);
      return rated.length === 1 ? { ok: false, reason: 'persistence-failed' } : { ok: true };
    }
  });
  h.fire('#btnRouteTip', 'click'); await flush(); h.rate(); await flush();
  assert.match(h.statuses.at(-1)[1], /没能保存.*重试/);
  h.rate(); await flush();
  assert.deepEqual(rated, ['s1', 's1']); assert.equal(h.statuses.at(-1)[1], '已记在本机。');
});

test('a reopened next-action draft saves independently and old cleanup cannot unlock it', async t => {
  const old = deferred(), current = deferred(), targets = [];
  const h = setup(t, { clarifyNowTask: id => {
    targets.push(id); return targets.length === 1 ? old.promise : current.promise;
  } });
  h.feature.stageNextAction({ nextAction: '原来的下一步' }, 'a'); h.fire('#shrinkConfirm', 'click');
  h.feature.close(); h.fire('#btnStuck', 'click'); h.setTask({ id: 'b', title: '新任务' });
  h.feature.stageNextAction({ nextAction: '新的下一步' }, 'b'); h.fire('#shrinkConfirm', 'click');
  assert.deepEqual(targets, ['a', 'b']);
  old.resolve({ ok: true }); await flush();
  assert.equal(h.feature.isOpen(), true); assert.equal(h.$('#shrinkNextAction').value, '新的下一步');
  h.fire('#shrinkConfirm', 'click'); assert.deepEqual(targets, ['a', 'b']);
  current.resolve({ ok: true }); await flush(); assert.equal(h.feature.isOpen(), false);
});

test('queued focus from open and an abandoned route cannot target hidden controls', async t => {
  const h = setup(t), frames = [];
  global.requestAnimationFrame = callback => frames.push(callback);
  h.feature.close(); h.fire('#btnStuck', 'click'); h.feature.close();
  const closeFocus = h.$('#stuckClose').focused;
  frames.shift()(); assert.equal(h.$('#stuckClose').focused, closeFocus);
  h.fire('#btnStuck', 'click'); frames.shift()();
  h.fire('#btnRouteShrink', 'click'); await flush();
  h.fire('#shrinkCancel', 'click');
  const shrinkFocus = h.$('#shrinkNextAction').focused;
  frames.shift()(); assert.equal(h.$('#shrinkNextAction').focused, shrinkFocus);
  frames.shift()(); assert.equal(h.$('#btnRouteShrink').focused, 1);
});
