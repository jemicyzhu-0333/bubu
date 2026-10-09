'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePersistedState, normalizeReviews } = require('../src/platform/persistence/persisted-schema');
const work = require('../src/capabilities/work');
const {
  buildCloseout,
  buildStartup,
  ensureDueReviews,
  openReview,
  resolveReview
} = require('../src/capabilities/guidance').dailyReview;

const DAY = '2026-09-01';
const NOW = new Date(2026, 8, 1, 21, 15).getTime();

function fixture() {
  return normalizePersistedState({
    tasks: [
      { id: 'done', title: '完成稿件', createdAt: NOW - 10000, done: true, completedAt: NOW - 1000 },
      { id: 'carry', title: '继续稿件', createdAt: NOW - 86400000, plannedFor: '2026-08-31', lastCheckpoint: '写结论', lastCheckpointAt: NOW - 86400000 },
      { id: 'deadline', title: '发送稿件', createdAt: NOW, deadline: new Date(NOW + 3600000).toISOString() }
    ],
    impulses: [{ id: 'idea', text: '补一张图', createdAt: NOW }],
    stats: { dailyFocus: { [DAY]: 3600000 } }
  }, { now: NOW });
}

test('closeout and startup facts are deterministic projections of local state', () => {
  const state = fixture();
  assert.deepEqual(buildCloseout(state, { dayKey: DAY }), buildCloseout(state, { dayKey: DAY }));
  const closeout = buildCloseout(state, { dayKey: DAY });
  assert.equal(closeout.completed[0].id, 'done');
  assert.equal(closeout.focusMs, 3600000);
  assert.equal(closeout.impulses[0].id, 'idea');
  const startup = buildStartup(state, { dayKey: DAY });
  assert.equal(startup.carryovers[0].id, 'carry');
  assert.equal(startup.deadlineCandidates[0].id, 'deadline');
});

test('daily cards are idempotent, resumable and only confirm selected startup tasks', () => {
  const state = fixture();
  const first = ensureDueReviews(state, { now: NOW, workStartHour: 10, workEndHour: 21 });
  const second = ensureDueReviews(state, { now: NOW, workStartHour: 10, workEndHour: 21 });
  assert.equal(first.length, 3);
  assert.equal(second.length, 0);
  assert.equal(state.reviews.pending.length, 3);

  const id = `review:startup:${DAY}`;
  assert.equal(openReview(state, id).facts.kind, 'startup');
  assert.equal(resolveReview(state, { id, action: 'progress', progress: 40 }).card.progress, 40);
  const resolved = resolveReview(state, {
    id,
    action: 'done',
    confirmedTaskIds: ['deadline', 'carry', 'not-a-pick'],
    now: NOW
  });
  // 今天的启动：1–3 件建议（截止 → 计划今天 → 昨日延续 → 今天新增），顺序保留，非建议项被忽略。
  assert.deepEqual(resolved.updatedTasks, ['deadline', 'carry']);
  // Guidance decides which startup tasks were confirmed; work owns the plan write. The
  // resolve-review workflow is the only place the two meet.
  work.taskPlanning.confirmPlannedTasks(state, {
    taskIds: resolved.updatedTasks,
    dayKey: resolved.card.dayKey,
    now: NOW
  });
  assert.equal(state.tasks.find(task => task.id === 'deadline').plannedFor, DAY);
  assert.equal(state.tasks.find(task => task.id === 'carry').plannedFor, DAY);
  assert.equal(state.reviews.pending.find(card => card.id === id).status, 'done');
  assert.equal(resolveReview(state, { id, action: 'done' }).reason, 'review-already-resolved');
});

