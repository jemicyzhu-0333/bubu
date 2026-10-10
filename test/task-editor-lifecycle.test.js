'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPopoverTaskEditor } = require('../src/surfaces/popover/features/task-editor.mjs');
const { createCollaborationDom } = require('../test-support/collaboration-dom');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const task = (id = 'A', extra = {}) => ({ id, title: `Task ${id}`, energy: 'low', steps: [], ...extra });
const series = { id: 'series-A', state: 'active', rule: { frequency: 'weekly', interval: 2, weekdays: [1, 3], strategy: 'calendar' } };

// Production markup supplies IDs and chip data. Step rows and scheduling are
// deliberately synthetic: this suite is feature behavior, not native button QA.
function harness(t, { updateTask, updateSeries, seriesState = 'active' } = {}) {
  const dom = createCollaborationDom();
  const frames = [], restored = [], calls = [], rows = [], records = new Map();
  const oldFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  t.after(() => {
    if (oldFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', oldFrame);
    else delete globalThis.requestAnimationFrame;
  });
  function node(markup = '') {
    const classes = new Set((markup.match(/class="([^"]+)"/)?.[1] || '').split(/\s+/));
    return {
      value: '', disabled: /\sdisabled(?:\s|>)/.test(markup), dataset: {}, attributes: {}, handlers: {},
      classList: {
        contains: name => classes.has(name),
        toggle(name, on = !classes.has(name)) { if (on) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, callback) { this.handlers[type] = callback; },
      removeEventListener(type) { delete this.handlers[type]; },
      focus() { dom.document.activeElement = this; }
    };
  }
  const chips = [...dom.html.matchAll(/<button[^>]*class="[^"]*edit-(?:energy-chip|scope-chip|series-weekday)[^"]*"[^>]*>/g)]
    .map(([markup]) => {
      const item = node(markup);
      for (const [, name, value] of markup.matchAll(/data-([\w-]+)="([^"]+)"/g)) {
        item.dataset[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      }
      return item;
    });
  Object.defineProperty(dom.$('#editSteps'), 'innerHTML', { get: () => '', set() { rows.length = 0; } });
  dom.$('#editSteps').appendChild = row => rows.push(row);
  dom.$('#editSteps').querySelectorAll = selector => selector === '.edit-step' ? rows : [];
  dom.document.createElement = () => {
    const children = {};
    return {
      set innerHTML(markup) {
        for (const [full, tag, attrs, value] of markup.matchAll(/<(textarea|button)([^>]*)>([\s\S]*?)<\/\1>/g)) {
          const item = node(full);
          item.value = value;
          for (const name of attrs.match(/class="([^"]+)"/)[1].split(/\s+/)) children[`.${name}`] = item;
        }
      },
      querySelector: selector => children[selector]
    };
  };
  const $$ = selector => selector === '#editSteps .edit-step-title'
    ? rows.map(row => row.querySelector('.edit-step-title'))
    : chips.filter(item => selector.split('.').filter(Boolean).every(name => item.classList.contains(name)));
  const syncPressedButtons = (selector, selected) => $$(selector).forEach(item => item.classList.toggle('active', selected(item)));
  const feature = createPopoverTaskEditor({
    document: dom.document, $: dom.$, $$, escapeHTML: value => String(value), syncPressedButtons,
    readNumberInput: selector => dom.$(selector).value === '' ? null : Number(dom.$(selector).value),
    localDateInputValue: value => value.slice(0, 10), localDateTimeInputValue: value => value.slice(0, 16),
    scheduledFromDateTimeInput: value => value ? `${value}:00.000Z` : null,
    endOfLocalDateISO: value => value ? `${value}T23:59:59.999Z` : null,
    bindStepTitleField: (input, callback) => { input.input = value => { input.value = value; callback(value); }; },
    parseTagList: value => value.split(',').map(tag => tag.trim()).filter(Boolean),
    tagInputError: () => '', estimateInputError: () => '', recurrenceIntervalError: value => value < 1 ? 'Invalid interval' : '',
    maxSteps: 100,
    surfaceClient: {
      updateTask(...args) { calls.push(['task', ...structuredClone(args)]); return updateTask ? updateTask(...args) : Promise.resolve({ ok: true }); },
      updateSeries(...args) { calls.push(['series', ...structuredClone(args)]); return updateSeries ? updateSeries(...args) : Promise.resolve({ ok: true }); }
    },
    taskActionMessage: reason => `Rejected: ${reason}`, describeSeriesRule: () => 'Weekly',
    findTask: id => records.get(id), seriesForTask: record => record.seriesId ? { ...series, state: seriesState } : null,
    restoreModalFocus: target => restored.push(target), showPanelStatus: message => { dom.$('#taskEditError').textContent = typeof message === 'function' ? message() : message; }
  });
  feature.mount(); t.after(() => feature.dispose());
  return {
    ...dom, feature, calls, frames, restored, rows, $$,
    open(record = task()) { records.set(record.id, record); feature.open(record); },
    change(title = 'Edited title') { dom.$('#editTitle').value = title; },
    save: () => dom.fire('#taskEditConfirm', 'click'),
    rule: () => dom.fire('#editSeriesSave', 'click'),
    state: selector => dom.fire(selector, 'click'),
    scope(value = 'current') { $$('.edit-scope-chip').find(chip => chip.dataset.scope === value).handlers.click(); },
    status: () => dom.$('#taskEditError').textContent,
    input(index, value) { rows[index].querySelector('.edit-step-title').input(value); },
    rowClick(index, action) { rows[index].querySelector(`.edit-step-${action}`).handlers.click(); }
  };
}

function settle(pending, outcome) {
  if (outcome === 'reject') pending.reject(new Error('Synthetic transport failure'));
  else pending.resolve(outcome === 'refuse' ? { ok: false, reason: 'task-changed' } : { ok: true });
}

for (const id of ['A', 'B']) {
  for (const outcome of ['success', 'reject', 'refuse']) {
    test(`late task ${outcome} cannot close or repaint reopened ${id}`, async t => {
      const pending = deferred(), h = harness(t, { updateTask: () => pending.promise });
      const trigger = h.$('#btnOpenTaskCreate'); trigger.focus();
      h.open(); h.change('Old edit'); const old = h.save();
      h.feature.close(); h.open(task(id)); h.change('New unsaved edit');
      h.$('#taskEditError').textContent = 'Current status';
      const restored = h.restored.slice();
      settle(pending, outcome); await old;
      assert.equal(h.feature.isOpen(), true);
      assert.equal(h.$('#editTitle').value, 'New unsaved edit');
      assert.equal(h.status(), 'Current status');
      assert.deepEqual(h.restored, restored);
      assert.equal(h.calls.length, 1); assert.equal(h.calls[0][1], 'A');
    });
  }
}

test('open resets controls while the previous display still has a save in flight', async t => {
  const pending = deferred(), h = harness(t, { updateTask: () => pending.promise });
  h.open(); h.change(); const old = h.save();
  assert.equal(h.$('#taskEditConfirm').disabled, true);
  h.open(task()); assert.equal(h.$('#taskEditConfirm').disabled, false);
  pending.resolve({ ok: true }); await old;
});

for (const outcome of ['success', 'reject', 'refuse']) {
  test(`old task ${outcome} finally cannot release the newer pending save`, async t => {
    const first = deferred(), second = deferred(); let count = 0;
    const h = harness(t, { updateTask: () => ++count === 1 ? first.promise : second.promise });
    h.open(); h.change('First'); const old = h.save();
    h.feature.close(); h.open(task()); h.change('Second'); const current = h.save();
    settle(first, outcome); await old;
    assert.equal(h.feature.isOpen(), true); assert.equal(h.$('#taskEditConfirm').disabled, true);
    const duplicate = h.save(); assert.equal(h.calls.length, 2);
    second.resolve({ ok: true }); await current;
    await duplicate;
    assert.equal(h.feature.isOpen(), false); assert.equal(h.restored.length, 2);
  });
}

test('synthetic handler reentry shares one flight across task, rule and series state', async t => {
  const pending = deferred(), h = harness(t, { updateTask: () => pending.promise });
  h.open(task('A', { seriesId: series.id })); h.scope(); h.change();
  const saving = h.save();
  const duplicates = [h.save(), h.rule(), h.state('#editSeriesPause'), h.state('#editSeriesEnd')];
  assert.equal(h.calls.length, 1);
  for (const id of ['#taskEditConfirm', '#editSeriesSave', '#editSeriesPause', '#editSeriesResume', '#editSeriesEnd']) {
    assert.equal(h.$(id).disabled, true, id);
  }
  pending.resolve({ ok: true }); await Promise.all([saving, ...duplicates]); assert.equal(h.restored.length, 1);
});

for (const outcome of ['reject', 'refuse']) {
  test(`current task ${outcome} preserves complete inputs and step patch for explicit retry`, async t => {
    const pending = deferred(); let attempt = 0;
    const h = harness(t, { updateTask: () => ++attempt === 1 ? pending.promise : Promise.resolve({ ok: true }) });
    h.open(task('A', { seriesId: series.id, steps: [{ id: 's1', title: 'First' }, { id: 's2', title: 'Remove' }, { id: 's3', title: 'Last', done: true }] }));
    h.scope('current-and-future'); h.change('Edited task');
    for (const [selector, value] of Object.entries({ '#editDescription': 'Keep notes', '#editPlannedFor': '2026-10-08',
      '#editScheduledFor': '2026-10-08T10:30', '#editDeadline': '2026-10-09', '#editExpiresAt': '2026-10-10',
      '#editEstimate': '42', '#editTags': 'one, two', '#editSeriesInterval': '3' })) h.$(selector).value = value;
    h.$$('.edit-energy-chip').find(chip => chip.dataset.editEnergy === 'high').handlers.click();
    assert.equal(h.rows[2].querySelector('.edit-step-title').disabled, true);
    assert.equal(h.rows[2].querySelector('.edit-step-remove').disabled, true);
    h.rowClick(1, 'remove'); h.rowClick(1, 'up'); h.input(1, 'Renamed');
    h.fire('#editAddStep', 'click'); h.input(2, 'New');
    h.rowClick(2, 'up'); assert.match(h.status(), /末尾/);
    const inputs = Object.fromEntries(Object.entries(h.nodes).map(([id, node]) => [id, node.value]));
    const saving = h.save(); settle(pending, outcome); await saving;
    assert.equal(h.feature.isOpen(), true); assert.match(h.status(), /没有保存成功/);
    assert.equal(h.$('#taskEditConfirm').disabled, false);
    assert.deepEqual(Object.fromEntries(Object.entries(h.nodes).map(([id, node]) => [id, node.value])), inputs);
    assert.deepEqual(h.calls[0], ['task', 'A', {
      title: 'Edited task', description: 'Keep notes', energy: 'high', plannedFor: '2026-10-08',
      scheduledFor: '2026-10-08T10:30:00.000Z', deadline: '2026-10-09T23:59:59.999Z',
      expiresAt: '2026-10-10T23:59:59.999Z', estimateMinutes: 42, tags: ['one', 'two'],
      steps: [{ op: 'remove', stepId: 's2' }, { op: 'rename', stepId: 's1', title: 'Renamed' },
        { op: 'reorder', stepIds: ['s3', 's1'] }, { op: 'add', title: 'New' }]
    }, 'current-and-future']);
    await h.save(); assert.deepEqual(h.calls[1], h.calls[0]); assert.equal(h.feature.isOpen(), false);
  });
}

test('no-op stays a no-op and recurrence edits still require an explicit scope', async t => {
  const h = harness(t); h.open(); await h.save(); assert.equal(h.calls.length, 0); assert.equal(h.feature.isOpen(), false);
  h.open(task('A', { seriesId: series.id })); h.change(); await h.save();
  assert.equal(h.calls.length, 0); assert.match(h.status(), /请选择/);
  h.scope(); await h.save(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0][3], 'current');
  assert.deepEqual(h.calls[0][2], { title: 'Edited title' });
});

const seriesActions = [
  ['rule', h => h.rule(), { rule: series.rule }],
  ['pause', h => h.state('#editSeriesPause'), { state: 'paused' }],
  ['resume', h => h.state('#editSeriesResume'), { state: 'active' }],
  ['end', h => h.state('#editSeriesEnd'), { state: 'ended' }]
];
for (const [name, action, payload] of seriesActions) {
  test(`series ${name} keeps the captured target when another task and series open`, async t => {
    const pending = deferred(), h = harness(t, { updateSeries: () => pending.promise });
    h.open(task('A', { seriesId: 'series-A' })); const old = action(h);
    h.open(task('B', { seriesId: 'series-B' })); h.change('New series draft');
    h.$('#taskEditError').textContent = 'Series B';
    pending.resolve({ ok: true }); await old;
    assert.deepEqual(h.calls, [['series', 'series-A', payload]]);
    assert.equal(h.status(), 'Series B'); assert.equal(h.$('#editTitle').value, 'New series draft');
    assert.equal(h.feature.isOpen(), true); assert.equal(h.restored.length, 0);
  });
  for (const outcome of ['success', 'reject', 'refuse']) {
    test(`late series ${name} ${outcome} cannot affect a reopened pending display`, async t => {
      const first = deferred(), second = deferred(); let count = 0;
      const h = harness(t, { updateSeries: () => ++count === 1 ? first.promise : second.promise });
      const record = task('A', { seriesId: series.id });
      h.open(record); const old = action(h);
      h.feature.close(); h.open(record); assert.equal(h.$('#editSeriesSave').disabled, false);
      const current = action(h); h.$('#taskEditError').textContent = 'New series status';
      settle(first, outcome); await old;
      assert.equal(h.status(), 'New series status'); assert.equal(h.feature.isOpen(), true);
      assert.equal(h.$('#editSeriesSave').disabled, true);
      const duplicate = action(h); assert.equal(h.calls.length, 2);
      assert.deepEqual(h.calls[0], ['series', series.id, payload]);
      second.resolve({ ok: true }); await Promise.all([current, duplicate]); assert.equal(h.$('#editSeriesSave').disabled, false);
      assert.equal(h.restored.length, 1);
    });
  }
  test(`current series ${name} rejection is handled and retains input for explicit retry`, async t => {
    let count = 0;
    const h = harness(t, { updateSeries: async () => { if (++count === 1) throw new Error('Transport'); return { ok: true }; } });
    h.open(task('A', { seriesId: series.id })); h.change('Unsaved task');
    h.$('#editSeriesInterval').value = '4';
    await action(h); assert.match(h.status(), /没有保存成功/);
    assert.equal(h.$('#editTitle').value, 'Unsaved task'); assert.equal(h.$('#editSeriesInterval').value, '4');
    assert.equal(h.$('#taskEditConfirm').disabled, false);
    await action(h); assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1], h.calls[0]);
    assert.equal(h.feature.isOpen(), true); assert.equal(h.restored.length, 0);
  });
}

