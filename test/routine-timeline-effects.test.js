'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoutineTimelineEffects } = require('../src/application/effects/routine-timeline-effects');

test('a committed routine fact reaches the timeline before the selected-day refresh', () => {
  const events = [];
  const notifications = [];
  const effects = createRoutineTimelineEffects({
    timelineRecorder: {
      recordRoutineLogged: input => { events.push({ type: 'logged', ...input }); return { recorded: 1 }; },
      recordRoutineLogUndone: input => {
        events.splice(events.findIndex(event => event.occurrenceId === input.occurrenceId), 1);
        return { removed: 1 };
      },
      recordRoutineReminded: input => { events.push({ type: 'reminded', ...input }); return { recorded: 1 }; },
      recordRoutineMissed: input => { events.push({ type: 'missed', ...input }); return { recorded: 1 }; }
    },
    publish: dirty => notifications.push({ dirty, events: structuredClone(events) })
  });
  const occurrenceId = 'med:2026-09-24:08:00';
  effects.publishCommitted({
    type: 'routine-logged', revision: 7, routineId: 'med', occurrenceId, kind: 'medication',
    status: 'done', scheduled: true, at: 100
  });
  assert.deepEqual(notifications[0], {
    dirty: { routines: true, energy: true },
    events: [{ type: 'logged', revision: 7, routineId: 'med', occurrenceId, kind: 'medication',
      status: 'done', scheduled: true, loggedAt: 100 }]
  });

  effects.publishCommitted({ type: 'routine-log-undone', occurrenceId });
  assert.deepEqual(notifications[1], { dirty: { routines: true, energy: true }, events: [] });

  effects.publishCommitted({
    type: 'routine-reminded', routineId: 'med', occurrenceId,
    kind: 'medication', level: 1, at: 200
  });
  assert.deepEqual(notifications[2].events, [{
    type: 'reminded', routineId: 'med', occurrenceId, kind: 'medication', level: 1, remindedAt: 200
  }]);

  effects.recordMissed({ routineId: 'med', kind: 'medication', occurrenceId, missedAt: 300 });
  assert.deepEqual(notifications[3].dirty, { timeline: true });
  assert.equal(notifications[3].events.at(-1).type, 'missed');
});

test('a derived-history failure does not hide the committed routine change or crash the sampler', () => {
  const notifications = [];
  const errors = [];
  const recorder = {
    recordRoutineLogged: () => { throw new Error('fact store unavailable'); },
    recordRoutineLogUndone: () => ({ removed: 0 }),
    recordRoutineReminded: () => ({ recorded: 0 }),
    recordRoutineMissed: () => ({ recorded: 0 })
  };
  const effects = createRoutineTimelineEffects({
    timelineRecorder: recorder,
    publish: dirty => notifications.push(dirty),
    reportEffectError: error => errors.push(error.message)
  });
  assert.doesNotThrow(() => effects.publishCommitted({ type: 'routine-logged', at: 100 }));
  assert.deepEqual(notifications, [{ routines: true, energy: true }]);
  assert.deepEqual(errors, ['fact store unavailable']);
  effects.recordMissed({ missedAt: 200 });
  assert.equal(notifications.length, 1);
  recorder.recordRoutineMissed = () => { throw new Error('fact store unavailable'); };
  assert.doesNotThrow(() => effects.recordMissed({ missedAt: 300 }));
  assert.equal(notifications.length, 1);
  assert.deepEqual(errors, ['fact store unavailable', 'fact store unavailable']);
});
