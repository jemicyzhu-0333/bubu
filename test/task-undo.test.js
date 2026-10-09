'use strict';

// 完成之后几秒内的撤销：只回滚这次提交实际改动的字段，而且只在这些字段没被别人改过时才回滚。
// 奖励、经验、统计、伙伴这些都不用“反向计算”，因为放回去的是提交之前的原值。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompleteWorkItemWorkflow, createUnitOfWork } = require('../src/application');
const { createUndoRegistry } = require('../src/application/state/undo-registry');
const { createTaskUndo: bootstrapTaskUndo } = require('../src/bootstrap/task-undo');
const execution = require('../src/capabilities/execution');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const T0 = Date.parse('2026-09-08T09:00:00Z');

function repository(initial) {
  let state = structuredClone(initial);
  let revision = 0;
  return {
    snapshot: () => structuredClone(state),
    commit: candidate => { state = structuredClone(candidate); revision += 1; return structuredClone(state); },
    revision: () => revision,
    inspect: () => ({ state: structuredClone(state), revision })
  };
}

function baseState(extra = {}) {
  const state = normalizePersistedState({
    level: 2,
    tasks: [{ id: 'task-1', title: '完成这一小步', done: false, createdAt: 1, steps: [] },
      { id: 'task-2', title: '另一件', done: false, createdAt: 2, steps: [] }],
    ...extra
  }, { now: T0 });
  state.nowTaskId = 'task-1';
  return state;
}

function build(initial = baseState()) {
  const repo = repository(initial);
  let now = T0;
  const clock = { now: () => now };
  const unitOfWork = createUnitOfWork({ repository: repo });
  const removed = [];
  const published = [];
  let sequence = 0;
  const undo = bootstrapTaskUndo({
    unitOfWork, clock, idFactory: prefix => `${prefix}-${++sequence}`,
    timelineRecorder: { recordTaskCompletionUndone: meta => removed.push(meta) },
    publishChange: dirty => published.push(dirty)
  });
  const workflow = createCompleteWorkItemWorkflow({
    unitOfWork, clock, idFactory: prefix => `${prefix}-next`, undo: undo.registry
  });
  return { repo, workflow, undo, removed, published, advance: ms => { now += ms; }, clock };
}

test('completing hands back a one-shot ticket, and undoing puts every touched field back exactly', () => {
  const h = build();
  const before = h.repo.inspect().state;
  const result = h.workflow.execute({ taskId: 'task-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.undo).sort(), ['token', 'ttlMs']);
  assert.equal(result.undo.ttlMs, 5000);
  const done = h.repo.inspect().state;
  assert.equal(done.tasks.find(task => task.id === 'task-1').done, true);
  assert.ok(done.xp > before.xp || done.stats.totalTasksDone > before.stats.totalTasksDone, 'the completion really paid something');

  const undone = h.undo.undoComplete(result.undo.token);
  assert.deepEqual(undone, { ok: true, taskId: 'task-1' });
  assert.deepEqual(h.repo.inspect().state, before, 'a completion followed by its undo leaves no trace at all');
  assert.equal(h.removed.length, 1, 'the timeline row is retracted');
  assert.equal(h.removed[0].taskId, 'task-1');
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].tasks, true);
  assert.equal(h.published[0].pet, true);
  assert.equal(done.pet.foodTickets, before.pet.foodTickets + 3);
  assert.equal(h.repo.inspect().state.pet.foodTickets, before.pet.foodTickets);

  assert.equal(h.undo.undoComplete(result.undo.token).reason, 'undo-unavailable', 'a ticket works once');
});

test('the same task can be completed again after an undo and pays exactly once', () => {
  const h = build();
  const first = h.workflow.execute({ taskId: 'task-1' });
  h.undo.undoComplete(first.undo.token);
  const second = h.workflow.execute({ taskId: 'task-1' });
  assert.equal(second.ok, true);
  const state = h.repo.inspect().state;
  assert.equal(state.stats.totalTasksDone, 1);
});

test('an undo is refused when something else changed what the completion wrote, and nothing is overwritten', () => {
  const h = build();
  const result = h.workflow.execute({ taskId: 'task-1' });
  // 这几秒里别的动作又改了同一批字段：例如又完成了另一件，xp / stats 都变了。
  h.workflow.execute({ taskId: 'task-2' });
  const between = h.repo.inspect();
  const refused = h.undo.undoComplete(result.undo.token);
  assert.deepEqual(refused, { ok: false, reason: 'undo-state-changed' });
  assert.deepEqual(h.repo.inspect().state, between.state, 'a refused undo writes nothing');
  assert.equal(h.repo.inspect().revision, between.revision);
  assert.equal(h.removed.length, 0);
});

