'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { intervalMood, INTERVAL_MOODS } = require('../src/capabilities/progress/domain/interval-mood');

const BUCKET_MS = 30 * 60 * 1000;

function timelineEvent(kind, payload = {}, extra = {}) {
  return { id: `${kind}:${JSON.stringify(payload)}`, kind, payload, ...extra };
}

function interval(events = [], overrides = {}) {
  return {
    dayKey: '2026-01-15',
    startMs: 0,
    endMs: BUCKET_MS,
    events,
    coverageMs: 0,
    gap: events.length === 0,
    ...overrides
  };
}

const cases = [
  ['abandoned session', interval([timelineEvent('session.abandoned')]), 'react.relieved', 'abandoned'],
  ['completed task', interval([timelineEvent('task.completed')]), 'react.celebrate', 'completed'],
  ['stuck friction', interval([timelineEvent('friction.stuck-opened')]), 'react.encouraging', 'stuck'],
  ['repeated interruptions', interval([
    timelineEvent('session.segment', { sessionKind: 'focus' }),
    timelineEvent('session.paused'),
    timelineEvent('session.paused')
  ], { coverageMs: 10 * 60 * 1000 }), 'work.pause', 'repeated-interruptions'],
  ['deep focus', interval([
    timelineEvent('session.segment', { sessionKind: 'focus' })
  ], { coverageMs: 24 * 60 * 1000 }), 'work.deep-focus', 'deep-focus'],
  ['fragmented progress', interval([
    timelineEvent('session.segment', { sessionKind: 'focus' })
  ], { coverageMs: 5 * 60 * 1000 }), 'work.focus', 'fragmented-progress'],
  ['break session', interval([
    timelineEvent('session.segment', { sessionKind: 'break' })
  ], { coverageMs: BUCKET_MS }), 'work.rest', 'break'],
  ['low energy', interval([
    timelineEvent('friction.energy-checked-in', { state: 'low' })
  ]), 'life.drowsy', 'low-energy'],
  ['capture only', interval([
    timelineEvent('capture.impulse-added'),
    timelineEvent('capture.impulse-reviewed')
  ]), 'life.space', 'capture-only'],
  ['general activity', interval([timelineEvent('task.created')]), 'life.attentive', 'activity'],
  ['gap', interval(), 'life.idle', 'gap']
];

for (const [name, input, expressionId, reasonKey] of cases) {
  test(`intervalMood maps ${name}`, () => {
    assert.deepEqual(intervalMood(input), { expressionId, reasonKey });
  });
}

test('intervalMood gives completion priority over stuck signals', () => {
  assert.deepEqual(intervalMood(interval([
    timelineEvent('friction.strategy-shown'),
    timelineEvent('task.completed')
  ])), INTERVAL_MOODS.COMPLETED);
});

test('intervalMood gives abandonment priority over completion', () => {
  assert.deepEqual(intervalMood(interval([
    timelineEvent('task.completed'),
    timelineEvent('session.abandoned')
  ])), INTERVAL_MOODS.ABANDONED);
});

test('intervalMood classifies break segments before generic segment rules', () => {
  assert.deepEqual(intervalMood(interval([
    timelineEvent('session.segment', {}, { session_kind: 'break' }),
    timelineEvent('session.paused'),
    timelineEvent('session.paused')
  ], { coverageMs: BUCKET_MS })), INTERVAL_MOODS.BREAK);
});

test('every interval mood expression id exists in the canonical catalog', async () => {
  const { EXPRESSIONS } = await import('../src/content/expressions.mjs');
  const canonicalIds = new Set(EXPRESSIONS.map(expression => expression.id));
  assert.deepEqual(
    new Set(Object.values(INTERVAL_MOODS).map(mood => mood.expressionId)),
    new Set([
      'react.relieved',
      'react.celebrate',
      'react.encouraging',
      'work.pause',
      'work.deep-focus',
      'work.focus',
      'work.rest',
      'life.drowsy',
      'life.space',
      'life.attentive',
      'life.idle'
    ])
  );
  for (const mood of Object.values(INTERVAL_MOODS)) {
    assert.equal(canonicalIds.has(mood.expressionId), true, `${mood.expressionId} must be canonical`);
  }
});