test('series singleflight blocks task save and preserves current refusal wording', async t => {
  const pending = deferred(), h = harness(t, { updateSeries: () => pending.promise });
  h.open(task('A', { seriesId: series.id })); h.scope(); h.change(); const current = h.rule();
  const duplicates = [h.rule(), h.state('#editSeriesPause'), h.save()]; assert.equal(h.calls.length, 1);
  pending.resolve({ ok: false, reason: 'series-ended' }); await Promise.all([current, ...duplicates]);
  assert.equal(h.status(), 'Rejected: series-ended'); assert.equal(h.$('#taskEditConfirm').disabled, false);
});

test('ended-series rule remains disabled after new display controls reset', async t => {
  const h = harness(t, { seriesState: 'ended' }); h.open(task('A', { seriesId: series.id }));
  assert.equal(h.$('#editSeriesSave').disabled, true); assert.equal(h.$('#taskEditConfirm').disabled, false);
});

for (const kind of ['task', 'rule', 'pause']) {
  for (const outcome of ['success', 'reject']) {
    test(`dispose invalidates ${kind} ${outcome} and all queued focus work`, async t => {
      const pending = deferred(), h = harness(t, { updateTask: () => pending.promise, updateSeries: () => pending.promise });
      h.open(task('A', { seriesId: series.id })); h.scope(); h.change();
      const saving = kind === 'task' ? h.save() : kind === 'rule' ? h.rule() : h.state('#editSeriesPause');
      h.feature.dispose(); h.$('#taskEditError').textContent = 'Disposed';
      const busy = h.$('#taskEditConfirm').disabled;
      settle(pending, outcome); await saving; h.frames.forEach(callback => callback());
      assert.equal(h.status(), 'Disposed'); assert.equal(h.restored.length, 0);
      assert.equal(h.$('#taskEditConfirm').disabled, busy); assert.equal(h.$('#editTitle').focused, 0);
      assert.equal(h.listeners.size, 0);
      h.feature.mount(); h.open(task('B')); assert.equal(h.$('#taskEditConfirm').disabled, false);
    });
  }
}

