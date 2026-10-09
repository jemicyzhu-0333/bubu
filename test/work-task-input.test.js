'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ipcRoutes } = require('../src/capabilities/work/contract/ipc-codec');
const { createIpcRegistrar } = require('../src/application/ipc/registrar');

const decode = (channel, payload, context) => ipcRoutes.find(route => route.channel === channel).decode(payload, context);
const rule = overrides => ({ frequency: 'weekly', interval: 1, strategy: 'fixed', ...overrides });
const update = patch => ({ id: 'task-1', patch });

test('work routes retain ordered descriptors, query kinds and frozen surface lists', () => {
  const expected = [
    ['impulses:organize', 'popover'], ['impulses:history', 'popover'], ['impulses:keep-all', 'popover'],
    ['tasks:add', 'popover'], ['tasks:add-with-breakdown', 'popover'], ['tasks:update', 'popover,impulse'],
    ['tasks:undo-complete', 'popover'], ['tasks:complete', 'popover,impulse'],
    ['tasks:complete-step', 'popover,impulse'], ['tasks:renew', 'popover'], ['series:update', 'popover'],
    ['tasks:delete', 'popover'], ['tasks:archive', 'popover'], ['tasks:restore', 'popover'],
    ['tasks:skip-occurrence', 'popover'], ['tasks:duplicate', 'popover'], ['history:list', 'popover'],
    ['impulses:add', 'popover,impulse'], ['impulses:promote', 'popover'], ['impulses:delete', 'popover'],
    ['impulses:keep-mood', 'popover'], ['impulses:review', 'popover'], ['impulse:open', 'popover'],
    ['impulse:hide', 'impulse'], ['pet:openImpulse', 'pet']
  ];
  assert.equal(Object.isFrozen(ipcRoutes), true);
  assert.deepEqual(ipcRoutes.map(({ channel, surfaces }) => [channel, surfaces.join(',')]), expected);
  for (const route of ipcRoutes) {
    assert.equal(route.capability, 'work');
    assert.equal(route.kind, ['history:list', 'impulses:history'].includes(route.channel) ? 'query' : 'command');
    assert.equal(Object.isFrozen(route), true);
    assert.equal(Object.isFrozen(route.surfaces), true);
    assert.equal(typeof route.decode, 'function');
  }
});

for (const channel of ['tasks:add', 'tasks:add-with-breakdown', 'tasks:update', 'series:update']) {
  test(`${channel} rejects primitive payloads with the same single ordered error`, () => {
    for (const payload of [undefined, null, false, 0, '', [], new Date(0)]) {
      assert.deepEqual(decode(channel, payload), { ok: false, errors: ['payload must be an object'] });
    }
  });
}

test('minimal create preserves all defaults and own property order', () => {
  assert.deepEqual(decode('tasks:add', { title: ' task ' }), { ok: true, value: {
    title: 'task', description: null, energy: 'auto', tags: [], estimateMinutes: null,
    plannedFor: null, scheduledFor: null, deadline: null, expiresAt: null, recurrence: null, steps: []
  } });
  assert.deepEqual(Object.keys(decode('tasks:add', { title: 'task' }).value), [
    'title', 'description', 'energy', 'tags', 'estimateMinutes', 'plannedFor', 'scheduledFor',
    'deadline', 'expiresAt', 'recurrence', 'steps'
  ]);
  const nullPrototype = Object.assign(Object.create(null), { title: 'task' });
  assert.equal(decode('tasks:add', nullPrototype).ok, true);
});

test('create string limits measure trimmed UTF-16 strings without silently truncating input', () => {
  for (const [field, limit] of [['title', 100], ['description', 1000]]) {
    for (const length of [limit - 1, limit, limit + 1]) {
      assert.equal(decode('tasks:add', { title: 'task', [field]: ` ${'x'.repeat(length)} ` }).ok, length <= limit);
    }
  }
  assert.equal(decode('tasks:add', { title: '😀'.repeat(50) }).ok, true);
  assert.equal(decode('tasks:add', { title: '😀'.repeat(51) }).ok, false);
  for (const description of ['', ' ', false, 0]) assert.equal(decode('tasks:add', { title: 'task', description }).ok, false);
  for (const description of [undefined, null]) assert.equal(decode('tasks:add', { title: 'task', description }).ok, true);
});

test('tags retain insertion order after trimming and check input count before deduplication', () => {
  assert.deepEqual(decode('tasks:add', { title: 'task', tags: [' b ', 'a', 'b'] }).value.tags, ['b', 'a']);
  for (const count of [7, 8, 9]) assert.equal(decode('tasks:add', { title: 'task', tags: Array(count).fill('same') }).ok, count <= 8);
  for (const length of [19, 20, 21]) assert.equal(decode('tasks:add', { title: 'task', tags: ['x'.repeat(length)] }).ok, length <= 20);
  for (const tags of [null, 'a', [null], [' ']]) assert.equal(decode('tasks:add', { title: 'task', tags }).ok, false);
});

