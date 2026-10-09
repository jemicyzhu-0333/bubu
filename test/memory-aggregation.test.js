'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  aggregateMemories, AGGREGATED_TTL_DAYS, MIN_STREAK_DAYS, MIN_SESSIONS, MIN_FRICTION_COUNT
} = require('../src/capabilities/guidance/domain/memory-aggregation');
const { MEMORY_KINDS, MEMORY_SOURCES } = require('../src/platform/persistence/sqlite/memory-rules');

const ROOT = path.resolve(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 3, 0, 0);

function digest(overrides = {}) {
  return {
    range: { fromDayKey: '2026-09-07', toDayKey: '2026-09-20' },
    focusMinutes: 0,
    sessionCount: 0,
    completedTaskCount: 0,
    abandonedSessionCount: 0,
    topTasks: [],
    frictionSignals: [],
    streakDays: 0,
    ...overrides
  };
}

const byKind = entries => Object.fromEntries(entries.map(entry => [entry.kind, entry]));

test('a thin window writes nothing at all rather than a hedged sentence', () => {
  // 这是这个模块存在的第一条理由:一条「你好像有点…」的记忆会被当成事实注入接下来
  // 90 天的每一次请求,并且自我强化(ARCHITECTURE「事实流与长期记忆」)。证据不够就一条都不写。
  assert.deepEqual(aggregateMemories(digest(), { now: NOW }), []);
  assert.deepEqual(aggregateMemories(digest({
    streakDays: MIN_STREAK_DAYS - 1,
    sessionCount: MIN_SESSIONS - 1,
    completedTaskCount: 1,
    frictionSignals: [{ kind: 'task.stuck', count: MIN_FRICTION_COUNT - 1 }]
  }), { now: NOW }), [], '三个阈值都差一点的时候也是一条都不写');
});

test('each derivation turns on exactly at its floor', () => {
  const streak = aggregateMemories(digest({ streakDays: MIN_STREAK_DAYS }), { now: NOW });
  assert.deepEqual(streak.map(entry => entry.kind), ['rhythm']);
  const sessions = aggregateMemories(digest({ sessionCount: MIN_SESSIONS, completedTaskCount: 2 }), { now: NOW });
  assert.deepEqual(sessions.map(entry => entry.kind), ['pattern']);
  const friction = aggregateMemories(
    digest({ frictionSignals: [{ kind: 'task.avoided', count: MIN_FRICTION_COUNT }] }), { now: NOW });
  assert.deepEqual(friction.map(entry => entry.kind), ['friction']);
});

test('every entry is something the repository will actually accept', () => {
  // upsert 会以 unknown-kind / forbidden-source 拒绝,而那种拒绝是静默的(仓库把失败
  // 吞掉以保证专注流不中断)。所以枚举要在这里对齐,不能等运行时。
  const entries = aggregateMemories(digest({
    streakDays: 6, sessionCount: 20, completedTaskCount: 11, abandonedSessionCount: 3,
    frictionSignals: [{ kind: 'task.stuck', count: 7 }]
  }), { now: NOW });
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.ok(MEMORY_KINDS.includes(entry.kind), `kind ${entry.kind}`);
    assert.ok(MEMORY_SOURCES.includes(entry.source));
    assert.equal(entry.source, 'aggregated');
    assert.ok(entry.subject && entry.subject.trim().length > 0);
    assert.ok(entry.body && entry.body.trim().length > 0);
    // sanitizeBody 会砍掉换行并限长,这里先别生成需要被砍的东西。
    assert.doesNotMatch(entry.body, /[\r\n]/);
    assert.ok(entry.body.length <= 500);
    assert.ok(entry.confidence > 0 && entry.confidence <= 0.9,
      '置信度永远不到 1：这是两周窗口的汇总，不是关于这个人的事实');
  }
});

test('aggregated memories expire in 90 days, which is what makes them aggregated', () => {
  // ARCHITECTURE「事实流与长期记忆」：`aggregated` 会过期，`user-confirmed` 永不过期。这个模块只产前者，所以
  // 每一条都必须带 expiresAt —— 漏掉就等于悄悄把一条推算出来的东西变成永久事实。
  const entries = aggregateMemories(digest({ streakDays: 5, sessionCount: 9, completedTaskCount: 4 }), { now: NOW });
  assert.ok(entries.length >= 2);
  for (const entry of entries) {
    assert.equal(entry.expiresAt, NOW + AGGREGATED_TTL_DAYS * DAY_MS);
  }
  assert.equal(AGGREGATED_TTL_DAYS, 90);
});

