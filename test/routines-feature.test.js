'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPopoverRoutinesFeature } = require('../src/surfaces/popover/features/routines.mjs');
const { TIME_OF_DAY_PATTERN, MAX_ROUTINE_TIMES_OF_DAY } = require('../src/core/routine-model');

const ROOT = path.resolve(__dirname, '..');
const featureSource = fs.readFileSync(
  path.join(ROOT, 'src/surfaces/popover/features/routines.mjs'), 'utf8');
// 「源码里不许出现某个名字」这种断言必须对代码问，不能对注释问：文件开头那段说明
// 恰恰要写出被禁掉的是哪一层，把它算成违规会逼着下一个人删掉唯一的说明。
const featureCode = featureSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// No jsdom in this repo, so the stub observes exactly what the feature touches:
// innerHTML, textContent, classList, one attribute, value, and two listeners.
function createDom() {
  const listeners = new Map();
  const element = selector => {
    const node = {
      selector,
      innerHTML: '',
      textContent: '',
      value: '',
      classList: {
        names: new Set(['hidden']),
        add(name) { this.names.add(name); },
        remove(name) { this.names.delete(name); },
        contains(name) { return this.names.has(name); },
        toggle(name, force) { if (force) this.names.add(name); else this.names.delete(name); }
      },
      attributes: {},
      setAttribute(name, value) { node.attributes[name] = value; },
      getAttribute(name) { return node.attributes[name] ?? null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(type, handler) { listeners.set(`${selector}:${type}`, handler); },
      removeEventListener(type) { listeners.delete(`${selector}:${type}`); }
    };
    return node;
  };
  const nodes = {};
  for (const selector of ['#routinesStrip', '#routinesCount', '#routinesTileSub', '#btnManageRoutines', '#routineRows',
    '#routineQuick', '#routineQuickChips', '#routinesStatus', '#routinesManage', '#routineTitle',
    '#routineKind', '#routineCustomLabel', '#routineCustomLabelText', '#routineFrequency', '#routineWeekdayRow', '#routineTimeRow', '#routineTimes',
    '#routineFormStatus', '#btnAddRoutine', '#routineManageList']) {
    nodes[selector] = element(selector);
  }
  // The weekday chips are real markup in popover.html, so the stub has to answer
  // the one query the feature makes against that row.
  const weekdayChips = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({
    dataset: { weekday: String(weekday) },
    attributes: { 'aria-pressed': 'false' },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  nodes['#routineWeekdayRow'].querySelectorAll = () => weekdayChips;
  const $ = selector => nodes[selector] || null;
  return { nodes, listeners, $, weekdayChips, document: { activeElement: null } };
}

// A click always arrives through the section's delegated listener, so the test
// fabricates the two lookups the handler performs on the event target.
function button({ id = '', act = '', routine = '', occurrence = '', weekday = '' } = {}) {
  const row = (routine || occurrence)
    ? { dataset: { routine, occurrence } }
    : null;
  const node = {
    id,
    dataset: {},
    attributes: {},
    getAttribute(name) { return node.attributes[name] ?? null; },
    setAttribute(name, value) { node.attributes[name] = value; },
    closest(selector) {
      if (selector === 'button') return node;
      if (selector === '[data-routine]') return routine ? row : null;
      return null;
    }
  };
  if (act) node.dataset.act = act;
  if (weekday) node.dataset.weekday = weekday;
  // Quick chips and manage rows carry the routine id on the button itself; plan
  // rows carry it on the row. Both paths must resolve.
  if (routine && (act === 'quick' || act === 'active' || act === 'remove')) node.dataset.routine = routine;
  return node;
}

function createHarness({ items = [], occurrences = [], counts = null, remindersEnabled = true, client = {} } = {}) {
  const dom = createDom();
  const calls = [];
  const state = {
    routines: {
      items,
      today: {
        dayKey: '2026-09-20',
        occurrences,
        counts: counts || {
          total: occurrences.filter(entry => entry.scheduled).length,
          done: occurrences.filter(entry => entry.status === 'done').length,
          open: 0,
          due: occurrences.filter(entry => entry.due).length
        }
      },
      remindersEnabled,
      curveEnabled: true
    }
  };
  const answer = { ok: true, changed: true };
  const record = name => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(answer);
  };
  const feature = createPopoverRoutinesFeature({
    document: dom.document,
    $: dom.$,
    getState: () => state,
    escapeHTML,
    surfaceClient: {
      addRoutine: record('addRoutine'),
      updateRoutine: record('updateRoutine'),
      removeRoutine: record('removeRoutine'),
      logRoutine: record('logRoutine'),
      undoRoutineLog: record('undoRoutineLog'),
      ...client
    }
  });
  feature.mount({ subscribe: () => () => undefined });
  const click = async target => {
    const handler = dom.listeners.get('#routinesStrip:click');
    assert.ok(handler, 'the section must listen for click');
    await handler({ target });
  };
  return {
    dom, feature, state, calls, click, answer,
    rows: () => dom.nodes['#routineRows'].innerHTML,
    chips: () => dom.nodes['#routineQuickChips'].innerHTML,
    manage: () => dom.nodes['#routineManageList'].innerHTML,
    status: () => dom.nodes['#routinesStatus'].textContent
  };
}

const PILL = {
  occurrenceId: 'pill@2026-09-20T09:00',
  routineId: 'pill', title: '吃药', kind: 'medication', timeOfDay: '09:00',
  scheduledAt: 1, scheduled: true, status: null, answered: false, due: true, upcoming: false
};

test('answering a routine sends one command and paints nothing until the projection agrees', async () => {
  // F6 names this feature's worst failure mode: 「如果点了"已完成"却没有落一条记录，
  // 曲线就会和用户的记忆不一致」。乐观渲染正是制造那种不一致的做法，所以这一条
  // 断言的是"点完之后画面没有自己变"。
  const harness = createHarness({ items: [{ id: 'pill', title: '吃药', kind: 'medication' }], occurrences: [PILL] });
  const before = harness.rows();
  assert.match(before, /data-state="due"/);
  await harness.click(button({ act: 'done', routine: 'pill', occurrence: PILL.occurrenceId }));
  assert.deepEqual(harness.calls, [['logRoutine', {
    routineId: 'pill', occurrenceId: PILL.occurrenceId, status: 'done'
  }]]);
  assert.equal(harness.rows(), before, '没有投影回流之前画面不许自己变成已完成');
});

test('a refused write says what happened instead of failing silently', async () => {
  const harness = createHarness({ items: [{ id: 'pill', title: '吃药' }], occurrences: [PILL] });
  harness.answer.ok = false;
  harness.answer.reason = 'day-full';
  await harness.click(button({ act: 'done', routine: 'pill', occurrence: PILL.occurrenceId }));
  assert.match(harness.status(), /上限/);
  assert.equal(harness.dom.nodes['#routinesStatus'].classList.contains('hidden'), false);
});

test('a missed occurrence reads as "not recorded" and never becomes an overdue debt', () => {
  const harness = createHarness({
    items: [{ id: 'pill', title: '吃药' }],
    occurrences: [{ ...PILL, status: 'missed', answered: false, due: false }]
  });
  const rows = harness.rows();
  assert.match(rows, /没记上/);
  assert.match(rows, /data-state="missed"/);
  // ARCHITECTURE「日常与能量」 的边界就在措辞上：一句「现在补上」就是这个特性唯一不能给的建议。
  assert.doesNotMatch(rows, /补记|补上|逾期|欠|过期/);
  // 它也不许被计进今天的完成数。
  assert.doesNotMatch(harness.dom.nodes['#routinesCount'].textContent, /1\/1/);
  // 答过之后才有撤回；没答过的那条给的仍是两个答案。
  assert.match(rows, /data-act="done"/);
  assert.match(rows, /data-act="skipped"/);
  assert.doesNotMatch(rows, /data-act="undo"/);
});

test('an answered occurrence offers exactly one way back out', async () => {
  const harness = createHarness({
    items: [{ id: 'pill', title: '吃药' }],
    occurrences: [{ ...PILL, status: 'done', answered: true, due: false, loggedAt: 1 }]
  });
  assert.match(harness.rows(), /data-act="undo"/);
  assert.doesNotMatch(harness.rows(), /data-act="done"/);
  await harness.click(button({ act: 'undo', routine: 'pill', occurrence: PILL.occurrenceId }));
  assert.deepEqual(harness.calls, [['undoRoutineLog', PILL.occurrenceId]]);
});

test('quick chips come from the user own list and claim only a due occurrence', async () => {
  // 内置一张 ☕😴🍫 词表会让一次点击凭空造出一条日常 —— logOccurrence 会以
  // routine-not-found 拒绝它，而那正是 ARCHITECTURE「日常与能量」 禁止的「替用户记他没说过的事」。
  const coffee = { id: 'coffee', title: '咖啡', kind: 'stimulant' };
  const empty = createHarness({ items: [] });
  assert.equal(empty.dom.nodes['#routineQuick'].classList.contains('hidden'), true);
  assert.equal(empty.chips(), '');

  const harness = createHarness({ items: [coffee], occurrences: [] });
  assert.equal(harness.dom.nodes['#routineQuick'].classList.contains('hidden'), false);
  assert.match(harness.chips(), /data-routine="coffee"/);
  assert.match(harness.chips(), /data-icon="cup"/);
  // 没有 due 的排程行时不带 occurrenceId：由 domain 分一个随手记的位置。
  await harness.click(button({ act: 'quick', routine: 'coffee' }));
  assert.deepEqual(harness.calls, [['logRoutine', {
    routineId: 'coffee', occurrenceId: undefined, status: 'done'
  }]]);
});

test('a quick tap never backfills an occurrence whose window has passed', async () => {
  const stale = {
    occurrenceId: 'coffee@2026-09-20T09:00', routineId: 'coffee', title: '咖啡',
    kind: 'stimulant', timeOfDay: '09:00', scheduled: true, status: 'missed',
    answered: false, due: false, upcoming: false
  };
  const harness = createHarness({ items: [{ id: 'coffee', title: '咖啡', kind: 'stimulant' }], occurrences: [stale] });
  await harness.click(button({ act: 'quick', routine: 'coffee' }));
  assert.equal(harness.calls[0][1].occurrenceId, undefined,
    '18 点点一下不能被记成 9 点那一次');
});

test('the editor refuses a time the domain would refuse, with the same rule', async () => {
  const harness = createHarness({ items: [] });
  await harness.click(button({ id: 'btnManageRoutines' }));
  harness.dom.nodes['#routineTitle'].value = '吃药';
  harness.dom.nodes['#routineKind'].value = 'medication';
  harness.dom.nodes['#routineFrequency'].value = 'daily';
  // 不补零的写法两边都不收。校验规则重新声明在渲染层(读不到 CJS 的 core)，所以
  // 这一条把两边钉在一起：任何一侧改了正则，这里就红。
  harness.dom.nodes['#routineTimes'].value = '9:05';
  assert.equal(TIME_OF_DAY_PATTERN.test('9:05'), false);
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, []);
  assert.match(harness.status(), /小时和分钟/);

  harness.dom.nodes['#routineTimes'].value = '09:05, 21:00';
  assert.ok(['09:05', '21:00'].every(time => TIME_OF_DAY_PATTERN.test(time)));
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, [['addRoutine', {
    title: '吃药', kind: 'medication', schedule: { frequency: 'daily', timesOfDay: ['09:05', '21:00'] }
  }]]);
  assert.equal(harness.dom.nodes['#routineTitle'].value, '', '加完清掉名字，种类和频率留着');
  assert.equal(harness.dom.nodes['#routineFrequency'].value, 'daily');
});