test('queued focus is bound to one display even when the same task is reopened', t => {
  const h = harness(t); h.open(); h.feature.close(); h.frames.shift()();
  assert.equal(h.$('#editTitle').focused, 0);
  h.open(); h.open(); h.frames.shift()(); assert.equal(h.$('#editTitle').focused, 0);
  h.frames.shift()(); assert.equal(h.$('#editTitle').focused, 1);
});

test('detached step callbacks cannot mutate a newer display or its error', async t => {
  const h = harness(t);
  const record = task('A', { steps: [{ id: 's1', title: 'First' }, { id: 's2', title: 'Second' }] });
  h.open(record); const oldRows = h.rows.slice();
  h.open(record); h.$('#taskEditError').textContent = 'New display';
  oldRows[0].querySelector('.edit-step-title').input('Stale title');
  oldRows[0].querySelector('.edit-step-down').handlers.click();
  oldRows[0].querySelector('.edit-step-remove').handlers.click();
  assert.equal(h.status(), 'New display'); assert.equal(h.rows.length, 2);
  h.change(); await h.save(); assert.deepEqual(h.calls[0][2], { title: 'Edited title' });
});

test('synchronous client reentry cannot start another command', async t => {
  let h;
  h = harness(t, { updateTask: () => { h.save(); h.rule(); return { ok: true }; } });
  h.open(task('A', { seriesId: series.id })); h.scope(); h.change(); await h.save();
  assert.equal(h.calls.length, 1); assert.equal(h.restored.length, 1);
});