test('subjects are constant, so today replaces yesterday instead of piling up', () => {
  // unique_key 是 kind + 规范化 subject。主题里一旦带上数字或日期，每天就多三行，
  // 500 条上限会被这一个写入者吃掉，用户看到的是一堆近似重复。
  const lean = aggregateMemories(digest({ streakDays: 3, sessionCount: 5, completedTaskCount: 1 }), { now: NOW });
  const rich = aggregateMemories(digest({
    range: { fromDayKey: '2026-10-01', toDayKey: '2026-10-14' },
    streakDays: 11, sessionCount: 40, completedTaskCount: 25
  }), { now: NOW + 30 * DAY_MS });
  const subjectsOf = entries => entries.filter(e => e.kind !== 'friction').map(e => e.subject).sort();
  assert.deepEqual(subjectsOf(lean), subjectsOf(rich));
  for (const entry of [...lean, ...rich]) {
    assert.doesNotMatch(entry.subject, /\d/, '主题里不许出现数字');
  }
});

test('no user-authored text is ever copied into a memory body', () => {
  // digest 里带着任务标题，但 digest 是每次请求算一遍、关掉开关就不发的东西；
  // 记忆行要活 90 天并在之后每次请求里注入。只有计数和天数可以过这条线。
  const entries = aggregateMemories(digest({
    streakDays: 4,
    sessionCount: 12,
    completedTaskCount: 6,
    topTasks: [
      { title: '把季度汇报的第三节重写', focusMinutes: 210, completed: false },
      { title: '给张伟回邮件', focusMinutes: 40, completed: true }
    ],
    frictionSignals: [{ kind: 'task.deferred', count: 5 }]
  }), { now: NOW });
  const blob = entries.map(entry => `${entry.subject}${entry.body}`).join('|');
  assert.doesNotMatch(blob, /季度汇报|张伟|邮件/);
});

test('only the single most frequent friction signal is written', () => {
  // 三条卡点并列读起来像一份对人的判词；一条被计数的事实读起来像一条记录。
  const entries = aggregateMemories(digest({
    frictionSignals: [
      { kind: 'task.deferred', count: 4 },
      { kind: 'task.stuck', count: 9 },
      { kind: 'task.avoided', count: 6 }
    ]
  }), { now: NOW });
  assert.equal(entries.length, 1);
  assert.match(entries[0].body, /9 次/);
  assert.match(entries[0].body, /卡住/);
  assert.doesNotMatch(entries[0].body, /绕开|往后推/);
});

test('an unknown friction kind is skipped instead of being printed raw', () => {
  const entries = aggregateMemories(digest({
    frictionSignals: [{ kind: 'task.exploded', count: 20 }, { kind: 'task.stuck', count: 3 }]
  }), { now: NOW });
  assert.equal(entries.length, 1);
  assert.match(entries[0].body, /卡住/);
  assert.doesNotMatch(entries[0].body, /task\.exploded/);
});

test('an abandoned session is counted, never called a failure', () => {
  // 时间轴支持不了「完成率低」这种判断：提前停下的一段专注不是一次失败。
  const entries = aggregateMemories(digest({
    sessionCount: 10, completedTaskCount: 2, abandonedSessionCount: 6
  }), { now: NOW });
  const body = byKind(entries).pattern.body;
  assert.match(body, /6 段提前停下/);
  assert.doesNotMatch(body, /失败|没做到|效率低|完成率|拖延|懒/);
});

test('a missing or broken digest produces nothing instead of throwing', () => {
  // 它挂在日推进后面，抛出去会把归档提醒那一路带下来。
  assert.deepEqual(aggregateMemories(null, { now: NOW }), []);
  assert.deepEqual(aggregateMemories(undefined, { now: NOW }), []);
  assert.deepEqual(aggregateMemories(digest(), {}), [], '没有 now 就没有 expiresAt，宁可不写');
  assert.deepEqual(aggregateMemories(digest({ streakDays: 4 }), { now: NaN }), []);
  const broken = aggregateMemories({ streakDays: 4, sessionCount: 8, frictionSignals: 'nope' }, { now: NOW });
  assert.equal(broken.length, 2, 'range 缺失时仍然写，只是句子里不提天数');
  for (const entry of broken) assert.doesNotMatch(entry.body, /最近/);
});

test('the module stays pure so the domain gate keeps holding', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/capabilities/guidance/domain/memory-aggregation.js'), 'utf8');
  assert.doesNotMatch(source, /Date\.now\s*\(|Math\.random\s*\(|randomUUID\s*\(/);
  assert.doesNotMatch(source, /require\s*\(/, '它不许去认识仓库或时钟');
  // 同一个 digest 加同一个 now 必须给出同一批条目，否则「今天记住了什么」这个问题
  // 没有答案，而这件事用户是要能核对的（ARCHITECTURE「事实流与长期记忆」）。
  const input = digest({ streakDays: 5, sessionCount: 14, completedTaskCount: 7,
    frictionSignals: [{ kind: 'task.stuck', count: 4 }] });
  assert.deepEqual(aggregateMemories(input, { now: NOW }), aggregateMemories(input, { now: NOW }));
});

test('versioned memory cutover removes the legacy automatic aggregation writer from composition', () => {
  const mainSource = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  assert.doesNotMatch(mainSource, /refreshAggregatedMemories|aggregateMemories|memories\.(upsert|pruneExpired)/);
  assert.match(mainSource, /runDailyResetWorkflow\.execute\(\);/);
});