test('the editor keeps the domain limits it can check locally', async () => {
  const harness = createHarness({ items: [] });
  harness.dom.nodes['#routineTitle'].value = '  ';
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, []);
  assert.match(harness.status(), /名字/);

  harness.dom.nodes['#routineTitle'].value = '喝水';
  harness.dom.nodes['#routineFrequency'].value = 'daily';
  harness.dom.nodes['#routineTimes'].value = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].join(',');
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, []);
  assert.match(harness.status(), new RegExp(String(MAX_ROUTINE_TIMES_OF_DAY)));

  // 每周不选日子的排程在 domain 那侧会被打回，这里当场说出来而不是发一个注定被拒的值。
  harness.dom.nodes['#routineFrequency'].value = 'weekly';
  harness.dom.nodes['#routineTimes'].value = '09:00';
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, []);
  assert.match(harness.status(), /至少选一天/);

  await harness.click(button({ act: '', weekday: '3' }));
  harness.dom.weekdayChips[2].attributes['aria-pressed'] = 'true';
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, [['addRoutine', {
    title: '喝水', kind: '', schedule: { frequency: 'weekly', timesOfDay: ['09:00'], weekdays: [3] }
  }]]);
});

test('an unscheduled routine is legal: a button that reminds about nothing', async () => {
  const harness = createHarness({ items: [] });
  harness.dom.nodes['#routineTitle'].value = '拉伸';
  harness.dom.nodes['#routineKind'].value = 'movement';
  harness.dom.nodes['#routineFrequency'].value = '';
  await harness.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(harness.calls, [['addRoutine', { title: '拉伸', kind: 'movement' }]]);
});