test('synchronous client failure keeps current input and releases the same operation', async t => {
  const h = harness(t, { updateTask: () => { throw new Error('Synchronous client failure'); } });
  h.open(); h.change('Keep this edit'); await h.save();
  assert.equal(h.$('#editTitle').value, 'Keep this edit'); assert.match(h.status(), /没有保存成功/);
  assert.equal(h.$('#taskEditConfirm').disabled, false); assert.equal(h.feature.isOpen(), true);
});

test('detached step controls cannot use obsolete indexes after a current-display reorder', async t => {
  const h = harness(t); h.open(task('A', { steps: [{ id: 's1', title: 'First' }, { id: 's2', title: 'Second' }] }));
  const old = h.rows[0]; h.rowClick(0, 'down');
  old.querySelector('.edit-step-remove').handlers.click();
  old.querySelector('.edit-step-title').input('Obsolete');
  await h.save(); assert.deepEqual(h.calls[0][2], { steps: [{ op: 'reorder', stepIds: ['s2', 's1'] }] });
});

test('locale changes keep task edit fields, step nodes, focus and pending save identity', async t => {
  const { setLocale } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN'); t.after(() => setLocale('zh-CN'));
  const pending = deferred(), h = harness(t, { updateTask: () => pending.promise });
  h.open(task('A', { title: '任务 <raw>', plannedFor: '2026-10-10', steps: [{ id: 's', title: '下一步 <raw>', done: false }] }));
  const input = h.rows[0].querySelector('.edit-step-title');
  input.input('草稿 {number}'); input.focus();
  h.$('#editTitle').value = '私有草稿';
  const saving = h.fire('#taskEditConfirm', 'click');
  setLocale('en');
  assert.equal(h.rows[0].querySelector('.edit-step-title'), input);
  assert.equal(h.document.activeElement, input); assert.equal(input.value, '草稿 {number}');
  assert.equal(h.$('#editTitle').value, '私有草稿'); assert.equal(h.calls.length, 1);
  assert.equal(input.attributes['aria-label'], 'Step 1 title');
  assert.equal(h.$('#editDatesSummary').textContent, 'Planned');
  pending.resolve({ ok: false }); await saving;
  assert.match(h.$('#taskEditError').textContent, /Saving failed/);
  setLocale('zh-CN'); assert.match(h.$('#taskEditError').textContent, /没有保存成功/);
});

