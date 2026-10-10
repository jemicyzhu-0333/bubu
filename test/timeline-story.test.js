'use strict';

// 进展页时间线的竖版故事：按时间一行一行读，专注是带时长条的一行，空白如实写出，
// 能量线只是背景参考，拿不到可靠采样的日子不画。
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimelineStory } = require('../src/surfaces/popover/features/timeline-story.mjs');
const { timelineDay } = require('../src/capabilities/progress');

const DAY_KEY = '2026-09-24';
const at = (hour, minute = 0) => new Date(2026, 8, 24, hour, minute).getTime();
const dayStart = at(0);
const dayEnd = new Date(2026, 8, 25).getTime();
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function story(overrides = {}) {
  const day = {
    dayKey: DAY_KEY, dayStart, dayEnd, rangeStart: at(8), rangeEnd: at(15),
    lanes: [{ taskId: 'task', segments: [{ sessionId: 'session-1', startMs: at(9), endMs: at(9, 30), durationMs: 1800000 }] }],
    markers: [
      { occurredAt: at(8), kind: 'routine.logged', routineId: 'medicine', routineKind: 'medication', status: 'done' },
      { occurredAt: at(9), kind: 'session.started', sessionId: 'session-1', taskId: 'task', sessionKind: 'focus' },
      { occurredAt: at(14), kind: 'task.completed', taskId: 'task' }
    ],
    intervals: [],
    ...overrides.day
  };
  const state = {
    serverNow: at(20), tasks: [{ id: 'task', title: '整理笔记' }], archivedTasks: [],
    routines: { items: [{ id: 'medicine', title: '我的药' }] },
    ...overrides.state
  };
  return buildTimelineStory({
    day, energyCurve: overrides.energyCurve ?? null, state, escapeHTML,
    formatMs: value => `${Math.round(value / 60000)}分`
  });
}

const details = markup => [...markup.matchAll(/data-detail="([^"]*)"/g)].map(match => match[1]);

test('a short free-focus interval shows seconds and curve extrema are labeled on the plot', () => {
  const result = story({ day: { lanes: [{ taskId: null, segments: [{ startMs: at(9), endMs: at(9) + 15000, durationMs: 15000 }] }], markers: [] },
    energyCurve: { dayKey: DAY_KEY, sampleMinutes: 360, levels: [35, 67, 40, 20], nowMinute: 1200 } });
  assert.match(result.markup, /自由专注/);
  assert.match(result.markup, /15秒/);
  assert.doesNotMatch(result.markup, /专注 0分|未关联任务/);
  assert.match(result.markup, /低 20/);
  assert.match(result.markup, /高 67/);
});

test('rows come in time order, grouped under the part of the day they happened in', () => {
  const { markup, entryCount, firstEvent } = story();
  assert.equal(entryCount, 3);
  assert.equal(firstEvent, at(8));
  assert.deepEqual(details(markup), [
    '08:00 · 做了 · 我的药',
    '09:00–09:30 · 专注 30分 · 整理笔记',
    '14:00 · 完成 · 整理笔记'
  ]);
  assert.deepEqual([...markup.matchAll(/<li class="tl-part">([^<]+)</g)].map(match => match[1]), ['上午', '下午']);
});

test('a start marker with the same explicit session identity does not get its own row', () => {
  assert.doesNotMatch(story().markup, /开始专注/);
  const pointOnly = story({ day: { lanes: [] } }).markup;
  assert.match(pointOnly, /开始专注/);
});

for (const identityKey of ['sessionId', 'causationId', 'commandId']) {
  test(`session boundaries collapse only for an exact ${identityKey} match`, () => {
    const result = story({ day: {
      lanes: [{ taskId: 'task', segments: [{
        [identityKey]: 'same-id', startMs: at(9), endMs: at(9, 30), durationMs: 1800000
      }] }],
      markers: [
        { [identityKey]: 'same-id', kind: 'session.started', occurredAt: at(8), taskId: 'task' },
        { [identityKey]: 'same-id', kind: 'session.completed', occurredAt: at(10), taskId: 'task' },
        { [identityKey]: 'different-id', kind: 'session.started', occurredAt: at(9), taskId: 'task' },
        { [identityKey]: 'different-id', kind: 'session.completed', occurredAt: at(9, 30), taskId: 'task' }
      ]
    } });
    assert.equal(result.entryCount, 3, 'identity, rather than distance from an edge, decides folding');
    assert.deepEqual(details(result.markup), [
      '09:00–09:30 · 专注 30分 · 整理笔记',
      '09:00 · 开始专注 · 整理笔记',
      '09:30 · 专注结束 · 整理笔记'
    ]);
  });
}