test('deleting a routine takes two presses because it deletes today records too', async () => {
  const harness = createHarness({ items: [{ id: 'pill', title: '吃药', kind: 'medication' }] });
  await harness.click(button({ id: 'btnManageRoutines' }));
  assert.match(harness.manage(), /data-act="remove"/);
  await harness.click(button({ act: 'remove', routine: 'pill' }));
  assert.deepEqual(harness.calls, []);
  assert.match(harness.status(), /再按一次/);
  assert.match(harness.manage(), /真的删/);
  await harness.click(button({ act: 'remove', routine: 'pill' }));
  assert.deepEqual(harness.calls, [['removeRoutine', 'pill']]);
});

test('muting a routine is an update, not a delete', async () => {
  const harness = createHarness({ items: [{ id: 'pill', title: '吃药', active: true }] });
  await harness.click(button({ id: 'btnManageRoutines' }));
  assert.match(harness.manage(), /已启用/);
  await harness.click(button({ act: 'active', routine: 'pill' }));
  assert.deepEqual(harness.calls, [['updateRoutine', 'pill', { active: false }]]);
});

test('the daily page exposes management without introducing another modal layer', () => {
  const harness = createHarness({ items: [] });
  assert.equal(harness.feature.isManageOpen(), true);
  assert.equal(harness.dom.nodes['#routinesManage'].classList.contains('hidden'), false);
  assert.equal(harness.dom.nodes['#btnManageRoutines'].getAttribute('aria-expanded'), 'true');
  // 它不进 POPOVER_MODAL_LAYER，所以也不许自己做困焦或抢 Escape ——
  // 两套关闭机制并存时 Escape 会关错层，而那是静默的。
  assert.doesNotMatch(featureCode, /aria-modal|inert|trapFocus|'Escape'/);
});

