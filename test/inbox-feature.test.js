'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverInboxFeature } = require('../src/surfaces/popover/features/inbox.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id = 'source', targetId = 'm') => ({ id, text: `Synthetic private ${id}`, createdAt: 1000,
  resolution: { action: targetId ? 'feeling' : 'keep', category: targetId ? 'feeling' : 'note', targetId, at: 2000 } });
const page = items => ({ available: true, partial: false, items, total: items.length, globalTotal: items.length, nextCursor: null });
const { NOW, HOUR, harness: destinationHarness } = require('../test-support/inbox-destination-fixture');
function domFixture() {
  const document = { hidden: false }, nodes = {}, listeners = new Map();
  function node(id, classes = '') {
    const names = new Set(classes.split(/\s+/)), attributes = {}, children = [];
    const n = { id, dataset: {}, children, disabled: false, hidden: false, textContent: '', focused: 0,
      classList: { add: x => names.add(x), remove: x => names.delete(x), contains: x => names.has(x),
        toggle(x, on) { if (on) names.add(x); else names.delete(x); } },
      setAttribute(k, v) { attributes[k] = v; }, getAttribute: k => attributes[k],
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${id}:${type}`); },
      focus() { this.focused++; document.activeElement = this; },
      contains(other) { return other === this || children.some(child => child.contains(other)); },
      insertBefore(child, before) {
        child.remove(); const index = before ? children.indexOf(before) : children.length;
        children.splice(index, 0, child); child.parent = this;
      },
      remove() { if (this.parent) { const index = this.parent.children.indexOf(this); this.parent.children.splice(index, 1); this.parent = null; } },
      matches(selector) { return selector.startsWith('[data-inbox-action') && Boolean(this.dataset.inboxAction); },
      closest(selector) {
        if (selector === '[data-impulse-id]' && this.dataset.impulseId) return this;
        if (selector === '[data-inbox-action]' && this.dataset.inboxAction) return this;
        return this.parent?.closest(selector) || null;
      },
      querySelector(selector) {
        if (selector.includes('data-inbox-action')) {
          const action = selector.match(/data-inbox-action="([^"]+)"/)?.[1];
          return this.querySelectorAll('button').find(button => !action || button.dataset.inboxAction === action) || null;
        }
        return null;
      },
      querySelectorAll() { return children.flatMap(child => child.dataset.inboxAction ? [child] : child.querySelectorAll()); }
    };
    let html = '';
    Object.defineProperty(n, 'innerHTML', { get: () => html, set(value) {
      html = value; children.splice(0);
      for (const match of value.matchAll(/<button[^>]*data-inbox-action="([^"]+)"[^>]*>([^<]*)<\/button>/g)) {
        const button = node(`${id}-${match[1]}`); button.dataset.inboxAction = match[1]; button.textContent = match[2];
        button.parent = n; children.push(button);
      }
    } });
    return n;
  }
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/popover.html'), 'utf8');
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    nodes[`#${match[1]}`] = node(match[1], match[0].match(/class="([^"]+)"/)?.[1] || '');
  }
  const scopes = ['pending', 'history'].map(value => { const n = node(value); n.dataset.inboxScope = value; return n; });
  document.defaultView = node('window');
  document.body = node('body'); document.activeElement = document.body;
  document.createElement = () => node(`row-${Math.random()}`);
  document.querySelectorAll = () => scopes;
  document.querySelector = () => scopes.find(s => s.classList.contains('active'));
  document.addEventListener = (type, fn) => listeners.set(`document:${type}`, fn);
  document.removeEventListener = type => listeners.delete(`document:${type}`);
  const $ = selector => nodes[selector];
  const fire = (id, type = 'click', event = {}) => listeners.get(`${id}:${type}`)?.(event);
  return { document, $, fire, nodes, scopes };
}
function controller() {
  const subscribers = new Set(), calls = [];
  let state = { phase: null, armedSourceId: null, busy: false, canRetry: false, canDismiss: false };
  const publish = update => { state = { ...state, ...update }; subscribers.forEach(fn => fn(state)); };
  const feature = { view: () => state,
    subscribe(fn) { subscribers.add(fn); fn(state); return () => subscribers.delete(fn); },
    resetArming() { publish({ armedSourceId: null }); },
    activateSource(...args) { calls.push(args); publish({ armedSourceId: args[0] }); },
    retry() { calls.push('retry'); }, dismiss() { calls.push('dismiss'); }
  };
  return { feature, publish, calls, subscribers };
}

for (const action of ['next-step', 'schedule', 'feeling']) {
  test(`production renderer ${action} failure preserves canonical state and local draft until explicit retry`, async t => {
    let fail = true, sequence = 0;
    const h = destinationHarness('state', {
      suggestNextStep: () => fail ? null : { title: 'Synthetic first step' },
      nextWorkStart: () => { if (fail) throw new Error('Synthetic schedule failure'); return NOW + HOUR; },
      idFactory: prefix => fail ? '' : `${prefix}-${++sequence}`
    });
    const dom = domFixture(), calls = [], breakdowns = [];
    const category = action === 'feeling' ? 'feeling' : 'task';
    const feature = createPopoverInboxFeature({ ...dom,
      getState: () => ({ ...h.repo.snapshot(), impulses: h.repo.snapshot().impulses.filter(item => !item.resolution),
        routines: { items: [] }, inboxHistoryTotal: 0, inboxHistoryCountVersion: h.repo.revision() }),
      escapeHTML: String, openBreakdown: task => breakdowns.push(task.id), surfaceClient: {
        organizeImpulse(payload) { calls.push('classify'); return Promise.resolve(h.organize.execute(payload)); },
        reviewImpulse(id, chosen) { calls.push(chosen); return Promise.resolve(h.workflow.execute({ impulseId: id, action: chosen })); },
        keepMoodNote(id) { calls.push('feeling'); return Promise.resolve(h.keep.execute({ impulseId: id })); }
      } });
    t.after(() => feature.dispose());
    feature.mount(); feature.renderList();
    const article = () => dom.$('#impulseList').children.find(item => item.dataset.impulseId === 'source');
    dom.fire('impulseList', 'change', { target: { value: category, closest: () => article(),
      matches: selector => selector === '.inbox-category' } });
    assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
    const click = () => {
      const button = article().querySelector(`[data-inbox-action="${action}"]`);
      assert.ok(button); dom.fire('impulseList', 'click', { target: button });
    };
    click(); await tick();
    assert.deepEqual(h.repo.inspect(), { state: h.initial, commits: 0 });
    assert.deepEqual(h.facts, []);
    assert.deepEqual(calls, [action], 'one destination command owns classification');
    assert.ok(dom.$('#inboxStatus').textContent, 'failed action explains that it was not saved');
    assert.match(article().innerHTML, new RegExp(`value="${category}" selected`));
    assert.match(article().innerHTML, /未保存/);
    assert.deepEqual(breakdowns, []);
    fail = false; click(); await tick();
    assert.deepEqual(calls, [action, action]);
    assert.equal(h.repo.inspect().commits, 1);
    assert.equal(h.facts.length, 1);
    assert.equal(h.repo.snapshot().impulses[0].classification.category, category);
    assert.deepEqual(h.repo.snapshot().energySignals.map(value => value.referenceId), ['other']);
    assert.equal(article(), undefined, 'success retires the local draft and pending card');
    assert.equal(breakdowns.length, action === 'next-step' ? 1 : 0);
  });
}
function fixture() {
  const dom = domFixture(), queries = [], deletes = [], deletion = controller(); let hiddenListener;
  const state = { impulses: [], moodNotes: [], inboxHistoryTotal: 5, inboxHistoryCountVersion: 1, routines: { items: [] } };
  const feature = createPopoverInboxFeature({ ...dom, getState: () => state, escapeHTML: String, moodDeletion: deletion.feature,
    openBreakdown() {}, surfaceClient: {
      getInboxHistory: input => new Promise((resolve, reject) => queries.push({ input, resolve, reject })),
      deleteImpulse: id => new Promise(resolve => deletes.push({ id, resolve })),
      onPopoverHidden(fn) { hiddenListener = fn; return () => { hiddenListener = null; }; }
    } });
  feature.mount(); feature.renderList();
  return { ...dom, feature, state, queries, deletes, deletion, hideNative: () => hiddenListener?.(),
    clickAction(id, action) {
      const article = dom.$('#impulseList').children.find(n => n.dataset.impulseId === id);
      const target = article.querySelector(`[data-inbox-action="${action}"]`);
      assert.ok(target); dom.fire('impulseList', 'click', { target }); return target;
    },
    async open(items = []) { dom.fire('history'); queries.at(-1).resolve(page(items)); await tick(); }
  };
}
test('production feature has stable availability/retry hosts distinct from action errors and hides false empty state', async () => {
  const h = fixture(), host = h.$('#inboxHistoryStatus');
  assert.ok(host); h.fire('history');
  assert.equal(h.$('#emptyImpulses').classList.contains('hidden'), true);
  h.queries.at(-1).resolve({ available: false, partial: false, items: [], total: null, globalTotal: null, nextCursor: null }); await tick();
  assert.equal(h.$('#inboxHistoryCount').textContent, '暂不可用');
  assert.equal(h.$('#emptyImpulses').classList.contains('hidden'), true);
  assert.equal(h.$('#inboxHistoryRetry').classList.contains('hidden'), false);
  h.$('#inboxStatus').textContent = 'An unrelated action failed';
  h.fire('inboxHistoryRetry'); assert.equal(h.queries.at(-1).input.cursor, null);
  h.queries.at(-1).resolve(page([])); await tick();
  assert.equal(h.$('#inboxHistoryStatus'), host);
  assert.equal(h.$('#inboxStatus').textContent, 'An unrelated action failed');
  assert.equal(h.$('#inboxHistoryCount').textContent, '0');
  assert.equal(h.$('#emptyImpulses').classList.contains('hidden'), false);
});
test('production ordinary delete cannot resurrect cached text through failed reload or older response', async () => {
  const h = fixture(); await h.open([row('deleted', null), row('kept', null)]);
  h.clickAction('deleted', 'delete'); assert.deepEqual(h.deletes.map(x => x.id), ['deleted']);
  h.feature.renderList(); const old = h.queries.at(-1);
  h.deletes[0].resolve({ ok: true }); await tick();
  h.queries.at(-1).reject(new Error('reload unavailable')); await tick();
  old.resolve(page([row('deleted', null)])); await tick();
  assert.deepEqual(h.$('#impulseList').children.map(n => n.dataset.impulseId), ['kept']);
  assert.equal(h.$('#inboxHistoryCount').textContent, '暂不可用');
});
test('production residual source action carries exact identity, confirms associated originals and cannot use cache-only rows', async () => {
  const h = fixture(); await h.open([row()]);
  const button = h.clickAction('source', 'delete-mood-source');
  assert.equal(button.textContent, '确认删除这条情绪的全部关联原文');
  assert.deepEqual(h.deletion.calls[0].slice(0, 2), ['source', 'm']);
  assert.equal(h.feature.findHistorySource('source').id, 'source');
  h.feature.renderList(); assert.equal(h.feature.findHistorySource('source'), null);
  assert.equal(button.disabled, true);
  h.queries.at(-1).reject(new Error('unavailable')); await tick();
  assert.equal(h.feature.findHistorySource('source'), null);
  assert.equal(h.$('#impulseList').children.length, 1);
  assert.equal(button.disabled, true);
});
test('shared pending cleanup clears cached source text, survives navigation and hidden panels never announce or steal focus', async () => {
  const h = fixture(); await h.open([row(), row('unrelated', 'other')]);
  const host = h.$('#inboxDeleteStatus'); h.feature.hide();
  h.deletion.publish({ phase: 'unknown', moodId: 'm', dayKey: '2026-10-07', canRetry: true });
  assert.equal(host.getAttribute('aria-live'), 'off');
  assert.deepEqual(h.$('#impulseList').children.map(n => n.dataset.impulseId), ['unrelated']);
  assert.equal(h.$('#inboxDeleteRetry').classList.contains('hidden'), false);
  assert.equal(h.$('#inboxDeleteRetry').focused, 0);
  h.feature.visibilityChanged();
  assert.equal(host.getAttribute('aria-live'), 'polite');
  assert.equal(h.$('#inboxDeleteStatus'), host);
  h.fire('inboxDeleteRetry'); assert.equal(h.deletion.calls.at(-1), 'retry');
  h.hideNative(); assert.equal(host.getAttribute('aria-live'), 'off');
  const pending = h.queries.at(-1); pending.resolve(page([row('late')])); await tick();
  assert.deepEqual(h.$('#impulseList').children.map(n => n.dataset.impulseId), ['unrelated']);
  h.feature.dispose(); assert.equal(h.deletion.subscribers.size, 0);
  const before = h.$('#inboxDeleteLabel').textContent;
  h.deletion.publish({ phase: 'complete', canRetry: false, canDismiss: true });
  assert.equal(h.$('#inboxDeleteLabel').textContent, before);
});

test('completed shared deletion invalidates before visible page-one refresh and action status is quiet while hidden', async () => {
  const h = fixture(); await h.open([row(), row('unrelated', 'other')]);
  h.feature.invalidateMoodSource('m');
  assert.equal(h.queries.length, 2);
  assert.equal(h.queries.at(-1).input.cursor, null);
  assert.deepEqual(h.$('#impulseList').children.map(n => n.dataset.impulseId), ['unrelated']);
  h.queries.at(-1).reject(new Error('refresh failed')); await tick();
  assert.deepEqual(h.$('#impulseList').children.map(n => n.dataset.impulseId), ['unrelated']);
  h.feature.hide(); assert.equal(h.$('#inboxStatus').getAttribute('aria-live'), 'off');
  h.feature.invalidateMoodSource('other'); assert.equal(h.queries.length, 2);
});

test('real shared controller and inbox preserve refusal, mask partial sources and retry only the original target', async () => {
  const { createTimelineMoodDeletion } = require('../src/surfaces/popover/features/timeline-mood-deletion.mjs');
  const h = domFixture(), queries = [], commands = [];
  const state = { impulses: [], moodNotes: [], inboxHistoryTotal: 1, inboxHistoryCountVersion: 1, routines: { items: [] } };
  let inbox;
  const deletion = createTimelineMoodDeletion({ hasMood: id => state.moodNotes.some(note => note.id === id),
    findSource: id => inbox.findHistorySource(id), sendDelete: id => new Promise(resolve => commands.push({ id, resolve })),
    refresh: (_day, id) => inbox.invalidateMoodSource(id) });
  inbox = createPopoverInboxFeature({ ...h, getState: () => state, escapeHTML: String, moodDeletion: deletion,
    openBreakdown() {}, surfaceClient: { getInboxHistory: input => new Promise((resolve, reject) => queries.push({ input, resolve, reject })) } });
  inbox.mount(); h.fire('history'); queries[0].resolve(page([row()])); await tick();
  const button = h.$('#impulseList').children[0].querySelector('[data-inbox-action="delete-mood-source"]');
  h.fire('impulseList', 'click', { target: button }); assert.equal(commands.length, 0);
  assert.equal(button.textContent, '确认删除这条情绪的全部关联原文');
  h.fire('impulseList', 'click', { target: button }); assert.equal(commands.length, 1);
  assert.equal(commands[0].id, 'm'); assert.equal(h.$('#impulseList').children.length, 0);
  commands[0].resolve({ ok: false, reason: 'mood-source-query-unavailable' }); await tick();
  assert.equal(deletion.view().phase, 'refused'); assert.equal(h.$('#impulseList').children.length, 1);
  h.fire('inboxDeleteRetry'); commands[1].resolve({ ok: false, reason: 'mood-delete-partial', sourceCleanupPending: true, localDeleted: true }); await tick();
  assert.equal(deletion.view().phase, 'partial'); assert.equal(h.$('#impulseList').children.length, 0);
  inbox.hide(); inbox.visibilityChanged(); queries.at(-1).reject(new Error('archive still unavailable')); await tick();
  assert.equal(h.$('#inboxDeleteRetry').classList.contains('hidden'), false);
  h.fire('inboxDeleteRetry'); assert.deepEqual(commands.map(command => command.id), ['m', 'm', 'm']);
  commands[2].resolve({ ok: true, changed: false, localDeleted: false }); await tick();
  assert.equal(deletion.view().phase, 'complete');
  queries.at(-1).reject(new Error('completion refresh failed')); await tick();
  h.fire('inboxDeleteDismiss'); assert.equal(deletion.view().phase, null);
  assert.equal(h.$('#impulseList').children.length, 0);
  assert.equal(h.$('#inboxHistoryCount').textContent, '暂不可用');
  inbox.dispose(); deletion.dispose();
});


test('window focus after native hide restores the same tab without needing visibilitychange', async () => {
  const h = fixture(); await h.open([row()]);
  h.hideNative(); assert.equal(h.document.hidden, false);
  assert.equal(h.feature.findHistorySource('source'), null);
  assert.equal(h.$('#inboxHistoryStatus').getAttribute('aria-live'), 'off');
  h.fire('window', 'focus'); assert.equal(h.queries.length, 2);
  h.queries.at(-1).resolve(page([row()])); await tick();
  assert.equal(h.feature.findHistorySource('source').id, 'source');
  assert.equal(h.$('#inboxHistoryStatus').getAttribute('aria-live'), 'polite');
  h.feature.dispose(); h.fire('window', 'focus'); assert.equal(h.queries.length, 2);
});
