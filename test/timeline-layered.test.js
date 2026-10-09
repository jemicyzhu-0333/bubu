'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverTimelineFeature } = require('../src/surfaces/popover/features/timeline.mjs');
const { buildTimelineStory } = require('../src/surfaces/popover/features/timeline-story.mjs');
const { progress } = require('../src/capabilities');
const { NOW, receiptFixture } = require('../test-support/ai-change-ledger-fixture');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const decode = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[key]);
function dayFixture() {
  const receipt = receiptFixture();
  const events = progress.aiChangeEvents.buildEvents({ receipt, occurredAt: NOW, timezone: 'Etc/UTC', utcOffsetMinutes: 0, localDayKey: '2026-10-04' });
  const day = progress.timelineDay.buildTimelineDay([...events,
    { id: 'manual-note', kind: 'inbox.captured', source: 'local-app', occurredAt: NOW + 1000, payload: {} },
    { id: 'independent', kind: 'task.completed', taskId: 'task-2', occurredAt: NOW + 2000, payload: {} }
  ], { dayKey: '2026-10-04' });
  return { day, receipt };
}
// Focused DOM contract fixture: records actual generated attributes and event
// handlers. This is behavior coverage, not a browser CSS/layout verification.
function harness({ queryReceipt = null } = {}) {
  const document = { activeElement: null, scrollingElement: null };
  const nodes = {}, calls = [], continued = [];
  function element(tag = 'div') {
    const attributes = {}, listeners = {}, classes = new Set();
    const node = {
      tagName: tag.toUpperCase(), children: [], parentElement: null, scrollTop: 0, scrollLeft: 0, style: {}, dataset: {}, _html: '', _text: '',
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      setAttribute(key, value) { attributes[key] = String(value); if (key === 'class') String(value).split(' ').forEach(c => classes.add(c)); },
      getAttribute: key => attributes[key] ?? null,
      addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: type => { delete listeners[type]; },
      emit(type, event) { return listeners[type]?.(event); }, focus() { document.activeElement = node; },
      appendChild(child) { node.children.push(child); child.parentElement = node; return child; },
      closest(selector) {
        if (selector.includes('.tl-event') && classes.has('tl-event')) return node;
        if (selector === '.tl-del' && classes.has('tl-del')) return node;
        if (selector === '[data-tl-filter]' && attributes['data-tl-filter']) return node;
        if (selector === '[data-open-receipt]' && attributes['data-open-receipt']) return node;
        return null;
      },
      querySelectorAll(selector) { return node.children.filter(child => child.closest(selector)); }
    };
    Object.defineProperty(node, 'textContent', { get: () => node._text + node.children.map(child => child.textContent).join(''),
      set: text => { node._text = text; node.children = []; } });
    Object.defineProperty(node, 'innerHTML', { get: () => node._html, set: text => {
      node._html = text; node.children = []; node._text = '';
      for (const match of text.matchAll(/<button\b([^>]*)>/g)) {
        const button = element('button');
        for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attr[1], decode(attr[2]));
        node.appendChild(button);
      }
      if (nodes['#timelineViewport']) nodes['#timelineViewport'].scrollTop = 0;
    } });
    return node;
  }
  document.createElement = element;
  for (const id of ['timelineDay', 'timelineTitle', 'timelineTotals', 'timelineGuide', 'timelineViewport', 'timelineTrack', 'timelineDetail']) nodes[`#${id}`] = element();
  document.scrollingElement = element();
  nodes['#timelineTrack'].parentElement = nodes['#timelineViewport'];
  const fixture = dayFixture();
  const feature = createPopoverTimelineFeature({ document, $: key => nodes[key], getState: () => ({ tasks: [{ id: 'task-1', title: 'PRIVATE CURRENT TITLE' }] }),
    escapeHTML, formatMs: ms => `${ms / 60000}分`, onContinueConversation: value => continued.push(value),
    surfaceClient: { getTimelineDay: async dayKey => { calls.push(dayKey); return { ok: true, day: fixture.day }; },
      getChangeReceipt: async input => {
        calls.push(input);
        return queryReceipt ? queryReceipt(input) : { ok: true, receiptId: fixture.receipt.receiptId,
          receipt: fixture.receipt, historyStatus: 'pending', undoAvailable: true };
      } } });
  feature.mount();
  return { nodes, feature, document, calls, continued, fixture,
    rows: () => nodes['#timelineTrack'].querySelectorAll('.tl-event'),
    click: target => nodes['#timelineViewport'].emit('click', { target }),
    key: (target, key) => nodes['#timelineViewport'].emit('keydown', { target, key, preventDefault() {} }) };
}