test('incomplete native date input cannot clear a saved date or submit unrelated edits', async t => {
  const h = harness(t); h.open({ ...task(), deadline: '2026-11-07T23:59:59.999Z' });
  h.change(); h.$('#editDeadline').value = ''; h.$('#editDeadline').validity = { badInput: true };
  await h.save(); assert.equal(h.calls.length, 0); assert.match(h.status(), /日期|date/i);
  h.$('#editDeadline').validity = { badInput: false }; await h.save();
  assert.equal(h.calls[0][2].deadline, null);
});

test('missing edit and series receipts cannot report a successful save', async t => {
  const h = harness(t, { updateTask: async () => null, updateSeries: async () => null });
  h.open(task('A', { seriesId: 'series-A' })); h.scope(); h.change(); await h.save();
  assert.equal(h.feature.isOpen(), true); assert.match(h.status(), /没有保存成功/);
  await h.state('#editSeriesPause'); assert.equal(h.status(), 'Rejected: task-update-rejected');
});

test('disclosure summaries follow unsaved fields across input, change, locale and reopen without writes', context => {
  const { setLocale, t } = require('../src/surfaces/shared/interface/i18n.mjs');
  setLocale('zh-CN'); context.after(() => setLocale('zh-CN'));
  const h = harness(context), original = task('A', { plannedFor: null, estimateMinutes: null, tags: [] });
  h.open(original);
  assert.equal(h.$('#editDatesSummary').textContent, t('未设置'));
  h.$('#editDates').open = true; h.$('#editAttributes').open = true;
  for (const [selector, value, event] of [['#editPlannedFor', '2026-10-20', 'input'], ['#editEstimate', '45', 'input'], ['#editTags', 'work, draft', 'change']]) {
    h.$(selector).value = value; h.fire(selector, event);
  }
  assert.equal(h.$('#editDatesSummary').textContent, t('已安排'));
  assert.equal(h.$('#editAttributesSummary').textContent, `${t('{minutes} 分钟', { minutes: 45 })} · ${t('{count} 个标签', { count: 2 })}`);
  h.$('#editPlannedFor').focus(); const focus = h.document.activeElement;
  setLocale('en');
  assert.equal(h.$('#editDatesSummary').textContent, t('已安排'));
  assert.equal(h.$('#editAttributesSummary').textContent, `${t('{minutes} 分钟', { minutes: 45 })} · ${t('{count} 个标签', { count: 2 })}`);
  assert.equal(h.$('#editPlannedFor').value, '2026-10-20'); assert.equal(h.$('#editEstimate').value, '45');
  assert.equal(h.$('#editDates').open, true); assert.equal(h.$('#editAttributes').open, true);
  assert.equal(h.document.activeElement, focus); assert.equal(h.calls.length, 0);
  assert.equal(original.plannedFor, null); assert.equal(original.estimateMinutes, null); assert.deepEqual(original.tags, []);
  for (const selector of ['#editPlannedFor', '#editEstimate', '#editTags']) { h.$(selector).value = ''; h.fire(selector, 'input'); }
  assert.equal(h.$('#editDatesSummary').textContent, t('未设置'));
  assert.equal(h.$('#editAttributesSummary').textContent, t('能量、估时、标签'));
  h.feature.close(); h.open(task('B', { deadline: '2026-10-21T23:59:59.999Z', estimateMinutes: 20, tags: ['saved'] }));
  assert.equal(h.$('#editDatesSummary').textContent, t('有截止日期'));
  assert.equal(h.$('#editAttributesSummary').textContent, `${t('{minutes} 分钟', { minutes: 20 })} · ${t('{count} 个标签', { count: 1 })}`);
});