test('estimate and energy retain strict values, omission and null behavior', () => {
  for (const estimateMinutes of [undefined, null, 1, 1440]) assert.equal(decode('tasks:add', { title: 'task', estimateMinutes }).ok, true);
  for (const estimateMinutes of [0, 1441, 1.5, '1', '', NaN, Infinity]) assert.equal(decode('tasks:add', { title: 'task', estimateMinutes }).ok, false);
  for (const energy of [undefined, 'auto', 'low', 'medium', 'high']) assert.equal(decode('tasks:add', { title: 'task', energy }).ok, true);
  for (const energy of [null, '', 1]) assert.equal(decode('tasks:add', { title: 'task', energy }).ok, false);
});

test('date fields retain distinct day and instant normalization', () => {
  const value = decode('tasks:add', { title: 'task', plannedFor: '2024-02-29', scheduledFor: 0,
    deadline: '2026-09-01T23:59:59+08:00', expiresAt: new Date(1000) }).value;
  assert.equal(value.plannedFor, '2024-02-29');
  assert.equal(value.scheduledFor, '1970-01-01T00:00:00.000Z');
  assert.equal(value.deadline, '2026-09-01T15:59:59.000Z');
  assert.equal(value.expiresAt, '1970-01-01T00:00:01.000Z');
  for (const plannedFor of ['2023-02-29', '2026-9-01', 0]) assert.equal(decode('tasks:add', { title: 'task', plannedFor }).ok, false);
  for (const field of ['plannedFor', 'scheduledFor', 'deadline', 'expiresAt']) {
    for (const blank of [undefined, null, '']) assert.equal(decode('tasks:add', { title: 'task', [field]: blank }).value[field], null);
  }
  for (const deadline of [NaN, Infinity, 1e100, new Date(NaN), {}, false]) assert.equal(decode('tasks:add', { title: 'task', deadline }).ok, false);
});

test('recurrence preserves weekdays sorting, optional anchor and whole-rule errors', () => {
  assert.deepEqual(decode('tasks:add', { title: 'task', recurrence: rule({ weekdays: [7, 1, 1] }) }).value.recurrence,
    { frequency: 'weekly', interval: 1, weekdays: [1, 7], strategy: 'fixed', anchorDate: null });
  for (const interval of [1, 365, 0, 366, '1']) assert.equal(decode('tasks:add', { title: 'task', recurrence: rule({ interval }) }).ok, interval === 1 || interval === 365);
  for (const weekdays of [[], [0], [8], ['1'], Array(8).fill(1)]) assert.equal(decode('tasks:add', { title: 'task', recurrence: rule({ weekdays }) }).ok, false);
  assert.equal(decode('tasks:add', { title: 'task', recurrence: rule({ frequency: 'daily', weekdays: [1] }) }).ok, false);
  assert.deepEqual(decode('tasks:add', { title: 'task', recurrence: { extra: true } }).errors, [
    'unknown field: extra', 'recurrence.frequency must be one of: daily, weekly, monthly',
    'recurrence.interval must be an integer from 1 to 365', 'recurrence.strategy must be one of: fixed, after-completion'
  ]);
});

test('breakdown requires a valid step while ordinary creation permits empty steps', () => {
  for (const steps of [undefined, []]) {
    assert.equal(decode('tasks:add', { title: 'task', steps }).ok, true);
    assert.deepEqual(decode('tasks:add-with-breakdown', { title: 'task', steps }).errors, ['at least one valid step is required']);
  }
  for (const count of [99, 100, 101]) assert.equal(decode('tasks:add', { title: 'task', steps: Array.from({ length: count }, () => ({ title: 'step' })) }).ok, count <= 100);
  for (const length of [199, 200, 201]) assert.equal(decode('tasks:add', { title: 'task', steps: [{ title: 'x'.repeat(length) }] }).ok, length <= 200);
  assert.deepEqual(decode('tasks:add-with-breakdown', { title: 'task', steps: [{ title: ' step ' }] }).value.steps, [{ title: 'step', done: false }]);
  assert.deepEqual(decode('tasks:add-with-breakdown', { title: 'task', steps: [null, { title: '', done: true }] }).errors, [
    'steps[0] must be an object', 'unknown field: done',
    'steps[1].title must be a non-empty string of at most 200 characters', 'at least one valid step is required'
  ]);
});