test('AI source and entity events render one content-free row; filters preserve grouped semantics', () => {
  const { day } = dayFixture();
  const story = filter => buildTimelineStory({ day, state: { tasks: [{ id: 'task-1', title: 'PRIVATE CURRENT TITLE' }] }, filter,
    escapeHTML, formatMs: String });
  assert.equal(story('all').entryCount, 3);
  assert.equal(story('ai').entryCount, 1);
  assert.equal(story('task').entryCount, 2);
  assert.equal(story('inbox').entryCount, 1);
  const html = story('ai').markup;
  assert.match(html, /已确认修改/);
  assert.match(html, /data-receipt-id="receipt-1"/);
  assert.match(html, /<svg class="tl-type-icon"/);
  assert.doesNotMatch(html, /PRIVATE CURRENT TITLE|Old title|New title|transcript/);
});

test('private and removed sources expose no hidden entity details or receipt action in markup', () => {
  const { day } = dayFixture();
  for (const patch of [{ visibility: 'private' }, { redactionState: 'redacted' }]) {
    const filtered = { ...day, markers: [{ ...day.markers[0], ...patch }] };
    const story = buildTimelineStory({ day: filtered, escapeHTML, formatMs: String });
    assert.match(story.markup, /私密记录|内容已移除/);
    assert.doesNotMatch(story.markup, /task-1|receipt-1|data-receipt-id|Old title|New title/);
  }
});

test('keyboard expand/collapse and row navigation use accessible state and return focus', async () => {
  const h = harness(); await h.feature.showDay('2026-10-04');
  const rows = h.rows(); rows[0].focus();
  h.key(rows[0], 'Enter');
  assert.equal(rows[0].getAttribute('aria-expanded'), 'true');
  assert.match(h.nodes['#timelineDetail'].textContent, /已提交/);
  h.key(rows[0], 'ArrowDown'); assert.equal(h.document.activeElement, rows[1]);
  h.key(rows[1], 'End'); assert.equal(h.document.activeElement, rows[2]);
  h.key(rows[2], 'Home'); assert.equal(h.document.activeElement, rows[0]);
  h.key(rows[0], 'Escape');
  assert.equal(rows[0].getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.activeElement, rows[0]);
  assert.equal(h.nodes['#timelineDetail'].classList.contains('hidden'), true);
  h.feature.dispose();
});

test('same-day refresh preserves selected row, focus and scroll instead of snapping to today', async () => {
  const h = harness(); await h.feature.showDay('2026-10-04');
  const original = h.rows()[0]; original.focus(); h.click(original);
  h.nodes['#timelineViewport'].scrollTop = 271;
  const id = original.getAttribute('data-row-id');
  await h.feature.showDay('2026-10-04');
  const restored = h.rows().find(row => row.getAttribute('data-row-id') === id);
  assert.equal(restored.getAttribute('aria-expanded'), 'true');
  assert.equal(h.document.activeElement, restored);
  assert.equal(h.nodes['#timelineViewport'].scrollTop, 271);
  assert.deepEqual(h.calls, ['2026-10-04', '2026-10-04']);
  h.feature.dispose();
});

test('filters are explicit and receipt details require a fresh canonical scoped query', async () => {
  const h = harness(); await h.feature.showDay('2026-10-04');
  const filter = h.nodes['#timelineTrack'].children.find(node => node.getAttribute('data-tl-filter') === 'ai');
  h.click(filter); assert.equal(h.rows().length, 1);
  h.click(h.rows()[0]);
  const detail = h.nodes['#timelineDetail'];
  assert.doesNotMatch(detail.textContent, /Old title|New title/);
  const open = detail.children[0];
  detail.emit('click', { target: open });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.at(-1), { receiptId: 'receipt-1' });
  assert.match(detail.textContent, /Old title → New title/);
  assert.match(detail.textContent, /待同步/);
  assert.match(detail.textContent, /预览并确认/);
  const continueButton = detail.children.at(-1).children[0];
  continueButton.emit('click', {});
  assert.deepEqual(h.continued, [{ conversationId: 'conversation-1', receiptId: 'receipt-1' }]);
  h.feature.dispose();
});

test('closing or changing a selection invalidates a delayed receipt response', async () => {
  let resolve;
  const h = harness({ queryReceipt: () => new Promise(done => { resolve = done; }) });
  await h.feature.showDay('2026-10-04'); h.click(h.rows()[0]);
  const detail = h.nodes['#timelineDetail'];
  detail.emit('click', { target: detail.children[0] });
  h.key(h.rows()[0], 'Escape');
  resolve({ ok: true, receiptId: 'receipt-1', receipt: h.fixture.receipt, historyStatus: 'synced', undoAvailable: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(detail.textContent, '');
  assert.equal(detail.classList.contains('hidden'), true);
  h.feature.dispose();
});

test('wrong receipt identity and unavailable reads remain retryable without revealing a diff', async () => {
  const h = harness({ queryReceipt: async () => ({ ok: true, receiptId: 'different', receipt: receiptFixture() }) });
  await h.feature.showDay('2026-10-04'); h.click(h.rows()[0]);
  const detail = h.nodes['#timelineDetail'], button = detail.children[0];
  detail.emit('click', { target: button }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button.disabled, false);
  assert.match(button.textContent, /暂时无法读取/);
  assert.doesNotMatch(detail.textContent, /Old title|New title/);
  h.feature.dispose();
});
