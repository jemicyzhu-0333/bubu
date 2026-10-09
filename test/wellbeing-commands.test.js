'use strict';

// 起床时间与情绪记录（schema 11）的命令层：一笔事务、只写声明过的字段、闪念被消费、
// 起床时间真的改了当天的曲线、情绪文字从不出现在任何会发给模型的东西里。
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUnitOfWork, createSetWakeTimeCommand, createKeepMoodNoteCommand, createDeleteMoodNoteCommand
} = require('../src/application');
const { buildEnergyCurveView } = require('../src/application/queries/energy-curve-view');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { validateIpcPayload } = require('../src/application/ipc/route-catalog');

const NOW = new Date(2026, 8, 29, 15, 0).getTime();
const TODAY = '2026-09-29';

function repository(initial) {
  let state = structuredClone(initial);
  let commits = 0;
  return {
    snapshot: () => structuredClone(state),
    revision: () => commits,
    commit: candidate => { state = structuredClone(candidate); commits += 1; return structuredClone(state); },
    inspect: () => ({ state: structuredClone(state), commits })
  };
}

function build(over = {}) {
  const repo = repository(normalizePersistedState({
    impulses: [{ id: 'imp-1', text: '这个会又拖了一小时，烦', createdAt: NOW - 3600_000 }, { id: 'imp-2', text: '别的', createdAt: NOW - 100 }],
    ...over
  }, { now: NOW }));
  const published = [];
  const ports = { unitOfWork: createUnitOfWork({ repository: repo }), clock: { now: () => NOW }, publish: fact => published.push(fact) };
  let seq = 0;
  return {
    repo, published,
    setWake: createSetWakeTimeCommand(ports),
    keep: createKeepMoodNoteCommand({ ...ports, idFactory: prefix => `${prefix}-${++seq}` }),
    remove: createDeleteMoodNoteCommand(ports)
  };
}

test('the wake time is recorded for the main process’s today, can be corrected, and a skip is remembered', () => {
  const { repo, setWake, published } = build();
  assert.deepEqual(setWake.execute({ minutes: 9 * 60 }), { ok: true, changed: true, minutes: 540 });
  assert.deepEqual(repo.inspect().state.wakeTimes, { [TODAY]: 540 });
  assert.equal(setWake.execute({ minutes: 9 * 60 }).changed, false, 'the same answer twice writes nothing');
  assert.equal(setWake.execute({ minutes: 8 * 60 + 30 }).changed, true);
  assert.equal(setWake.execute({ minutes: null }).changed, true);
  assert.deepEqual(repo.inspect().state.wakeTimes, { [TODAY]: null });
  assert.equal(setWake.execute({ minutes: 15 * 60 }).ok, false, 'after 14:00 is not a wake time');
  assert.ok(published.every(fact => fact.dirty.wellbeing === true));
});

test('keeping a mood note moves the text out of the inbox in one transaction', () => {
  const { repo, keep, published } = build();
  const result = keep.execute({ impulseId: 'imp-1' });
  assert.equal(result.ok, true);
  const { state, commits } = repo.inspect();
  assert.equal(commits, 1);
  assert.deepEqual(state.impulses.filter(item => !item.resolution).map(item => item.id), ['imp-2']);
  assert.deepEqual(state.moodNotes, [{ id: 'mood-1', at: NOW - 3600_000, text: '这个会又拖了一小时，烦' }]);
  assert.deepEqual(published[0].dirty, { wellbeing: true, impulses: true, energy: true, recommendations: true });
  assert.equal(keep.execute({ impulseId: 'imp-1' }).reason, 'impulse-not-found');
  assert.equal(repo.inspect().commits, 1, 'a refused command performs zero writes');
});

test('a mood note can always be deleted, and only by its own id', () => {
  const { repo, keep, remove } = build();
  keep.execute({ impulseId: 'imp-1' });
  keep.execute({ impulseId: 'imp-2' });
  assert.equal(remove.execute({ id: 'nope' }).reason, 'mood-note-not-found');
  assert.equal(remove.execute({ id: 'mood-1' }).ok, true);
  assert.deepEqual(repo.inspect().state.moodNotes.map(note => note.id), ['mood-2']);
  assert.deepEqual(repo.inspect().state.impulses.map(item => item.id), ['imp-2']);
});

test('the reported wake time moves today’s baseline and nothing else', () => {
  const view = wakeTimes => buildEnergyCurveView({
    snapshot: normalizePersistedState({ wakeTimes }, { now: NOW }),
    settings: { energyCurveEnabled: true }, now: NOW, dayKey: TODAY, workStartHour: 10
  });
  const guessed = view({});
  const early = view({ [TODAY]: 6 * 60 });
  const late = view({ [TODAY]: 11 * 60 });
  const skipped = view({ [TODAY]: null });
  assert.notEqual(early.nowLevel, late.nowLevel, 'getting up at 6 and at 11 must not give the same 15:00');
  assert.equal(skipped.nowLevel, guessed.nowLevel, 'a skip changes nothing');
  const otherDay = buildEnergyCurveView({
    snapshot: normalizePersistedState({ wakeTimes: { [TODAY]: 11 * 60 } }, { now: NOW }),
    settings: { energyCurveEnabled: true }, now: NOW - 86_400_000, dayKey: '2026-09-28', workStartHour: 10
  });
  const otherDayGuessed = buildEnergyCurveView({
    snapshot: normalizePersistedState({}, { now: NOW }),
    settings: { energyCurveEnabled: true }, now: NOW - 86_400_000, dayKey: '2026-09-28', workStartHour: 10
  });
  assert.equal(otherDay.nowLevel, otherDayGuessed.nowLevel, 'yesterday is not moved by today’s answer');
});

test('the renderer can name neither the day nor an id it does not own, and the channels are popover-only', () => {
  assert.equal(validateIpcPayload('energy:set-wake', { minutes: 480 }).ok, true);
  assert.equal(validateIpcPayload('energy:set-wake', { minutes: null }).ok, true);
  assert.equal(validateIpcPayload('energy:set-wake', { minutes: 480, dayKey: '2020-01-01' }).ok, false);
  assert.equal(validateIpcPayload('energy:set-wake', { minutes: 900 }).ok, false);
  assert.equal(validateIpcPayload('energy:set-wake', { minutes: 7.5 }).ok, false);
  assert.equal(validateIpcPayload('impulses:keep-mood', 'imp-1').ok, true);
  assert.equal(validateIpcPayload('impulses:keep-mood', { id: 'x' }).ok, false);
  assert.equal(validateIpcPayload('mood:delete', 'mood-1').ok, true);
});

test('mood text never reaches a model: no LLM task field, disclosure or memory digest mentions it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ROOT = path.resolve(__dirname, '..');
  const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  for (const file of ['src/core/llm/tasks.js', 'src/capabilities/guidance/application/proposal-preview.js',
    'src/application/ai/context-reads.js', 'src/platform/persistence/sqlite/memory-rules.js']) {
    assert.doesNotMatch(read(file), /moodNotes|mood-note|moodNote/, `${file} must not read mood notes`);
  }
});