test('patch keeps empty-clearing, explicit undefined fields and recurring context semantics', () => {
  const patch = { description: '', blocker: null, nextAction: '', tags: undefined, estimateMinutes: undefined, deadline: undefined };
  assert.deepEqual(decode('tasks:update', update(patch)).value, { id: 'task-1', patch: {
    description: null, tags: [], estimateMinutes: null, deadline: null, blocker: null, nextAction: null
  }, scope: undefined });
  for (const field of ['description', 'blocker', 'nextAction']) {
    assert.equal(decode('tasks:update', update({ [field]: ' ' })).ok, false);
    assert.equal(decode('tasks:update', update({ [field]: undefined })).ok, false);
  }
  for (const [field, limit] of [['title', 100], ['description', 1000], ['blocker', 80], ['nextAction', 200]]) {
    for (const length of [limit - 1, limit, limit + 1]) assert.equal(decode('tasks:update', update({ [field]: 'x'.repeat(length) })).ok, length <= limit);
  }
  const recurring = { currentTask: { seriesId: 'series-1' } };
  assert.deepEqual(decode('tasks:update', update({ title: 'task' }), recurring).errors, ['a recurring task patch must declare scope: current or current-and-future']);
  for (const scope of ['current', 'current-and-future']) assert.equal(decode('tasks:update', { ...update({ title: 'task' }), scope }, recurring).ok, true);
  assert.deepEqual(decode('tasks:update', { extra: true, id: '', patch: { unexpected: 1 }, scope: 'all' }, recurring).errors, [
    'unknown field: extra', 'id must be a non-empty string of at most 200 characters', 'unknown field: unexpected',
    'patch must contain at least one supported field', 'scope must be one of: current, current-and-future'
  ]);
});

test('step operations preserve stable ids, trimming, duplicate rejection and order', () => {
  const steps = [{ op: 'add', title: ' a ' }, { op: 'rename', stepId: ' one ', title: ' b ' },
    { op: 'remove', stepId: ' two ' }, { op: 'reorder', stepIds: [' two ', 'one'] }];
  assert.deepEqual(decode('tasks:update', update({ steps })).value.patch.steps, [
    { op: 'add', title: 'a' }, { op: 'rename', stepId: 'one', title: 'b' },
    { op: 'remove', stepId: 'two' }, { op: 'reorder', stepIds: ['two', 'one'] }
  ]);
  for (const stepIds of [[], ['one', ' one '], [''], [1], ['x'.repeat(201)]]) assert.equal(decode('tasks:update', update({ steps: [{ op: 'reorder', stepIds }] })).ok, false);
  for (const count of [0, 1, 100, 101]) assert.equal(decode('tasks:update', update({ steps: Array.from({ length: count }, () => ({ op: 'remove', stepId: 'one' })) })).ok, count >= 1 && count <= 100);
  assert.deepEqual(decode('tasks:update', update({ steps: [null, { op: 'toggle' }] })).errors,
    ['patch.steps[0] must be an object', 'patch.steps[1].op must be add, rename, remove, or reorder']);
});

test('series updates omit only absent/null/empty anchors and retain explicit null rules', () => {
  for (const anchorDate of [undefined, null, '']) {
    const result = decode('series:update', { seriesId: ' series-1 ', rule: rule({ anchorDate }) });
    assert.equal(result.ok, true);
    assert.equal(result.value.seriesId, 'series-1');
    assert.equal(Object.hasOwn(result.value.rule, 'anchorDate'), false);
    assert.equal(Object.hasOwn(result.value, 'state'), true);
  }
  assert.deepEqual(decode('series:update', { seriesId: 'series-1', rule: null }), { ok: true, value: { seriesId: 'series-1', rule: null, state: undefined } });
  assert.deepEqual(decode('series:update', { seriesId: 'series-1' }).errors, ['series update must change the rule or the state']);
  for (const state of ['active', 'paused', 'ended']) assert.equal(decode('series:update', { seriesId: 'series-1', state }).ok, true);
  assert.deepEqual(decode('series:update', { seriesId: 'series-1', state: null }).errors,
    ['state must be one of: active, paused, ended', 'series update must change the rule or the state']);
});

test('decoding frozen caller inputs does not mutate payload or recurring context', () => {
  const weekdays = Object.freeze([3, 1, 1]);
  const payload = Object.freeze({ title: ' task ', tags: Object.freeze([' b ', 'a']), recurrence: Object.freeze(rule({ weekdays })), steps: Object.freeze([Object.freeze({ title: ' step ' })]) });
  assert.equal(decode('tasks:add-with-breakdown', payload).ok, true);
  assert.deepEqual(weekdays, [3, 1, 1]);
  const context = Object.freeze({ currentTask: Object.freeze({ seriesId: 'series-1' }) });
  assert.equal(decode('tasks:update', Object.freeze({ id: 'task-1', patch: Object.freeze({ title: ' new ' }), scope: 'current' }), context).ok, true);
});

test('all four affected routes reject unauthorized senders before validation or handling', async () => {
  for (const channel of ['tasks:add', 'tasks:add-with-breakdown', 'tasks:update', 'series:update']) {
    const route = ipcRoutes.find(candidate => candidate.channel === channel);
    let invoke;
    let validations = 0;
    let calls = 0;
    const register = createIpcRegistrar({ ipcHost: { handle: (_, handler) => { invoke = handler; } },
      senderPage: event => event.surface, allowedPagesFor: () => route.surfaces,
      validatePayload: (_, payload) => { validations++; return route.decode(payload); } });
    register(channel, () => { calls++; });
    await assert.rejects(invoke({ surface: 'pet' }, null), /IPC sender is not allowed/);
    assert.equal(validations, 0);
    assert.equal(calls, 0);
  }
});
