'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverProgressFeature } = require('../src/surfaces/popover/features/progress.mjs');
const { createPopoverTimelineFeature } = require('../src/surfaces/popover/features/timeline.mjs');
const { createPopoverCompletionFeedback } = require('../src/surfaces/popover/features/completion-feedback.mjs');
const { createPopoverCompleteConfirm } = require('../src/surfaces/popover/features/complete-confirm.mjs');

function element() {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  const node = {
    children: [], style: {}, textContent: '', focus() {},
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    appendChild: child => node.children.push(child),
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
    dispatch: (name, event = {}) => listeners.get(name)?.(event),
    contains: other => other === node,
    querySelector: () => null,
    querySelectorAll: () => node.children.flatMap(child => child.children.length ? child.children : [child])
  };
  let html = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => html,
    set: value => { html = value; node.children = []; }
  });
  return node;
}

function documentFixture() {
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  return { $, document: { createElement: element } };
}

function detailMetrics(markup) {
  return Object.fromEntries([...markup.matchAll(/data-progress-metric="([a-z]+)"><b>([^<]*)<\/b>/g)]
    .map(([, name, value]) => [name, value]));
}

test('heatmap keyboard selection preserves focus nodes and refreshes all four recorded metrics', () => {
  const { $, document } = documentFixture();
  let state = {
    serverNow: new Date(2026, 8, 12, 12).getTime(),
    stats: {
      dailyFocus: { '2026-09-12': 60000 }, dailyReturns: { '2026-09-12': 2 },
      dailyCompletions: { '2026-09-12': 3 }, dailyLaunches: { '2026-09-12': 4 }
    }
  };
  // The selected day is handed to the timeline feature, and only from a user action:
  // a stats diff must not turn into another read of the fact store.
  const announced = [];
  const feature = createPopoverProgressFeature({
    document, $, getState: () => state, formatMs: value => `${value / 60000}分`, escapeHTML: String,
    onDaySelected: dayKey => announced.push(dayKey)
  });
  feature.renderStats();
  const cell = $('#heatmap').children.at(-1).children.at(-1);
  assert.equal(cell.getAttribute('role'), 'button');
  assert.equal(cell.getAttribute('data-day'), '2026-09-12');
  assert.equal(cell.getAttribute('data-completions'), '3');
  assert.match(cell.getAttribute('aria-label'), /完成 3 件/);
  let prevented = false;
  cell.dispatch('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(cell.getAttribute('aria-pressed'), 'true');
  assert.equal($('#heatmap').children.at(-1).children.at(-1), cell);
  assert.deepEqual(detailMetrics($('#heatmapDetail').innerHTML), {
    focus: '1分', completions: '3', launches: '4', returns: '2'
  });
  assert.doesNotMatch($('#heatmapDetail').innerHTML, /hm-bar/);
  state = { ...state, stats: {
    dailyFocus: { '2026-09-12': 120000 }, dailyCompletions: { '2026-09-12': 4 },
    dailyLaunches: { '2026-09-12': 5 }, dailyReturns: { '2026-09-12': 3 }
  } };
  feature.renderStats();
  assert.deepEqual(detailMetrics($('#heatmapDetail').innerHTML), {
    focus: '2分', completions: '4', launches: '5', returns: '3'
  });
  feature.selectHeatmapDay('2026-09-12');
  assert.equal($('#heatmapDetail').classList.contains('hidden'), true);
  // Select on Enter, deselect on the second press — and the re-render in between
  // announced nothing.
  assert.deepEqual(announced, ['2026-09-12', null]);
});

test('zero heatmap metrics explain their scope while the selected day still shows routine actions', async () => {
  const { $, document } = documentFixture();
  const dayStart = new Date(2026, 8, 12).getTime();
  const state = { serverNow: dayStart, stats: {}, routines: { items: [{ id: 'tea', title: '喝茶' }] } };
  const timeline = createPopoverTimelineFeature({
    document, $, getState: () => state, formatMs: String, escapeHTML: String,
    surfaceClient: { getTimelineDay: async dayKey => ({ ok: true, day: {
      dayKey, dayStart, dayEnd: new Date(2026, 8, 13).getTime(),
      rangeStart: dayStart, rangeEnd: dayStart + 1, lanes: [],
      markers: [{ kind: 'routine.logged', occurredAt: dayStart, routineId: 'tea', status: 'done' }]
    } }) }
  });
  let timelineRead;
  const feature = createPopoverProgressFeature({
    document, $, getState: () => state,
    formatMs: value => `${value / 60000}分`, escapeHTML: String,
    onDaySelected: day => { timelineRead = timeline.showDay(day); }
  });
  feature.renderStats();
  feature.selectHeatmapDay('2026-09-12');
  const detail = $('#heatmapDetail').innerHTML;
  assert.deepEqual(detailMetrics(detail), { focus: '0分', completions: '0', launches: '0', returns: '0' });
  assert.match(detail, /日常等具体活动记录在下方时间线中/);
  assert.match(detail, /统计为零，不代表没有行动/);
  assert.doesNotMatch(detail, /这一天没有记录/);
  await timelineRead;
  assert.match($('#timelineTrack').innerHTML, /喝茶/);
  assert.doesNotMatch($('#timelineTrack').innerHTML, /暂无活动记录/);
  assert.equal($('#timelineTotals').textContent, '1 条活动 · 专注 0');
});

test('completion feedback replaces timers and level-up remains a non-blocking announcement', () => {
  const { $, document } = documentFixture();
  const queued = new Map();
  let counter = 0;
  let celebrations = 0;
  const feature = createPopoverCompletionFeedback({
    document, $, celebrate: () => { celebrations += 1; },
    timers: {
      setTimeout: callback => { queued.set(++counter, callback); return counter; },
      clearTimeout: id => queued.delete(id)
    }
  });
  feature.announceCompletion({ nextOccurrenceDate: '2026-09-13' });
  assert.match($('#finishToast').textContent, /下次 9\/13/);
  feature.announceCompletion({});
  assert.equal(queued.size, 1);
  assert.equal($('#finishToast').textContent, '已完成');
  feature.celebrateLevelUp(3);
  assert.equal($('#levelUpBadge').textContent, 'LV.3');
  assert.equal($('#levelUpCard').getAttribute('aria-hidden'), 'false');
  assert.equal(celebrations, 1);
  feature.dispose();
  assert.equal(queued.size, 0);
});

test('completion is single-flight and a presentation failure cannot report the committed task as failed', async () => {
  const { $, document } = documentFixture();
  let resolve;
  let calls = 0;
  const statuses = [];
  const announcements = [];
  const feature = createPopoverCompleteConfirm({
    document, $, surfaceClient: { completeTask: () => {
      calls += 1;
      return new Promise(complete => { resolve = complete; });
    } },
    celebrate: () => { throw new Error('canvas unavailable'); },
    onCompleted: result => announcements.push(result), restoreModalFocus() {},
    showPanelStatus: value => statuses.push(typeof value === 'function' ? value() : value), taskActionMessage: String
  });
  const pending = feature.completeTask({ id: 'task' });
  await feature.completeTask({ id: 'task' });
  assert.equal(calls, 1);
  resolve({ ok: true, nextOccurrenceDate: '2026-09-13' });
  await pending;
  assert.equal(announcements.length, 1);
  assert.deepEqual(statuses, []);
});

test('unfinished completion confirms the captured task once and late rejection cannot reopen a closed dialog', async () => {
  const { $, document } = documentFixture();
  const calls = [];
  let resolve;
  const feature = createPopoverCompleteConfirm({
    document, $, requestFrame: callback => callback(),
    surfaceClient: { completeTask: (id, options) => {
      calls.push({ id, options });
      if (!options) return Promise.resolve({ ok: false, reason: 'unfinished-steps-need-confirmation', unfinishedCount: 2 });
      return new Promise(complete => { resolve = complete; });
    } },
    celebrate() {}, onCompleted() {}, restoreModalFocus() {}, showPanelStatus() {}, taskActionMessage: String
  });
  feature.mount();
  await feature.completeTask({ id: 'captured', title: 'Task' });
  assert.equal(feature.isOpen(), true);
  const pending = $('#completeConfirmOk').dispatch('click');
  await $('#completeConfirmOk').dispatch('click');
  assert.deepEqual(calls, [
    { id: 'captured', options: undefined },
    { id: 'captured', options: { confirmUnfinishedSteps: true } }
  ]);
  feature.close();
  resolve({ ok: false, reason: 'stale-revision' });
  await pending;
  assert.equal(feature.isOpen(), false);
  assert.equal($('#completeConfirmError').classList.contains('hidden'), true);
  feature.dispose();
});

test('a completion that carries an undo ticket shows an undo button that runs once and then says what happened', async () => {
  const { $, document } = documentFixture();
  const created = [];
  document.createElement = tag => {
    const node = $(`created:${tag}:${created.length}`);
    node.tagName = tag.toUpperCase();
    node.style = {};
    node.setAttribute = () => {};
    node.listeners = {};
    node.addEventListener = (type, handler) => { node.listeners[type] = handler; };
    created.push(node);
    return node;
  };
  const toast = $('#finishToast');
  toast.replaceChildren = (...children) => { toast.children = children; };
  const queued = new Map();
  let counter = 0;
  const calls = [];
  const feature = createPopoverCompletionFeedback({
    document, $, celebrate: () => {},
    surfaceClient: { undoComplete: async token => { calls.push(token); return { ok: true, taskId: 't' }; } },
    timers: { setTimeout: (callback, ms) => { queued.set(++counter, { callback, ms }); return counter; }, clearTimeout: id => queued.delete(id) }
  });
  feature.announceCompletion({ nextOccurrenceDate: null, undo: { token: 'undo-1', ttlMs: 5000 } });
  assert.equal(toast.children.length, 3, 'label, button, countdown bar');
  const [label, button, bar] = toast.children;
  assert.equal(label.textContent, '已完成');
  assert.equal(button.textContent, '撤销');
  assert.equal(bar.style.animationDuration, '5000ms');
  assert.deepEqual([...queued.values()].map(entry => entry.ms), [5000], 'the bar stays for the whole countdown, not the usual 2 seconds');
  assert.equal(toast.classList.contains('has-undo'), true);

  await button.listeners.click();
  assert.deepEqual(calls, ['undo-1']);
  assert.equal(button.disabled, true, 'one tap, one undo');
  assert.equal(toast.textContent, '已撤销，这件事回到待办');
  assert.equal(toast.classList.contains('has-undo'), false);

  // 被拒绝（过期或状态变了）：说实话，不假装成功。
  const refusing = createPopoverCompletionFeedback({
    document, $, celebrate: () => {},
    surfaceClient: { undoComplete: async () => ({ ok: false, reason: 'undo-state-changed' }) },
    timers: { setTimeout: () => 1, clearTimeout: () => {} }
  });
  refusing.announceCompletion({ undo: { token: 'undo-2', ttlMs: 5000 } });
  await toast.children[1].listeners.click();
  assert.equal(toast.textContent, '已经不能撤销了');

  // 没有凭据（升级、专注中等）：还是原来的两秒提示，没有按钮。
  const plain = createPopoverCompletionFeedback({
    document, $, celebrate: () => {}, surfaceClient: { undoComplete: async () => ({ ok: true }) },
    timers: { setTimeout: () => 1, clearTimeout: () => {} }
  });
  plain.announceCompletion({});
  assert.equal(toast.textContent, '已完成');
  assert.equal(toast.classList.contains('has-undo'), false);
});

test('completion confirmation translates count and errors without changing its pending task', async t => {
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN'); t.after(() => setLocale('zh-CN'));
  const { $, document } = documentFixture(); const calls = []; let resolve;
  const feature = createPopoverCompleteConfirm({ document, $, requestFrame: callback => callback(),
    surfaceClient: { completeTask: (id, options) => { calls.push([id, options]);
      return !options ? Promise.resolve({ ok: false, reason: 'unfinished-steps-need-confirmation', unfinishedCount: 2 })
        : new Promise(done => { resolve = done; }); } },
    celebrate() {}, restoreModalFocus() {}, showPanelStatus() {}, taskActionMessage: String });
  feature.mount(); t.after(() => feature.dispose());
  await feature.completeTask({ id: 'one', title: '任务 <raw>' });
  const confirm = $('#completeConfirmOk'); const pending = confirm.dispatch('click');
  setLocale('en'); assert.equal($('#completeConfirmOk'), confirm); assert.equal(confirm.disabled, true);
  assert.equal($('#completeConfirmTask').textContent, '“任务 <raw>” has 2 unfinished steps.');
  await confirm.dispatch('click'); assert.equal(calls.length, 2);
  resolve({ ok: false }); await pending;
  assert.match($('#completeConfirmError').textContent, /Completion failed/);
  setLocale('zh-CN'); assert.match($('#completeConfirmError').textContent, /没有完成成功/);
});