test('finishing a routine never touches the gamification layer', () => {
  // ARCHITECTURE「日常与能量」：完成一条日常永远不发 XP、不影响连续天数、不喂桌宠。这一节和那一层之间
  // 不该有任何连线，源码里连它们的名字都不该出现。
  assert.doesNotMatch(featureCode, /\bxp\b|streak|feedPet|celebrate|achievement|levelUp/i);
});

test('reminders being off is stated rather than hiding the section', () => {
  const harness = createHarness({
    items: [{ id: 'pill', title: '吃药' }], occurrences: [PILL], remindersEnabled: false
  });
  assert.equal(harness.dom.nodes['#routinesStrip'].classList.contains('hidden'), false);
  assert.match(harness.dom.nodes['#routinesTileSub'].textContent, /提醒已关/);
  // 关掉提醒不等于不能记：行和随手记都还在。
  assert.match(harness.rows(), /data-act="done"/);
});

test('an empty day still offers the way in, and a stateless projection hides the section', () => {
  const harness = createHarness({ items: [], occurrences: [] });
  assert.match(harness.rows(), /还没有日常/);
  assert.equal(harness.feature.isManageOpen(), true);

  const dom = createDom();
  const feature = createPopoverRoutinesFeature({
    document: dom.document, $: dom.$, getState: () => ({}), escapeHTML, surfaceClient: {}
  });
  feature.mount({ subscribe: () => () => undefined });
  assert.equal(dom.nodes['#routinesStrip'].classList.contains('hidden'), true);
});

