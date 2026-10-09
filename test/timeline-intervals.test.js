'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveIntervals, DEFAULT_BUCKET_MS } = require('../src/capabilities/progress/domain/timeline-intervals');

const MINUTE = 60 * 1000;

function event(kind, occurredAt, overrides = {}) {
  return {
    id: `${kind}:${occurredAt}`,
    kind,
    occurred_at: occurredAt,
    day_key: '2026-01-15',
    payload: {},
    ...overrides
  };
}

function withTimeZone(timeZone, run) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('deriveIntervals uses 30-minute half-open buckets at exact boundaries', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const segment = event('session.segment', dayStart, {
      duration_ms: 30 * MINUTE,
      session_id: 'session-1',
      payload: { sessionKind: 'focus' }
    });
    const boundaryPoint = event('session.paused', dayStart + 30 * MINUTE);

    const intervals = deriveIntervals([boundaryPoint, segment], { dayKey: '2026-01-15' });
    assert.equal(DEFAULT_BUCKET_MS, 30 * MINUTE);
    assert.deepEqual(intervals.slice(0, 2).map(interval => ({
      startMs: interval.startMs,
      endMs: interval.endMs,
      kinds: interval.events.map(item => item.kind),
      coverageMs: interval.coverageMs,
      gap: interval.gap
    })), [
      {
        startMs: dayStart,
        endMs: dayStart + 30 * MINUTE,
        kinds: ['session.segment'],
        coverageMs: 30 * MINUTE,
        gap: false
      },
      {
        startMs: dayStart + 30 * MINUTE,
        endMs: dayStart + 60 * MINUTE,
        kinds: ['session.paused'],
        coverageMs: 0,
        gap: false
      }
    ]);
  });
});

test('deriveIntervals clips one segment across every covered bucket with exact coverage', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const segment = event('session.segment', dayStart + 10 * MINUTE, {
      duration_ms: 70 * MINUTE,
      payload: { sessionKind: 'focus' }
    });

    const intervals = deriveIntervals([segment], { dayKey: '2026-01-15' });
    assert.deepEqual(intervals.slice(0, 3).map(interval => interval.coverageMs), [
      20 * MINUTE,
      30 * MINUTE,
      20 * MINUTE
    ]);
    assert.deepEqual(intervals.slice(0, 3).map(interval => interval.events), [
      [segment],
      [segment],
      [segment]
    ]);
  });
});

test('deriveIntervals emits the bucket containing a point-only event', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const point = event('task.completed', dayStart + 44 * MINUTE);

    const intervals = deriveIntervals([point], { dayKey: '2026-01-15' });
    const active = intervals.find(interval => !interval.gap);
    assert.deepEqual(active, {
      dayKey: '2026-01-15',
      startMs: dayStart + 30 * MINUTE,
      endMs: dayStart + 60 * MINUTE,
      events: [point],
      coverageMs: 0,
      gap: false
    });
  });
});

test('deriveIntervals merges each adjacent run of empty buckets into one gap', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const intervals = deriveIntervals([
      event('task.created', dayStart + 65 * MINUTE),
      event('task.completed', dayStart + 185 * MINUTE)
    ], { dayKey: '2026-01-15' });

    assert.deepEqual(intervals.map(interval => [
      (interval.startMs - dayStart) / MINUTE,
      (interval.endMs - dayStart) / MINUTE,
      interval.gap
    ]), [
      [0, 60, true],
      [60, 90, false],
      [90, 180, true],
      [180, 210, false],
      [210, 1440, true]
    ]);
  });
});

test('deriveIntervals does not mutate the input array or event objects', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const events = [
      event('session.paused', dayStart + 40 * MINUTE, { payload: { elapsedMs: 12 } }),
      event('session.segment', dayStart + 5 * MINUTE, {
        duration_ms: 50 * MINUTE,
        payload: { sessionKind: 'focus' }
      })
    ];
    const snapshot = structuredClone(events);

    deriveIntervals(events, { dayKey: '2026-01-15' });

    assert.deepEqual(events, snapshot);
    assert.equal(events[0].payload.elapsedMs, 12);
  });
});

test('deriveIntervals uses real 23-hour and 25-hour local DST day boundaries', () => {
  withTimeZone('America/Los_Angeles', () => {
    const spring = deriveIntervals([], { dayKey: '2024-03-10' });
    assert.equal(spring.length, 1);
    assert.equal(spring[0].endMs - spring[0].startMs, 23 * 60 * MINUTE);
    assert.equal(spring[0].startMs, Date.parse('2024-03-10T00:00:00-08:00'));
    assert.equal(spring[0].endMs, Date.parse('2024-03-11T00:00:00-07:00'));

    const fall = deriveIntervals([], { dayKey: '2024-11-03' });
    assert.equal(fall.length, 1);
    assert.equal(fall[0].endMs - fall[0].startMs, 25 * 60 * MINUTE);
    assert.equal(fall[0].startMs, Date.parse('2024-11-03T00:00:00-07:00'));
    assert.equal(fall[0].endMs, Date.parse('2024-11-04T00:00:00-08:00'));
  });
});

test('deriveIntervals accepts camelCase domain facts and deterministically sorts events', () => {
  withTimeZone('UTC', () => {
    const dayStart = Date.parse('2026-01-15T00:00:00Z');
    const laterKind = { id: 'b', kind: 'task.completed', occurredAt: dayStart + MINUTE, payload: {} };
    const earlierKind = { id: 'a', kind: 'capture.impulse-added', occurredAt: dayStart + MINUTE, payload: {} };
    const segment = {
      id: 'segment', kind: 'session.segment', occurredAt: dayStart,
      durationMs: 2 * MINUTE, sessionKind: 'focus'
    };

    const active = deriveIntervals([laterKind, segment, earlierKind], {
      dayKey: '2026-01-15',
      bucketMs: 10 * MINUTE
    })[0];

    assert.deepEqual(active.events.map(item => item.id), ['segment', 'a', 'b']);
    assert.equal(active.coverageMs, 2 * MINUTE);
  });
});
