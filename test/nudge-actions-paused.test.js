'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerNudgeActions } = require('../src/bootstrap/nudge-actions');
const { focusSession } = require('../src/capabilities/execution');
const { STATUS } = focusSession;

const idle = { status: STATUS.IDLE || 'idle', sessionId: null, taskId: null };
const running = kind => ({ status: kind, sessionId: 's1', taskId: 't1' });
const paused = kind => ({ status: STATUS.PAUSED, pausedFrom: kind, sessionId: 's1', taskId: 't1' });

function fixture(initial) {
  let session = initial, handler;
  const calls = [];
  registerNudgeActions({
    nudge: { setActionHandler: h => { handler = h; } },
    resolveRoutineRequest: () => null, logRoutineOccurrenceCommand: { log: () => ({ ok: true }) },
    recordTaskAvoidance: input => calls.push(['avoid', input]),
    readFocusSession: () => session, readNowTaskId: () => null,
    getSettings: () => ({ pomodoroMinutes: 25 }), acceptHealthyShutdown: () => ({ ok: true }),
    stopFocusSession: reason => { calls.push(['stop', reason]); session = idle; return { ok: true }; },
    startRestSession: (taskId, o) => { calls.push(['break', taskId, o.userInitiated]); session = running(STATUS.BREAK); return { ok: true }; },
    startFocusSession: taskId => { calls.push(['focus', taskId]); session = running(STATUS.FOCUS); return { ok: true }; },
    resumeFocusSession: a => { calls.push(['resume', a.sessionId]); session = running(session.pausedFrom); return { ok: true }; }
  });
  return { calls, act: (actionId, type = 'rest', context = {}) => handler({ actionId, type, context }), get session() { return session; } };
}

test('accept-rest on a paused focus round settles it and starts a visible break (same as running)', () => {
  for (const kind of [STATUS.FOCUS, STATUS.QUICK_START]) {
    const f = fixture(paused(kind));
    assert.equal(f.act('accept-rest').ok, true);
    assert.deepEqual(f.calls, [['stop', 'accepted-rest'], ['break', 't1', true]]);
    assert.equal(f.session.status, STATUS.BREAK);
  }
});

test('accept-rest on a paused break resumes that break instead of a silent no-op', () => {
  const f = fixture(paused(STATUS.BREAK));
  assert.equal(f.act('accept-rest').ok, true);
  assert.deepEqual(f.calls, [['resume', 's1']]);
  assert.equal(f.session.status, STATUS.BREAK);
});

test('accept-rest running/idle/break behaviour unchanged', () => {
  let f = fixture(running(STATUS.FOCUS)); f.act('accept-rest');
  assert.deepEqual(f.calls, [['stop', 'accepted-rest'], ['break', 't1', true]]);
  f = fixture(idle); f.act('accept-rest'); assert.deepEqual(f.calls, [['break', null, true]]);
  f = fixture(running(STATUS.BREAK)); assert.equal(f.act('accept-rest').ok, true); assert.deepEqual(f.calls, []);
});

test('accept-focus while paused resumes focus, or leaves a paused break for focus', () => {
  let f = fixture(paused(STATUS.FOCUS));
  f.act('accept-focus', 'focus'); assert.deepEqual(f.calls, [['resume', 's1']]); assert.equal(f.session.status, STATUS.FOCUS);
  f = fixture(paused(STATUS.BREAK));
  f.act('accept-focus', 'focus', { taskId: 't1' });
  assert.deepEqual(f.calls, [['stop', 'accepted-focus'], ['focus', 't1']]);
  f = fixture(running(STATUS.FOCUS)); f.act('accept-focus', 'focus'); assert.deepEqual(f.calls, []);
});