test('review retention keeps the newest cards regardless of review kind', () => {
  const cards = Array.from({ length: 16 }, (_, index) => ({
    id: `ignored-${index}`,
    kind: index % 2 === 0 ? 'closeout' : 'startup',
    dayKey: `2026-08-${String(index + 1).padStart(2, '0')}`,
    createdAt: index + 1,
    status: 'done',
    progress: 100
  }));
  const normalized = normalizeReviews({ pending: cards }).pending;

  assert.equal(normalized.length, 14);
  assert.deepEqual(normalized.map(card => card.createdAt), Array.from({ length: 14 }, (_, index) => index + 3));
});

// 装好后第一个早上就出现一张空的“昨天的收口”，读起来像作业而不是总结。
test('no closeout is created for a day with no activity, and one is for a day with any', () => {
  const morning = new Date(2026, 8, 2, 11, 0).getTime();
  const fresh = normalizePersistedState({ tasks: [], impulses: [] }, { now: morning });
  const created = ensureDueReviews(fresh, { now: morning, workStartHour: 10, workEndHour: 21 });
  assert.deepEqual(created.map(card => card.kind), ['startup']);
  assert.ok(!fresh.reviews.pending.some(card => card.id === `review:closeout:${DAY}`));

  for (const [label, patch] of [
    ['focus', { stats: { dailyFocus: { [DAY]: 60000 } } }],
    ['capture', { impulses: [{ id: 'i', text: '想法', createdAt: NOW }] }],
    ['new task', { tasks: [{ id: 't', title: '新任务', createdAt: NOW }] }]
  ]) {
    const state = normalizePersistedState({ tasks: [], impulses: [], ...patch }, { now: morning });
    const cards = ensureDueReviews(state, { now: morning, workStartHour: 10, workEndHour: 21 });
    assert.ok(cards.some(card => card.id === `review:closeout:${DAY}`), label);
  }
});

test('review cards are titled by their own day, not always as today', async () => {
  const { reviewTitle } = await import('../src/surfaces/popover/features/review.mjs');
  const now = new Date(2026, 8, 2, 9, 0).getTime();
  assert.equal(reviewTitle({ kind: 'closeout', dayKey: '2026-09-01' }, now), '昨天的收口');
  assert.equal(reviewTitle({ kind: 'closeout', dayKey: '2026-09-02' }, now), '今天的收口');
  assert.equal(reviewTitle({ kind: 'startup', dayKey: '2026-09-02' }, now), '今天的启动');
  assert.equal(reviewTitle({ kind: 'startup', dayKey: '2026-08-28' }, now), '8月28日的启动');
});

test('the closeout lists only the landings left today; older ones wait for tomorrow’s startup', () => {
  const state = normalizePersistedState({
    tasks: [
      { id: 'today', title: '今天停下的', createdAt: NOW - 90000000, lastCheckpoint: '写到第三段', lastCheckpointAt: NOW - 3600000 },
      { id: 'old', title: '前天停下的', createdAt: NOW - 200000000, lastCheckpoint: '列了提纲', lastCheckpointAt: NOW - 2 * 86400000 },
      { id: 'next-today', title: '只留了下一步', createdAt: NOW - 90000000, nextAction: '打开文档', updatedAt: NOW - 1800000 },
      { id: 'next-old', title: '很久前留的下一步', createdAt: NOW - 400000000, nextAction: '回邮件', updatedAt: NOW - 5 * 86400000 }
    ]
  }, { now: NOW });
  assert.deepEqual(buildCloseout(state, { dayKey: DAY }).landings.map(item => item.id).sort(), ['next-today', 'today']);
  // 前天的落点不是没了：它属于“昨天延续”，在下一个工作日的启动卡里。
  const tomorrow = new Date(2026, 8, 2, 10, 0).getTime();
  const startup = buildStartup(normalizePersistedState({
    tasks: [{ id: 'today', title: '今天停下的', createdAt: NOW - 90000000, lastCheckpoint: '写到第三段', lastCheckpointAt: NOW - 3600000 }]
  }, { now: tomorrow }), { dayKey: '2026-09-02' });
  assert.deepEqual(startup.carryovers.map(item => item.id), ['today']);
});