test('the feature refuses to be built without its scoped dependencies', () => {
  assert.throws(() => createPopoverRoutinesFeature(), /routines feature requires document/);
  assert.throws(
    () => createPopoverRoutinesFeature({ document: {}, $: () => null, getState: () => ({}), escapeHTML }),
    /requires surfaceClient/
  );
  const dom = createDom();
  const feature = createPopoverRoutinesFeature({
    document: dom.document, $: dom.$, getState: () => ({}), escapeHTML, surfaceClient: {}
  });
  assert.throws(() => feature.mount({}), /projection store/);
});


test('manual-only routines expose reminder setup without claiming an active reminder', () => {
  const harness = createHarness({ items: [{ id: 'manual', title: '填报', kind: 'custom', active: true, schedule: null }] });
  assert.match(harness.manage(), /仅手动记录/);
  assert.match(harness.manage(), />设置提醒<\/button>/);
  assert.doesNotMatch(harness.manage(), />提醒中<\/button>/);
});


test('an inbox-created custom routine can add a reminder without inventing a type label', async () => {
  const h = createHarness({ items: [{ id: 'custom', title: '填报', kind: 'custom', schedule: null, active: true }] });
  await h.click(button({ act: 'edit', routine: 'custom' }));
  assert.equal(h.dom.nodes['#routineCustomLabelText'].textContent, '类型名称（可选）');
  h.dom.nodes['#routineFrequency'].value = 'daily';
  h.dom.nodes['#routineTimes'].value = '08:00';
  await h.click(button({ id: 'btnAddRoutine' }));
  assert.deepEqual(h.calls, [['updateRoutine', 'custom', {
    title: '填报', schedule: { frequency: 'daily', timesOfDay: ['08:00'] }
  }]]);
});

test('new custom kinds and clearing an existing type label still require the label', async () => {
  for (const item of [null, { id: 'meal', title: '午餐', kind: 'meal' }, { id: 'named', title: '浇花', kind: 'custom', customLabel: '园艺' }]) {
    const h = createHarness({ items: item ? [item] : [] });
    if (item) await h.click(button({ act: 'edit', routine: item.id }));
    h.dom.nodes['#routineTitle'].value = '名称';
    h.dom.nodes['#routineKind'].value = 'custom';
    h.dom.nodes['#routineCustomLabel'].value = '';
    h.dom.nodes['#routineFrequency'].value = '';
    await h.click(button({ id: 'btnAddRoutine' }));
    assert.deepEqual(h.calls, []);
    assert.match(h.status(), /给这个类型起个名字/);
  }
});


test('quick routine logs deduplicate across controls while pending and retry failures', async () => {
  let resolve, calls = 0;
  const pending = new Promise(done => { resolve = done; });
  const h = createHarness({ items: [{ id: 'water', title: 'Water', kind: 'water', active: true }],
    client: { logRoutine: () => { calls++; return calls === 1 ? pending : Promise.resolve({ ok: true }); } } });
  const first = h.click(button({ act: 'quick', routine: 'water' }));
  await h.click(button({ act: 'quick', routine: 'water' })); assert.equal(calls, 1);
  resolve({ ok: false }); await first;
  assert.match(h.dom.$('#routinesStatus').textContent, /没记上/);
  await h.click(button({ act: 'quick', routine: 'water' })); assert.equal(calls, 2); h.feature.dispose();
});
test('routine transport rejection is visible and disposed receipts are ignored', async () => {
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const h = createHarness({ client: { logRoutine: () => pending } });
  const first = h.click(button({ act: 'quick', routine: 'water' }));
  reject(new Error('offline')); await first; assert.match(h.dom.$('#routinesStatus').textContent, /暂未确认/);
  h.feature.dispose();
});

test('routine form freezes editable fields while saving and restores them after refusal', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  const h = createHarness({ client: { addRoutine: () => pending } });
  h.dom.$('#routineTitle').value = 'Water'; h.dom.$('#routineKind').value = 'water';
  const saving = h.click(button({ id: 'btnAddRoutine' }));
  assert.equal(h.dom.$('#routineTitle').disabled, true); assert.equal(h.dom.$('#btnAddRoutine').disabled, true);
  finish({ ok: false }); await saving;
  assert.equal(Boolean(h.dom.$('#routineTitle').disabled), false); assert.equal(h.dom.$('#routineTitle').value, 'Water'); h.feature.dispose();
});