test('independent nearby sessions and matching task titles remain visible through the real day projection', () => {
  const projected = timelineDay.buildTimelineDay([
    { id: 'segment-a', kind: 'session.segment', sessionId: 'a', taskId: 'task',
      occurredAt: at(9), durationMs: 30 * 60000, payload: { sessionKind: 'focus' } },
    { id: 'start-a', kind: 'session.started', sessionId: 'a', taskId: 'task', occurredAt: at(9) },
    { id: 'complete-a', kind: 'session.completed', sessionId: 'a', taskId: 'task', occurredAt: at(9, 30) },
    { id: 'start-b', kind: 'session.started', sessionId: 'b', taskId: 'other', occurredAt: at(9, 1) },
    { id: 'complete-c', kind: 'session.completed', sessionId: 'c', taskId: 'task', occurredAt: at(9, 29) },
    { id: 'task-done', kind: 'task.completed', sessionId: 'a', taskId: 'task', occurredAt: at(9, 30) }
  ], { dayKey: DAY_KEY });
  const result = story({ day: projected, state: {
    tasks: [{ id: 'task', title: '整理笔记' }, { id: 'other', title: '整理笔记' }]
  } });
  assert.equal(result.entryCount, 4);
  assert.deepEqual(details(result.markup), [
    '09:00–09:30 · 专注 30分 · 整理笔记',
    '09:01 · 开始专注 · 整理笔记',
    '09:29 · 专注结束 · 整理笔记',
    '09:30 · 完成 · 整理笔记'
  ]);
});

test('legacy and invalid identities never collapse based on equal timestamps or task IDs', () => {
  for (const identity of [undefined, null, '', '   ', 0, {}, []]) {
    const result = story({ day: {
      lanes: [{ taskId: 'task', segments: [{ sessionId: identity, causationId: identity, commandId: identity,
        startMs: at(9), endMs: at(9, 30), durationMs: 1800000 }] }],
      markers: [
        { sessionId: identity, causationId: identity, commandId: identity,
          kind: 'session.started', occurredAt: at(9), taskId: 'task' },
        { sessionId: identity, causationId: identity, commandId: identity,
          kind: 'session.completed', occurredAt: at(9, 30), taskId: 'task' }
      ]
    } });
    assert.equal(result.entryCount, 3);
    assert.match(result.markup, /开始专注/);
    assert.match(result.markup, /专注结束/);
  }
});

test('a broader shared cause cannot hide distinct explicit sessions', () => {
  const result = story({ day: {
    lanes: [{ taskId: 'task', segments: [{ sessionId: 'session-a', causationId: 'cause', commandId: 'command',
      startMs: at(9), endMs: at(9, 30), durationMs: 1800000 }] }],
    markers: [
      { sessionId: 'session-b', causationId: 'cause', commandId: 'command',
        kind: 'session.started', occurredAt: at(9), taskId: 'task' },
      { sessionId: 'session-a', causationId: 'different-cause', commandId: 'different-command',
        kind: 'session.completed', occurredAt: at(9, 30), taskId: 'task' }
    ]
  } });
  assert.equal(result.entryCount, 2);
  assert.match(result.markup, /开始专注/);
  assert.doesNotMatch(result.markup, /专注结束/);
});

test('identity names are not interchangeable and a missing identity is not a wildcard', () => {
  const result = story({ day: {
    lanes: [{ taskId: 'task', segments: [{ sessionId: 'shared-value',
      startMs: at(9), endMs: at(9, 30), durationMs: 1800000 }] }],
    markers: [
      { causationId: 'shared-value', kind: 'session.started', occurredAt: at(9), taskId: 'task' },
      { commandId: 'shared-value', kind: 'session.completed', occurredAt: at(9, 30), taskId: 'task' }
    ]
  } });
  assert.equal(result.entryCount, 3);
});

test('independent simultaneous events have a stable ID order without being removed', () => {
  const markers = [
    { eventId: 'z-event', sessionId: 'session-z', kind: 'session.started', occurredAt: at(9), taskId: 'z' },
    { eventId: 'a-event', sessionId: 'session-a', kind: 'session.started', occurredAt: at(9), taskId: 'a' }
  ];
  const state = { tasks: [{ id: 'z', title: '较后记录' }, { id: 'a', title: '较前记录' }] };
  const forward = story({ day: { lanes: [], markers }, state });
  const reverse = story({ day: { lanes: [], markers: [...markers].reverse() }, state });
  assert.equal(forward.entryCount, 2);
  assert.equal(forward.markup, reverse.markup);
  assert.deepEqual(details(forward.markup), ['09:00 · 开始专注 · 较前记录', '09:00 · 开始专注 · 较后记录']);
});

test('a long silence inside one part of the day is stated without judgement', () => {
  const { markup } = story({ day: { markers: [
    { occurredAt: at(9, 30), kind: 'task.completed', taskId: 'task' },
    { occurredAt: at(11, 45), kind: 'task.completed', taskId: 'task' }
  ], lanes: [] } });
  assert.match(markup, /2 小时 15 分没有记录/);
});

