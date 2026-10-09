'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { openSqliteConfigAuthority } = require('../src/platform/persistence/sqlite/config-authority-database');
const { encodePayload } = require('../src/platform/persistence/sqlite/config-authority-schema');
const NOW = Date.parse('2026-10-07T09:00:00Z');
const names = ['config.sqlite', 'config.sqlite.identity.sqlite'].flatMap(name => ['', '-wal', '-shm'].map(suffix => name + suffix));
const capture = directory => Object.fromEntries(fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name))]));
function inspect(captured, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'config-admission-facts-'));
  try {
    for (const [name, bytes] of Object.entries(captured)) fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
    return callback(directory);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function facts(captured) {
  return inspect(captured, directory => {
    const result = {};
    for (const [name, tables] of [['config.sqlite', ['config_snapshot', 'config_evidence']], ['config.sqlite.identity.sqlite', ['config_identity']]]) {
      if (!Object.hasOwn(captured, name)) { result[name] = null; continue; }
      let db;
      try {
        db = new DatabaseSync(path.join(directory, name), { readOnly: true });
        result[name] = { version: db.prepare('PRAGMA user_version').get(), app: db.prepare('PRAGMA application_id').get(),
          rows: tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()) };
      } catch (error) { result[name] = { error: error.message }; }
      finally { db?.close(); }
    }
    return result;
  });
}
function seed(directory, kind = 'valid19', mode = 'closed-clean') {
  const repo = createSqliteStateAdapter({ userDataPath: directory, now: () => NOW });
  repo.update(state => { state.settings.autoCheckUpdates = false; }, { now: NOW }); repo.close();
  const db = new DatabaseSync(path.join(directory, 'config.sqlite'));
  const identity = new DatabaseSync(path.join(directory, 'config.sqlite.identity.sqlite'));
  const state = JSON.parse(db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
  if (kind === 'old17') state.schemaVersion = 17;
  if (kind === 'future20') state.schemaVersion = 20;
  if (kind === 'malformed19') delete state.pet.foodTickets;
  const value = encodePayload(state);
  db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?').run(value.version, value.hash, value.json, value.mirrorHash);
  identity.prepare('UPDATE config_identity SET source_length=source_length').run();
  if (kind === 'wrong-application') db.exec('PRAGMA application_id=1');
  if (kind === 'wrong-identity') identity.prepare("UPDATE config_identity SET authority_id='wrong-synthetic-authority'").run();
  if (kind === 'invalid-evidence') db.prepare("UPDATE config_evidence SET source_hash=?").run('1'.repeat(64));
  if (mode === 'closed-clean') { db.close(); identity.close(); return []; }
  if (mode === 'live-warmed') { db.prepare('SELECT * FROM config_snapshot').get(); identity.prepare('SELECT * FROM config_identity').get(); }
  return [db, identity];
}
function tracedFactory(events, onEvent = () => {}) {
  return options => openSqliteConfigAuthority(options, {
    selectDriver: () => ({ open(filePath, settings = {}) {
      const context = { filePath, readOnly: settings.readOnly === true };
      const event = { kind: 'open', ...context }; events.push(event); onEvent(event);
      return { db: new DatabaseSync(filePath, settings), context };
    } }),
    makeHandle: ({ db, context }) => ({
      exec(sql) { const event = { kind: 'exec', sql, ...context }; events.push(event); onEvent(event); return db.exec(sql); },
      run(sql, params = []) { const event = { kind: 'run', sql, ...context }; events.push(event); onEvent(event); return db.prepare(sql).run(...params); },
      get: (sql, params = []) => db.prepare(sql).get(...params), all: (sql, params = []) => db.prepare(sql).all(...params),
      userVersion: () => db.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => db.exec(`PRAGMA user_version=${version}`), close: () => db.close()
    })
  });
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'config-admission-test-'));
  const retained = [];
  t.after(() => { for (const handle of retained) handle.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const open = options => createSqliteStateAdapter({ userDataPath: directory, now: () => NOW, ...options });
  return { directory, open, retain: handles => retained.push(...handles), capture: () => capture(directory),
    database: path.join(directory, names[0]), identity: path.join(directory, names[3]) };
}
module.exports = { NOW, names, capture, inspect, facts, seed, tracedFactory, fixture };
