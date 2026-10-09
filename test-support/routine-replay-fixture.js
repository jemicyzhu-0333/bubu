'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { createUnitOfWork, createRoutineTimelineEffects } = require('../src/application');
const { logRoutineOccurrence, dayPlan, routineReminder } = require('../src/capabilities/routines');
const { recordTimeline } = require('../src/capabilities/progress');
const { focusSession } = require('../src/capabilities/execution');
const { localDayKey } = require('../src/core/calendar');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { openDatabase } = require('../src/platform/persistence/sqlite/sqlite-database');
const { normalizePersistedState, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { createNudgeHost } = require('../src/platform/electron/nudge-host');
const { registerNudgeActions } = require('../src/bootstrap/nudge-actions');

const drain = () => new Promise(resolve => setImmediate(resolve));

// This fixture exercises the real receipt → command → SQLite → fact publication
// composition. Only OS surfaces, foreground lookup and time are synthetic.
function createRoutineReplayFixture(t, {
  at = new Date(2026, 9, 7, 8, 5).getTime(), times = ['08:00'], maxLevel = 1
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-replay-'));
  const configPath = path.join(dir, 'config.sqlite');
  let now = at, failCommit = false, rejectCommand = false, failPublish = false;
  let host, sampler;
  const repository = createSqliteStateAdapter({
    userDataPath: dir, schemaVersion: PERSISTED_SCHEMA_VERSION, normalize: normalizePersistedState, now: () => now,
    authorityFactory: options => openSqliteConfigAuthority(options, {
      selectDriver: () => ({ open: (filePath, settings = {}) => ({ db: new DatabaseSync(filePath, settings), filePath }) }),
      makeHandle: ({ db, filePath }) => ({
        exec(sql) {
          if (failCommit && filePath === configPath && sql === 'COMMIT') {
            failCommit = false;
            throw new Error('synthetic pre-COMMIT failure');
          }
          return db.exec(sql);
        },
        run: (sql, args = []) => db.prepare(sql).run(...args),
        get: (sql, args = []) => db.prepare(sql).get(...args),
        all: (sql, args = []) => db.prepare(sql).all(...args),
        userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        setUserVersion: value => db.exec(`PRAGMA user_version=${value}`), close: () => db.close()
      })
    })
  });
  const facts = openDatabase({ filePath: path.join(dir, 'facts.sqlite'), driver: 'node:sqlite' });
  t.after(() => { host?.dispose(); repository.close(); facts.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const initial = repository.snapshot();
  initial.routines = [{ id: 'routine', title: 'Synthetic original title', kind: 'movement', effect: null, active: true,
    createdAt: new Date(2026, 9, 1).getTime(), updatedAt: new Date(2026, 9, 1).getTime(), maxLevel,
    schedule: { frequency: 'daily', timesOfDay: times, weekdays: [], windowMinutes: 60 } }];
  initial.settings.routineRemindersEnabled = true;
  repository.commit(initial, { now });
  const publications = [], errors = [], writes = [], notifications = [], windows = [], timers = new Map();
  let timerId = 0;
  const setTimer = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, due: now + delay });
    return id;
  };
  const clearTimer = id => timers.delete(id);

  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; this.closed = false; notifications.push(this); }
    show() { this.requested = true; }
    close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  }
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false; this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.send = (channel, payload) => this.messages.push({ channel, payload });
      windows.push(this);
    }
    setIgnoreMouseEvents() {}
    setVisibleOnAllWorkspaces() {}
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadFile() {}
    getBounds() { return this.options; }
    setPosition() {}
    showInactive() { this.visible = true; }
    show() { this.visible = true; }
    focus() {}
    close() { this.destroyed = true; this.visible = false; }
  }
  const effects = createRoutineTimelineEffects({
    timelineRecorder: recordTimeline.createTimelineRecorder({ timeline: facts.timeline }),
    publish: dirty => {
      publications.push({ dirty, rows: facts.timeline.readDay(localDayKey(now)) });
      host.reconcileRoutineReminders();
      if (failPublish) throw new Error('synthetic postcommit publication failure');
    },
    reportEffectError: error => errors.push(error.message)
  });
  const uow = createUnitOfWork({ repository });
  const command = logRoutineOccurrence.createLogRoutineOccurrenceCommand({
    unitOfWork: { run(options) { writes.push(options.writes); return uow.run(options); } },
    clock: { now: () => now, dayKey: localDayKey }, publish: effects.publishCommitted,
    reportEffectError: error => errors.push(error.message)
  });
  host = createNudgeHost({
    Notification, BrowserWindow, nativeTheme: { shouldUseReducedMotion: false }, systemPreferences: {},
    screenHost: { primaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1024, height: 768 } }) },
    shortcutHost: { claim: () => () => {} },
    preloadPath: '/fixture/preload-nudge.js', cornerPagePath: '/fixture/corner.html', fullscreenPagePath: '/fixture/fullscreen.html',
    platform: 'darwin', exec: (_command, _options, callback) => { callback(null, '"LSDisplayName"="Synthetic Editor"'); return { kill() {} }; },
    execFile: require('node:child_process').execFile,
    setTimer, clearTimer, resolveRoutineRequest: identity => sampler.resolveRequest(identity), random: () => 0,
    onDeliveryError: error => errors.push(error.message)
  });
  sampler = routineReminder.createRoutineReminder({
    now: () => now, dayKey: localDayKey,
    getRoutines: () => repository.get('routines'), getRoutineLog: () => repository.get('routineLog'),
    getSettings: () => repository.get('settings'), remind: request => host.startNudgeSequence(request),
    recordNotified: input => command.recordNotified(input), recordMissed: input => effects.recordMissed(input)
  });
  registerNudgeActions({
    nudge: host, resolveRoutineRequest: sampler.resolveRequest,
    logRoutineOccurrenceCommand: { log: input => rejectCommand ? { ok: false, reason: 'synthetic-refusal' } : command.log(input) },
    recordTaskAvoidance: () => { throw new Error('routine reached task avoidance'); },
    readFocusSession: () => focusSession.createIdleSession(now), readNowTaskId: () => null,
    getSettings: () => repository.get('settings'), acceptHealthyShutdown: () => ({ ok: true }),
    stopFocusSession: () => ({ ok: true }), startRestSession: () => ({ ok: true }), startFocusSession: () => ({ ok: true })
  });
  const occurrence = dayPlan.dueOccurrences({ ...repository.snapshot(), now, dayKey: localDayKey(now) })[0];
  const identity = { routineId: occurrence.routineId, occurrenceId: occurrence.occurrenceId };

  async function advanceTo(target) {
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].due; next[1].callback(); await drain();
    }
    now = target;
    await drain();
  }
  async function deliver() {
    const sample = sampler.sample();
    await drain();
    notifications.at(-1).emit('show');
    return sample;
  }
  return {
    host, sampler, command, repository, timeline: facts.timeline, publications, errors, writes,
    notifications, windows, timers, identity, advanceTo, deliver, drain, now: () => now,
    setNow: value => { now = value; }, failCommit: () => { failCommit = true; },
    rejectCommand: value => { rejectCommand = value; }, failPublish: () => { failPublish = true; },
    entries: () => repository.get('routineLog').days.flatMap(day => day.entries),
    update(change, { reconcile = true } = {}) {
      const state = repository.snapshot(); change(state); repository.commit(state, { now });
      if (reconcile) host.reconcileRoutineReminders();
    }
  };
}

module.exports = { createRoutineReplayFixture };
