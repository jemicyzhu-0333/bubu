'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverUnstickAdvice } = require('../src/surfaces/popover/features/unstick-advice.mjs');

const ROOT = path.resolve(__dirname, '..');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// The block only ever touches innerHTML and the hidden class, so a literal stub
// observes everything it decides. No listeners: the module registers none.
function createHarness(respond) {
  const node = {
    innerHTML: '',
    hidden: true,
    classList: {
      add(name) { if (name === 'hidden') node.hidden = true; },
      remove(name) { if (name === 'hidden') node.hidden = false; }
    }
  };
  const calls = [];
  const advice = createPopoverUnstickAdvice({
    $: selector => (selector === '#unstickBlock' ? node : null),
    escapeHTML,
    surfaceClient: {
      suggestUnstick: payload => {
        calls.push(payload);
        return respond ? respond(payload, calls.length) : Promise.resolve(null);
      }
    }
  });
  return { advice, node, calls };
}

const ADVICE = Object.freeze({
  ok: true,
  provider: 'api',
  fallback: false,
  reason: null,
  nextAction: '把第一段标题写出来',
  why: '有了标题后面就有落点',
  fallbackAction: '打开文档就算完成',
  splitSteps: ['写标题', '写一句话摘要']
});

test('the unstick advice block exposes a frozen surface and refuses to run without its dependencies', () => {
  const { advice } = createHarness();
  assert.ok(Object.isFrozen(advice));
  assert.deepEqual(Object.keys(advice).sort(), ['clear', 'request']);
  assert.throws(() => createPopoverUnstickAdvice({}), TypeError);
  assert.throws(
    () => createPopoverUnstickAdvice({ $: () => null, escapeHTML }),
    TypeError,
    'a missing command is a wiring bug, not something to degrade around'
  );
});

test('the markup the advice block writes into exists in the popover document', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
  assert.match(html, /id="unstickBlock"/, 'the block the feature paints into must be in the document');
  assert.match(html, /id="unstickBlock"[^>]*role="status"/, 'advice arrives late, so it has to be announced');
});

test('asking without a selected task writes nothing, because advice needs something to be about', async () => {
  const { advice, node, calls } = createHarness();
  await advice.request({ taskId: null });
  assert.deepEqual(calls, [], 'no target means no request leaves the machine');
  assert.equal(node.innerHTML, '');
  assert.equal(node.hidden, true);
});

test('a pending line shows while the request is out, then the advice replaces it', async () => {
  let resolve = null;
  const { advice, node, calls } = createHarness(() => new Promise(done => { resolve = done; }));
  const pending = advice.request({ taskId: 'task-1', note: '卡在：太大了' });
  assert.deepEqual(calls, [{ taskId: 'task-1', note: '卡在：太大了' }]);
  assert.match(node.innerHTML, /正在想/, 'the wait is visible in this block only');
  assert.equal(node.hidden, false);
  resolve(ADVICE);
  await pending;
  assert.match(node.innerHTML, /把第一段标题写出来/);
  assert.match(node.innerHTML, /有了标题后面就有落点/);
  assert.match(node.innerHTML, /打开文档就算完成/);
  assert.match(node.innerHTML, /写一句话摘要/);
  assert.match(node.innerHTML, /AI 建议/);
  assert.doesNotMatch(node.innerHTML, /正在想/);
});

test('a fallback says which source answered and why, instead of passing a template off as the model', async () => {
  const { advice, node } = createHarness(() => Promise.resolve({
    ...ADVICE, provider: 'deterministic', fallback: true, reason: 'timeout'
  }));
  await advice.request({ taskId: 'task-1' });
  assert.match(node.innerHTML, /本地建议（timeout）/);
});

test('a fallback with no stated reason still admits it is local', async () => {
  const { advice, node } = createHarness(() => Promise.resolve({
    ...ADVICE, provider: 'deterministic', fallback: true, reason: null
  }));
  await advice.request({ taskId: 'task-1' });
  assert.match(node.innerHTML, /本地建议（未提供原因）/);
});

test('a fallback action identical to the next action does not earn its own line', async () => {
  const { advice, node } = createHarness(() => Promise.resolve({
    ...ADVICE, fallbackAction: ADVICE.nextAction
  }));
  await advice.request({ taskId: 'task-1' });
  assert.doesNotMatch(node.innerHTML, /做不动就先做/, 'repeating the same sentence is not another route');
});

test('每一种「目标不在了」都有一句人话，别的原因落到同一句', async () => {
  const cases = [
    ['task-not-found', /已经不在了/],
    ['task-completed', /已经完成了/],
    ['occurrence-skipped', /已经跳过了/],
    ['proposal-target-changed', /刚被改过/],
    ['no-credential', /这次没想出来/]
  ];
  for (const [reason, expected] of cases) {
    const { advice, node } = createHarness(() => Promise.resolve({ ok: false, reason }));
    await advice.request({ taskId: 'task-1' });
    assert.match(node.innerHTML, expected, reason);
  }
});

test('a thrown request reads as a miss, not as a blank block', async () => {
  const { advice, node } = createHarness(() => Promise.reject(new Error('bridge gone')));
  await advice.request({ taskId: 'task-1' });
  assert.match(node.innerHTML, /这次没想出来/);
  assert.equal(node.hidden, false);
});

test('a slow earlier answer cannot paint over a later one', async () => {
  const pendings = [];
  const { advice, node } = createHarness(() => new Promise(done => { pendings.push(done); }));
  const first = advice.request({ taskId: 'task-1' });
  const second = advice.request({ taskId: 'task-1' });
  pendings[1]({ ...ADVICE, nextAction: '第二次的答案' });
  await second;
  pendings[0]({ ...ADVICE, nextAction: '第一次的答案' });
  await first;
  assert.match(node.innerHTML, /第二次的答案/);
  assert.doesNotMatch(node.innerHTML, /第一次的答案/, 'the stale answer is dropped, not merged');
});

test('clearing empties the block and drops whatever is still in flight', async () => {
  let resolve = null;
  const { advice, node } = createHarness(() => new Promise(done => { resolve = done; }));
  const pending = advice.request({ taskId: 'task-1' });
  advice.clear();
  assert.equal(node.innerHTML, '');
  assert.equal(node.hidden, true);
  resolve(ADVICE);
  await pending;
  assert.equal(node.innerHTML, '', 'advice for a closed sheet would read as advice about the next task');
});

test('a missing block is survivable, because the sheet can close mid-request', async () => {
  const advice = createPopoverUnstickAdvice({
    $: () => null,
    escapeHTML,
    surfaceClient: { suggestUnstick: () => Promise.resolve(ADVICE) }
  });
  await advice.request({ taskId: 'task-1' });
  advice.clear();
});
