'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTimelineMoodDeletion } = require('../src/surfaces/popover/features/timeline-mood-deletion.mjs');
const { createPopoverTimelineFeature } = require('../src/surfaces/popover/features/timeline.mjs');

const ROOT = path.resolve(__dirname, '..');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function makeClassList(initial = []) {
  const names = new Set(initial);
  return {
    names,
    add(name) { names.add(name); },
    remove(name) { names.delete(name); },
    toggle(name, on) { if (on) names.add(name); else names.delete(name); },
    contains(name) { return names.has(name); }
  };
}

// Literal stub (this repo has no jsdom). The track is write-only markup; the viewport is
// the one node that carries real state — scrollLeft (auto-centre + drag) and clientWidth
// (how much of the track shows). A node that remembers those is enough to observe what
// the feature did.
function createDom() {
  const listeners = new Map();
  const nodes = {};
  for (const selector of ['#timelineDay', '#timelineTitle', '#timelineTotals', '#timelineGuide',
    '#timelineViewport', '#timelineTrack', '#timelineDetail', '#timelineDeleteStatus', '#timelineDeleteLabel', '#timelineDeleteRetry', '#timelineDeleteDismiss']) {
    nodes[selector] = {
      selector,
      innerHTML: '',
      textContent: '',
      dataset: {},
      style: {},
      scrollLeft: 0,
      clientWidth: 0,
      classList: makeClassList(['hidden']),
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
  }
  const $ = selector => nodes[selector] || null;
  const fire = (selector, type, event) => {
    const handler = listeners.get(`${selector}:${type}`);
    assert.ok(handler, `${selector} must listen for ${type}`);
    handler(event);
  };
  return { nodes, listeners, $, fire, document: { hidden: false,
    addEventListener(type, handler) { listeners.set(`#document:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`#document:${type}`); },
    defaultView: { addEventListener(type, handler) { listeners.set(`#window:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`#window:${type}`); } } } };
}

// A fake segment element for pointer taps: it answers closest('.tl-seg') as itself and
// carries the detail string the feature reads back out.
function segmentStub(detail) {
  const element = {
    attributes: { 'data-detail': detail },
    classList: makeClassList(),
    getAttribute(name) { return this.attributes[name]; }
  };
  return element;
}
function down(target, clientX = 100) {
  return { button: 0, clientX, pointerId: 1, target: { closest: () => target } };
}

// Local wall-clock times, because the axis labels are local by construction.
const at = (hour, minute = 0) => new Date(2026, 8, 18, hour, minute, 0, 0).getTime();
const DAY_KEY = '2026-09-18';

const DAY = Object.freeze({
  dayKey: DAY_KEY,
  dayStart: at(0),
  dayEnd: new Date(2026, 8, 19).getTime(),
  rangeStart: at(8),
  rangeEnd: at(12),
  lanes: [
    { taskId: 't1', focusMs: 1500000, segments: [{ sessionId: 'session-1', startMs: at(9), endMs: at(9, 25), durationMs: 1500000, sessionKind: 'focus' }] },
    { taskId: null, other: true, focusMs: 60000, segments: [{ startMs: at(10), endMs: at(10, 1), durationMs: 60000 }] }
  ],
  markers: [
    { occurredAt: at(8, 30), kind: 'routine.logged', routineId: 'med', routineKind: 'medication', status: 'done' },
    { occurredAt: at(9), kind: 'session.started', sessionId: 'session-1', taskId: 't1', sessionKind: 'focus' },
    { occurredAt: at(10), kind: 'routine.logged', routineId: 'tea', routineKind: 'stimulant', status: 'done' }
  ],
  totals: { focusMs: 1560000, segmentCount: 2, sessionCount: 1, completedTaskCount: 1, markerCount: 3 }
});

function createHarness({
  day = DAY, tasks = [{ id: 't1', title: '写周报' }], clientWidth = 0, energyCurve = null,
  routines = [{ id: 'med', title: '吃药' }, { id: 'tea', title: '喝茶' }], serverNow = at(12),
  moodDeletion = null, moodNotes = [], deleteMoodNote = () => Promise.resolve({ ok: true, changed: true, localDeleted: true })
} = {}) {
  const dom = createDom();
  dom.nodes['#timelineViewport'].clientWidth = clientWidth;
  const asked = [];
  let notify = null, hiddenNotify = null;
  let pending = null;
  // The channel answers with an envelope, not a bare day. The fixture has to speak the
  // shape the channel actually produces, or the surface is verified against a shape that
  // never arrives (which is exactly how the unwrapping bug survived).
  const envelope = value => ({ ok: true, day: value, energyCurve });
  const feature = createPopoverTimelineFeature({
    document: dom.document,
    $: dom.$,
    moodDeletion,
    getState: () => ({ tasks, archivedTasks: [], routines: { items: routines }, serverNow, moodNotes }),
    escapeHTML,
    formatMs: value => `${Math.round(value / 60000)}分`,
    surfaceClient: {
      deleteMoodNote,
      onPopoverHidden(listener) { hiddenNotify = listener; return () => { hiddenNotify = null; }; },
      getTimelineDay(dayKey) {
        asked.push(dayKey);
        if (pending) return new Promise(resolve => pending.push({ dayKey, resolve: value => resolve(envelope(value)) }));
        return Promise.resolve(envelope(typeof day === 'function' ? day(dayKey) : day));
      }
    }
  });
  feature.mount({ subscribe(listener) { notify = listener; return () => { notify = null; }; } });
  return {
    dom, feature, asked,
    hideNative() { hiddenNotify?.(); },
    emit(dirty) { if (notify) notify({ dirty }); },
    defer() { pending = []; return pending; },
    node: selector => dom.nodes[selector]
  };
}

test('the feature requires its scoped renderer dependencies and freezes its surface', () => {
  assert.throws(() => createPopoverTimelineFeature(), /scoped renderer dependencies/);
  // A missing channel is the one that used to slip through as an optional; keep it required.
  assert.throws(() => createPopoverTimelineFeature({
    document: {}, $: () => null, getState: () => ({}), escapeHTML, formatMs: String
  }), /scoped renderer dependencies/);
  const feature = createPopoverTimelineFeature({
    document: {}, $: () => null, getState: () => ({}), escapeHTML, formatMs: String,
    surfaceClient: { getTimelineDay: () => Promise.resolve(null) }
  });
  assert.equal(Object.isFrozen(feature), true);
});

test('a day reads top to bottom: parts of the day, focus spans with durations, and life records', async () => {
  const harness = createHarness();
  await harness.feature.showDay(DAY_KEY);
  assert.deepEqual(harness.asked, [DAY_KEY]);
  assert.equal(harness.node('#timelineDay').classList.contains('hidden'), false);
  assert.equal(harness.node('#timelineTitle').textContent, DAY_KEY);
  assert.equal(harness.node('#timelineTotals').textContent, '4 条活动 · 专注 26分');
  const track = harness.node('#timelineTrack').innerHTML;
  assert.match(track, /<ol class="tl-list">/);
  assert.match(track, /<li class="tl-part">上午<\/li>/);
  const details = [...track.matchAll(/data-detail="([^"]*)"/g)].map(match => match[1]);
  assert.deepEqual(details, [
    '08:30 · 做了 · 吃药',
    '09:00–09:25 · 专注 25分 · 写周报',
    '10:00–10:01 · 专注 1分 · 其他',
    '10:00 · 做了 · 喝茶'
  ]);
  // The start marker explicitly belongs to the same session as the span.
  assert.doesNotMatch(track, /开始专注/);
});

test('an independent nearby start remains visible in the activity total and rendered rows', async () => {
  const harness = createHarness({ day: { ...DAY, markers: DAY.markers.map(marker =>
    marker.kind === 'session.started' ? { ...marker, sessionId: 'session-2' } : marker) } });
  await harness.feature.showDay(DAY_KEY);
  assert.equal(harness.node('#timelineTotals').textContent, '5 条活动 · 专注 26分');
  assert.match(harness.node('#timelineTrack').innerHTML, /09:00 · 开始专注 · 写周报/);
});

test('a focus span carries a duration bar that never collapses to nothing', async () => {
  const harness = createHarness();
  await harness.feature.showDay(DAY_KEY);
  const widths = [...harness.node('#timelineTrack').innerHTML.matchAll(/class="tl-bar" style="--w:(\d+)%"/g)]
    .map(match => Number(match[1]));
  assert.deepEqual(widths, [28, 6]);
});

test('a long stretch without records is stated, not hidden', async () => {
  const long = {
    dayKey: DAY_KEY, dayStart: at(0), dayEnd: new Date(2026, 8, 19).getTime(),
    rangeStart: at(13), rangeEnd: at(17),
    lanes: [
      { taskId: 't1', focusMs: 60000, segments: [{ startMs: at(13), endMs: at(13, 1), durationMs: 60000 }] },
      { taskId: 't2', focusMs: 3600000, segments: [{ startMs: at(16), endMs: at(17), durationMs: 3600000 }] }
    ],
    totals: { focusMs: 3660000, segmentCount: 2, completedTaskCount: 0 }
  };
  const harness = createHarness({ day: long, tasks: [{ id: 't1', title: 'a' }, { id: 't2', title: 'b' }] });
  await harness.feature.showDay(DAY_KEY);
  assert.match(harness.node('#timelineTrack').innerHTML, /2 小时 59 分没有记录/);
});

test('tapping a row reveals its detail; tapping it again or the rail hides it', async () => {
  const harness = createHarness();
  await harness.feature.showDay(DAY_KEY);
  const detail = harness.node('#timelineDetail');
  assert.equal(detail.classList.contains('hidden'), true);
  const seg = segmentStub('09:00–09:25 · 专注 25分 · 写周报');
  harness.dom.fire('#timelineViewport', 'click', { target: { closest: () => seg } });
  assert.equal(detail.textContent, '09:00–09:25 · 专注 25分 · 写周报');
  assert.equal(detail.classList.contains('hidden'), false);
  assert.equal(seg.classList.contains('active'), true);
  harness.dom.fire('#timelineViewport', 'click', { target: { closest: () => seg } });
  assert.equal(detail.classList.contains('hidden'), true);
  harness.dom.fire('#timelineViewport', 'click', { target: { closest: () => seg } });
  harness.dom.fire('#timelineViewport', 'click', { target: { closest: () => null } });
  assert.equal(detail.classList.contains('hidden'), true);
  assert.equal(detail.textContent, '');
  assert.equal(seg.classList.contains('active'), false);
});

test('keyboard activation of a row reveals its time and action', async () => {
  const harness = createHarness();
  await harness.feature.showDay(DAY_KEY);
  const card = segmentStub('08:30 · 做了 · 吃药');
  harness.dom.fire('#timelineViewport', 'click', { detail: 0, target: { closest: () => card } });
  assert.equal(harness.node('#timelineDetail').textContent, '08:30 · 做了 · 吃药');
  assert.equal(card.classList.contains('active'), true);
});

test('the channel envelope is unwrapped, so a day actually reaches the chart', async () => {
  // timeline:getDay answers {ok, day, energyCurve}. Reading that object as the day makes
  // `day.dayKey` undefined, which fails the freshness check and renders the empty state
  // for every single day. No layer between here and the handler unwraps it.
  const dom = createDom();
  const responses = [];
  const feature = createPopoverTimelineFeature({
    document: dom.document,
    $: dom.$,
    getState: () => ({ tasks: [{ id: 't1', title: '写周报' }], archivedTasks: [] }),
    escapeHTML,
    formatMs: value => `${Math.round(value / 60000)}分`,
    surfaceClient: { getTimelineDay: () => Promise.resolve(responses.shift()) }
  });
  feature.mount();
  responses.push({ ok: true, day: DAY, energyCurve: null });
  await feature.showDay(DAY_KEY);
  assert.equal(dom.nodes['#timelineDay'].classList.contains('is-empty'), false,
    '信封拆开之后这一天必须真的画出来');
  assert.match(dom.nodes['#timelineTrack'].innerHTML, /tl-seg/);

  // A refused read is an envelope too, and it means the empty state — not a crash.
  responses.push({ ok: false, reason: 'timeline-unavailable' });
  await feature.showDay(DAY_KEY);
  assert.equal(dom.nodes['#timelineDay'].classList.contains('is-empty'), true);
});

test('a superseded response never paints over the day that is actually selected', async () => {
  const harness = createHarness();
  const pending = harness.defer();
  const first = harness.feature.showDay('2026-09-17');
  const second = harness.feature.showDay(DAY_KEY);
  assert.deepEqual(harness.asked, ['2026-09-17', DAY_KEY]);
  // The second click resolves first; then yesterday's projection finally arrives.
  pending[1].resolve(DAY);
  await second;
  pending[0].resolve({ ...DAY, dayKey: '2026-09-17', totals: { ...DAY.totals, focusMs: 0, segmentCount: 9 } });
  await first;
  assert.equal(harness.node('#timelineTitle').textContent, DAY_KEY);
  assert.equal(harness.node('#timelineTotals').textContent, '4 条活动 · 专注 26分');
});

test('a day without recorded actions still shows the energy estimate and says why the list is empty', async () => {
  const harness = createHarness({
    day: { dayKey: DAY_KEY, dayStart: at(0), dayEnd: at(24), rangeStart: null, rangeEnd: null,
      lanes: [], markers: [], intervals: [], totals: {} },
    energyCurve: { dayKey: DAY_KEY, sampleMinutes: 720, levels: [35, 60], nowMinute: 720, nowLevel: 60 }
  });
  await harness.feature.showDay(DAY_KEY);
  assert.equal(harness.node('#timelineDay').classList.contains('is-empty'), false);
  const track = harness.node('#timelineTrack').innerHTML;
  assert.match(track, /tl-spark-line/);
  assert.match(track, /暂无活动记录/);
  assert.match(track, /没有逐条记录，不代表没有行动/);
  assert.doesNotMatch(track, /tl-event|tl-seg/);
  assert.equal(harness.node('#timelineTotals').textContent, '');
});

test('a failed or mismatched read degrades to the empty state instead of throwing', async () => {
  const rejecting = createHarness({ day: () => { throw new Error('sqlite is gone'); } });
  await rejecting.feature.showDay(DAY_KEY);
  assert.equal(rejecting.node('#timelineDay').classList.contains('is-empty'), true);
  assert.equal(rejecting.node('#timelineDetail').textContent, '暂时无法读取活动记录');
  assert.doesNotMatch(rejecting.node('#timelineDetail').textContent, /暂无活动记录/);

  const mismatched = createHarness({ day: { ...DAY, dayKey: '2026-01-01' } });
  await mismatched.feature.showDay(DAY_KEY);
  assert.equal(mismatched.node('#timelineDay').classList.contains('is-empty'), true);
  assert.equal(mismatched.node('#timelineTitle').textContent, DAY_KEY);
  assert.equal(mismatched.node('#timelineDetail').textContent, '暂时无法读取活动记录');
});

test('deselecting the heatmap cell hides the timeline without asking for anything', async () => {
  const harness = createHarness();
  await harness.feature.showDay(DAY_KEY);
  await harness.feature.showDay(null);
  assert.deepEqual(harness.asked, [DAY_KEY]);
  assert.equal(harness.node('#timelineDay').classList.contains('hidden'), true);
});

test('new events and settings refresh the selected day', async () => {
  const harness = createHarness();
  harness.emit({ routines: true });
  assert.deepEqual(harness.asked, []);
  await harness.feature.showDay(DAY_KEY);
  harness.emit({ settings: true });
  await Promise.resolve();
  assert.deepEqual(harness.asked, [DAY_KEY, DAY_KEY]);
  harness.emit({ routines: true });
  harness.emit({ energy: true });
  harness.emit({ timeline: true });
  harness.emit({ all: true });
  await Promise.resolve();
  assert.deepEqual(harness.asked, [DAY_KEY, DAY_KEY, DAY_KEY, DAY_KEY, DAY_KEY, DAY_KEY]);
  harness.emit({ pet: true });
  assert.equal(harness.asked.length, 6);
  await harness.feature.showDay(null);
  harness.emit({ routines: true });
  assert.equal(harness.asked.length, 6);
});

test('stale same-day reads cannot overwrite a newer refresh or a reselected day', async () => {
  const harness = createHarness();
  const pending = harness.defer();
  const first = harness.feature.showDay(DAY_KEY);
  const fresh = harness.feature.showDay(DAY_KEY);
  pending[1].resolve({ ...DAY, lanes: DAY.lanes.slice(0, 1) });
  await fresh;
  pending[0].resolve(DAY);
  await first;
  assert.equal(harness.node('#timelineTotals').textContent, '3 条活动 · 专注 26分');

  const oldSelection = harness.feature.showDay(DAY_KEY);
  harness.feature.hide();
  const newSelection = harness.feature.showDay(DAY_KEY);
  pending[3].resolve({ ...DAY, lanes: [], markers: [] });
  await newSelection;
  pending[2].resolve(DAY);
  await oldSelection;
  assert.equal(harness.node('#timelineTotals').textContent, '');
});

test('a task that is no longer in the loaded lists is named honestly in the detail', async () => {
  const harness = createHarness({ tasks: [] });
  await harness.feature.showDay(DAY_KEY);
  assert.match(harness.node('#timelineTrack').innerHTML, /不在当前列表里的任务/);
});

test('a day with only point events still shows the actions without inventing focus', async () => {
  const harness = createHarness({ day: { ...DAY, lanes: [] } });
  await harness.feature.showDay(DAY_KEY);
  const track = harness.node('#timelineTrack').innerHTML;
  assert.doesNotMatch(track, /tl-seg/);
  assert.match(track, /开始专注/);
  assert.match(track, /做了 · 吃药/);
});

test('dispose drops every listener it registered', () => {
  const harness = createHarness();
  assert.equal(harness.dom.listeners.size, 8);
  harness.feature.dispose();
  assert.equal(harness.dom.listeners.size, 0);
});

test('the timeline reads the day from the one channel and reaches only ids that exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/timeline.mjs'), 'utf8');
  const ids = [...new Set([...source.matchAll(/'#([A-Za-z]+)'/g)].map(match => match[1]))];
  assert.ok(ids.length >= 6);
  for (const id of ids) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} must exist in popover.html`);
  }
  // Renderers may not reach past the surface adapter, and this feature owns exactly
  // scoped day/receipt queries, no window.bubu.
  assert.doesNotMatch(source, /window\.bubu/);
  // Day, owner-scoped canonical receipt, and existing own-mood deletion only.
  const calls = [...new Set([...source.matchAll(/surfaceClient\.(\w+)/g)].map(match => match[1]))].sort();
  assert.deepEqual(calls, ['deleteMoodNote', 'getChangeReceipt', 'getTimelineDay', 'onPopoverHidden']);
  assert.match(source, /surfaceClient\.getTimelineDay\(dayKey\)/);
});

test('the panel hosts the timeline as a sibling of the heatmap detail, which rewrites itself', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/popover.html'), 'utf8');
  const progress = fs.readFileSync(path.join(ROOT, 'src/surfaces/popover/features/progress.mjs'), 'utf8');
  // renderHeatmapDetail replaces #heatmapDetail.innerHTML on every stats diff, so a
  // timeline nested inside it would be wiped by the next projection push.
  assert.match(progress, /\$\('#heatmapDetail'\)[\s\S]*?innerHTML =/);
  const detailAt = html.indexOf('id="heatmapDetail"');
  const timelineAt = html.indexOf('id="timelineDay"');
  assert.ok(detailAt > 0 && timelineAt > detailAt);
  assert.ok(html.indexOf('</div>', detailAt) < timelineAt, 'the detail block must close first');
  // The day is only fetched from a user action; a stats diff must not refetch.
  assert.match(progress, /function selectHeatmapDay\(key\)[\s\S]*?onDaySelected\(selectedHeatmapDay\)/);
  assert.equal((progress.match(/onDaySelected\(/g) || []).length, 1);
});

test('deletion recovery survives row redraw and navigation without retargeting or forcing old-day refresh', async () => {
  const requests = [], notes = [{ id: 'mood-1', at: at(10), text: 'Synthetic private note' }];
  const h = createHarness({ moodNotes: notes, day: dayKey => ({ ...DAY, dayKey }),
    deleteMoodNote: id => new Promise(resolve => requests.push({ id, resolve })) });
  await h.feature.showDay(DAY_KEY);
  const button = { dataset: { moodId: 'mood-1' }, textContent: '删除' };
  h.node('#timelineTrack').querySelectorAll = selector => selector === '.tl-del' ? [button] : [];
  const click = () => h.dom.fire('#timelineViewport', 'click', { target: { closest: selector => selector === '.tl-del' ? button : null } });
  click(); assert.equal(requests.length, 0); assert.equal(button.textContent, '确定删除？');
  click(); click(); assert.equal(requests.length, 1);
  assert.equal(button.textContent, '删除'); assert.equal(button.dataset.armed, undefined);
  assert.match(h.node('#timelineDeleteLabel').textContent, /正在删除/);
  notes.splice(0); h.emit({ wellbeing: true }); await new Promise(resolve => setImmediate(resolve));
  requests[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.node('#timelineDeleteLabel').textContent, /来源清理尚未完成/);
  assert.equal(h.node('#timelineDeleteRetry').classList.contains('hidden'), false);
  h.feature.hide(); await h.feature.showDay('2026-09-19');
  const reads = h.asked.length;
  h.dom.fire('#timelineDeleteRetry', 'click', {});
  assert.equal(requests[1].id, 'mood-1');
  requests[1].resolve({ ok: true, changed: false, localDeleted: false, alreadyAbsent: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.node('#timelineDeleteLabel').textContent, /已不在应用记录中/);
  assert.equal(h.asked.length, reads, 'completion must not navigate back or refresh the old day');
  h.dom.fire('#timelineDeleteDismiss', 'click', {});
  assert.equal(h.node('#timelineDeleteStatus').classList.contains('hidden'), true);
  h.feature.dispose(); assert.equal(h.dom.listeners.size, 0);
});
test('native popover hide and document visibility reset only unsubmitted confirmation', async () => {
  const calls = [], notes = [{ id: 'mood-1', at: at(10), text: 'Synthetic' }];
  const h = createHarness({ moodNotes: notes, deleteMoodNote: id => new Promise(resolve => calls.push({ id, resolve })) });
  await h.feature.showDay(DAY_KEY);
  const button = { dataset: { moodId: 'mood-1' }, textContent: '删除' };
  h.node('#timelineTrack').querySelectorAll = selector => selector === '.tl-del' ? [button] : [];
  const click = () => h.dom.fire('#timelineViewport', 'click', { target: { closest: selector => selector === '.tl-del' ? button : null } });
  click(); h.hideNative(); assert.equal(button.textContent, '删除'); click(); assert.equal(calls.length, 0);
  h.dom.document.hidden = true; h.dom.fire('#document', 'visibilitychange', {});
  h.dom.document.hidden = false; click(); assert.equal(calls.length, 0);
  click(); assert.equal(calls.length, 1); h.hideNative();
  calls[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.node('#timelineDeleteLabel').textContent, /来源清理尚未完成/);
  h.feature.dispose(); assert.equal(h.dom.listeners.size, 0); h.hideNative();
});


test('timeline delegates to the shared source operation and does not dispose another surface slot', async () => {
  const calls = [], rendered = [];
  const source = { id: 'capture', createdAt: at(9), resolution: { action: 'feeling', targetId: 'gone', at: at(10) } };
  const shared = createTimelineMoodDeletion({ hasMood: id => id === 'mood-1', findSource: () => source,
    sendDelete: id => new Promise(resolve => calls.push({ id, resolve })), render: view => rendered.push(view), refresh() {} });
  const h = createHarness({ moodDeletion: shared });
  await h.feature.showDay(DAY_KEY);
  shared.activateSource('capture', 'gone', DAY_KEY); shared.activateSource('capture', 'gone', DAY_KEY);
  assert.match(h.node('#timelineDeleteLabel').textContent, /正在删除/);
  h.feature.dispose();
  calls[0].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shared.view().phase, 'partial');
  shared.retry(); assert.equal(calls[1].id, 'gone'); shared.dispose();
});
test('unknown deletion masks stale canonical detail through redraw without masking other moods', async () => {
  const requests = [], notes = [{ id: 'mood-1', at: at(10), text: 'PRIVATE TARGET' }, { id: 'mood-2', at: at(11), text: 'OTHER NOTE' }];
  const h = createHarness({ moodNotes: notes, deleteMoodNote: id => new Promise(resolve => requests.push({ id, resolve })) });
  await h.feature.showDay(DAY_KEY);
  const button = { dataset: { moodId: 'mood-1' }, textContent: '删除' };
  const click = () => h.dom.fire('#timelineViewport', 'click', { target: { closest: selector => selector === '.tl-del' ? button : null } });
  click(); click(); requests[0].resolve(null); await new Promise(resolve => setImmediate(resolve));
  h.emit({ wellbeing: true }); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(h.node('#timelineTrack').innerHTML, /PRIVATE TARGET/);
  assert.match(h.node('#timelineTrack').innerHTML, /OTHER NOTE/);
  h.feature.dispose();
});

test('sending keeps canonical row present so a definite preflight refusal cannot erase it', async () => {
  const calls = [];
  const h = createHarness({ moodNotes: [{ id: 'mood-1', at: at(10), text: 'Synthetic retained note' }],
    deleteMoodNote: () => new Promise(resolve => calls.push(resolve)) });
  await h.feature.showDay(DAY_KEY);
  let removed = 0;
  const button = { dataset: { moodId: 'mood-1' }, textContent: '删除', closest: () => ({ remove() { removed++; } }) };
  h.node('#timelineTrack').querySelectorAll = () => [button];
  const click = () => h.dom.fire('#timelineViewport', 'click', { target: { closest: selector => selector === '.tl-del' ? button : null } });
  click(); click();
  assert.equal(removed, 0); assert.equal(button.disabled, true);
  calls[0]({ ok: false, reason: 'mood-source-query-unavailable' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(removed, 0); assert.match(h.node('#timelineTrack').innerHTML, /Synthetic retained note/);
  h.feature.dispose();
});


test('native hide and same-tab focus restore status without a visibility change', async () => {
  const calls = [];
  const h = createHarness({ moodNotes: [{ id: 'mood-1', at: at(10), text: 'Synthetic' }],
    deleteMoodNote: () => new Promise(resolve => calls.push(resolve)) });
  const host = h.node('#timelineDeleteStatus'), attributes = {};
  host.setAttribute = (key, value) => { attributes[key] = value; };
  await h.feature.showDay(DAY_KEY);
  const button = { dataset: { moodId: 'mood-1' }, textContent: '删除' };
  const click = () => h.dom.fire('#timelineViewport', 'click', { target: { closest: selector => selector === '.tl-del' ? button : null } });
  click(); click(); h.hideNative();
  assert.equal(h.dom.document.hidden, false);
  calls[0]({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attributes['aria-live'], 'off');
  h.emit({ wellbeing: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attributes['aria-live'], 'off', 'background projection does not imply reopen');
  h.dom.fire('#window', 'focus', {});
  assert.equal(attributes['aria-live'], 'polite');
  h.feature.dispose(); assert.equal(h.dom.listeners.size, 0);
});