test('completions, routines and reminders get their own colour category', () => {
  const { markup } = story({ day: { markers: [
    { occurredAt: at(8), kind: 'routine.logged', routineId: 'medicine', routineKind: 'medication', status: 'done' },
    { occurredAt: at(8, 10), kind: 'routine.reminded', routineId: 'medicine', routineKind: 'medication' },
    { occurredAt: at(8, 20), kind: 'task.completed', taskId: 'task' }
  ] } });
  assert.match(markup, /tl-row-routine/);
  assert.match(markup, /tl-row-muted/);
  assert.match(markup, /tl-row-done"><button type="button" class="tl-event tl-task-complete"/);
});

test('a task that has left the lists is named honestly', () => {
  assert.match(story({ state: { tasks: [] } }).markup, /不在当前列表里的任务/);
});

test('the energy line is a compact full-day reference with a now mark on today only', () => {
  const energyCurve = { dayKey: DAY_KEY, sampleMinutes: 720, levels: [35, 60], nowMinute: 600 };
  const today = story({ energyCurve, state: { serverNow: at(10) } });
  assert.match(today.markup, /class="tl-spark-line"/);
  assert.match(today.markup, /tl-spark-now/);
  assert.equal(today.energyLabel, '估计能量 35–60（10–90，仅为估计） · 实线为当前时间之前的估计，虚线为之后的估计');
  assert.match(details(today.markup)[1], /当时估计能量约 35/);
  const yesterday = story({ energyCurve, state: { serverNow: new Date(2026, 8, 25, 10).getTime() } });
  assert.doesNotMatch(yesterday.markup, /tl-spark-now/);
});

test('days whose curve cannot be trusted draw no curve and say why', () => {
  const energyCurve = { dayKey: DAY_KEY, sampleMinutes: 720, levels: [35, 60] };
  const old = story({ energyCurve, state: { serverNow: new Date(2026, 9, 3).getTime() } });
  assert.doesNotMatch(old.markup, /tl-spark/);
  assert.match(old.energyLabel, /较早日期/);
  const dst = story({ energyCurve, day: { dayEnd: dayStart + 23 * 3600000 } });
  assert.doesNotMatch(dst.markup, /tl-spark/);
  assert.match(dst.energyLabel, /夏令时/);
  assert.match(story().energyLabel, /未启用或不可用/);
});

test('a day with no rows says the list is empty instead of drawing an empty axis', () => {
  const { markup, entryCount } = story({ day: { lanes: [], markers: [] } });
  assert.equal(entryCount, 0);
  assert.match(markup, /暂无活动记录/);
  assert.match(markup, /没有逐条记录，不代表没有行动/);
  assert.doesNotMatch(markup, /tl-list/);
});


test('forecast clips the unchanged sampled path at the exact current minute', () => {
  const levels = [25, 65, 45, 35];
  const energyCurve = { dayKey: DAY_KEY, sampleMinutes: 360, levels, nowMinute: 450 };
  const result = story({ energyCurve });
  const paths = [...result.markup.matchAll(/class="tl-spark-(?:line|forecast)" d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  assert.equal(paths[0], paths[1], 'the forecast uses identical sample geometry');
  assert.equal(paths[0], 'M0.0,52.0 L72.0,26.4 L144.0,39.2 L216.0,45.6');
  assert.match(result.markup, /clip-path:inset\(0 68.75% 0 0\) view-box/);
  assert.match(result.markup, /clip-path:inset\(0 0 0 31.25%\) view-box/);
  assert.match(result.markup, /tl-spark-now-label[^>]*>现在</);
  assert.deepEqual(levels, [25, 65, 45, 35]);
});

test('past days and unavailable current minutes never pretend to have a future boundary', () => {
  for (const nowMinute of [null, undefined, -1, 1441, NaN]) {
    const result = story({ energyCurve: { dayKey: DAY_KEY, levels: [35, 60], nowMinute } });
    assert.doesNotMatch(result.markup, /tl-spark-forecast|tl-spark-now/);
    assert.match(result.markup, /tl-spark-line/);
  }
  const yesterday = story({ energyCurve: { dayKey: DAY_KEY, levels: [35, 60], nowMinute: 600 },
    state: { serverNow: new Date(2026, 8, 25, 10).getTime() } });
  assert.doesNotMatch(yesterday.markup, /tl-spark-forecast|tl-spark-now/);
  for (const nowMinute of [0, 1440]) {
    const result = story({ energyCurve: { dayKey: DAY_KEY, levels: [35, 60], nowMinute } });
    assert.match(result.markup, /tl-spark-forecast/);
    assert.match(result.markup, /tl-spark-now-label/);
  }
});