test('an unrelated change to fields the completion did not touch does not block the undo', () => {
  const h = build();
  const result = h.workflow.execute({ taskId: 'task-1' });
  // 用同一个工作单元改一个完成没有碰过的字段。
  const unrelated = createUnitOfWork({ repository: h.repo }).run({
    writes: ['impulses'], transition: state => { state.impulses = [{ id: 'imp-1', text: '顺手记的', createdAt: T0 }]; }
  });
  assert.equal(unrelated.committed, true);
  assert.equal(h.undo.undoComplete(result.undo.token).ok, true);
  assert.equal(h.repo.inspect().state.impulses.length, 1, 'the unrelated write survives the undo');
});

test('a ticket expires: after the countdown plus a short grace the undo is refused', () => {
  const h = build();
  const fresh = h.workflow.execute({ taskId: 'task-1' });
  h.advance(5000 + 1000);
  assert.equal(h.undo.undoComplete(fresh.undo.token).ok, true, 'a tap that lands just after the bar ran out still works');

  const h2 = build();
  const late = h2.workflow.execute({ taskId: 'task-1' });
  h2.advance(5000 + 1500 + 1);
  assert.deepEqual(h2.undo.undoComplete(late.undo.token), { ok: false, reason: 'undo-expired' });
  assert.equal(h2.repo.inspect().state.tasks[0].done, true, 'an expired undo leaves the completion alone');
});

test('a completion that levels up, unlocks a skin or moves a running focus session offers no undo', () => {
  // 升级：把经验放到只差一点。
  const levelUp = build(baseState({ level: 1, xp: 0 }));
  const leveled = levelUp.workflow.execute({ taskId: 'task-1' });
  assert.equal(leveled.ok, true);
  assert.equal(levelUp.repo.inspect().state.level, 2, 'first real completion earns 30 XP and reaches level two');
  assert.equal(leveled.undo, undefined, 'the level-up notification already went out');

  // 专注中完成：计时状态已经被暂停，回滚它会和计时器不同步。
  const running = baseState();
  running.focusSession = execution.focusSession.startFocus(
    execution.focusSession.createIdleSession(T0), { now: T0, durationMs: 60_000, taskId: 'task-1', sessionId: 'focus-1' }
  ).session;
  const focused = build(running);
  focused.advance(30_000);
  const result = focused.workflow.execute({ taskId: 'task-1' });
  assert.equal(result.ok, true);
  assert.equal(result.undo, undefined, 'completing during a focus session offers no undo');
});

test('without a registry the workflow answers exactly as before', () => {
  const repo = repository(baseState());
  const workflow = createCompleteWorkItemWorkflow({
    unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => T0 }, idFactory: prefix => `${prefix}-x`
  });
  assert.deepEqual(workflow.execute({ taskId: 'task-1' }), { ok: true, done: true, nextOccurrenceDate: null });
});

test('the registry keeps only a handful of tickets and ignores garbage', () => {
  const repo = repository(baseState());
  let n = 0;
  const registry = createUndoRegistry({
    unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => T0 }, idFactory: () => `undo-${++n}`
  });
  assert.equal(registry.capture({ kind: 'x', paths: [] }), null);
  assert.equal(registry.capture({ paths: ['xp'] }), null);
  for (let index = 0; index < 9; index += 1) registry.capture({ kind: 'x', subject: index, paths: ['xp'], before: { xp: 0 }, after: { xp: 1 } });
  assert.equal(registry.size(), 5);
  for (const bad of [undefined, null, 42, {}, 'undo-unknown']) assert.equal(registry.undo(bad).reason, 'undo-unavailable');
});

test('a token can never overwrite a live one, even if the id source repeats itself', () => {
  const repo = repository(baseState());
  const ids = ['undo-a', 'undo-a', 'undo-a', 'undo-b'];
  const registry = createUndoRegistry({
    unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => T0 }, idFactory: () => ids.shift()
  });
  const first = registry.capture({ kind: 'x', subject: 1, paths: ['xp'], before: { xp: 0 }, after: { xp: 1 } });
  const second = registry.capture({ kind: 'x', subject: 2, paths: ['xp'], before: { xp: 0 }, after: { xp: 1 } });
  assert.equal(first.token, 'undo-a');
  assert.equal(second.token, 'undo-b');
  assert.equal(registry.size(), 2);
  const stuck = createUndoRegistry({ unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => T0 }, idFactory: () => 'same' });
  assert.ok(stuck.capture({ kind: 'x', paths: ['xp'], before: { xp: 0 }, after: { xp: 1 } }));
  assert.equal(stuck.capture({ kind: 'x', paths: ['xp'], before: { xp: 0 }, after: { xp: 1 } }), null, 'gives up rather than clobbering');
});
