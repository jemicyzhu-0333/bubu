'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteStateAdapter } = require('../src/platform/persistence/sqlite-state-adapter');
const { encodePayload } = require('../src/platform/persistence/sqlite/config-authority-schema');
const { prepareConfigPreferencesUpgrade } = require('../src/platform/persistence/sqlite/config-preferences-upgrade');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');
const { focusSession } = require('../src/capabilities/execution');
const { appendFixture } = require('./ai-change-ledger-fixture');
const NOW = Date.parse('2026-10-09T09:00:00Z');
function ports(fault = () => {}) {
  return {
    driver: { open(filePath, options = {}) {
      fault({ type: 'open', filePath, readOnly: options.readOnly === true });
      return { raw: new DatabaseSync(filePath, options), filePath, readOnly: options.readOnly === true };
    } },
    makeHandle: ({ raw, filePath, readOnly }) => ({
      exec(sql) { fault({ type: 'before', filePath, readOnly, sql }); const result = raw.exec(sql); fault({ type: 'after', filePath, readOnly, sql }); return result; },
      run(sql, args = []) { fault({ type: 'before', filePath, readOnly, sql }); const result = raw.prepare(sql).run(...args); fault({ type: 'after', filePath, readOnly, sql }); return result; },
      get: (sql, args = []) => raw.prepare(sql).get(...args), all: (sql, args = []) => raw.prepare(sql).all(...args),
      userVersion: () => raw.prepare('PRAGMA user_version').get().user_version,
      setUserVersion: version => raw.exec(`PRAGMA user_version=${version}`), close: () => raw.close()
    })
  };
}
function tree(root) {
  const result = {};
  function walk(relative) {
    const target = path.join(root, relative), stat = fs.lstatSync(target, { bigint: true });
    // Match the backup container's portable relative-path representation.
    result[relative.split(path.sep).join('/')] = { mode: stat.mode, mtime: stat.mtimeNs,
      bytes: stat.isFile() ? fs.readFileSync(target) : stat.isSymbolicLink() ? fs.readlinkSync(target) : null };
    if (stat.isDirectory()) for (const name of fs.readdirSync(target).sort()) walk(path.join(relative, name));
  }
  walk(''); return result;
}
function fixture(t, { live = false } = {}) {
  // macOS may expose its temporary directory through /var -> /private/var.
  // Synthetic extraction destinations must use the actual directory, while the
  // production extraction path continues to reject every symlink ancestor.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-upgrade-test-')));
  const directory = path.join(root, 'bubu'); fs.mkdirSync(directory, { mode: 0o700 });
  const repo = createSqliteStateAdapter({ userDataPath: directory, now: () => NOW });
  const populated = normalizePersistedState({ ...repo.snapshot(), tasks: [{ id: 'synthetic-task', title: 'Keep 中文 task',
    description: 'Keep original text', steps: [{ id: 'synthetic-step', title: 'Keep step' }] }],
    impulses: [{ id: 'synthetic-inbox', text: 'Untranslated original capture', createdAt: NOW }] }, { now: NOW });
  populated.settings.autoCheckUpdates = false; populated.pet.satiation = 44.9;
  populated.focusSession = focusSession.startFocus(populated.focusSession, { taskId: 'synthetic-task', sessionId: 'synthetic-session', minutes: 25 }, { now: NOW }).session;
  populated.nowTaskId = 'synthetic-task';
  populated.aiCollaboration = appendFixture().ledger;
  repo.commit(populated, { now: NOW }); repo.close();
  const database = path.join(directory, 'config.sqlite'), identity = `${database}.identity.sqlite`;
  const db = new DatabaseSync(database), id = new DatabaseSync(identity);
  const state = JSON.parse(db.prepare('SELECT payload_json FROM config_snapshot').get().payload_json);
  state.schemaVersion = 18; delete state.settings.locale; delete state.settings.theme;
  const encoded = encodePayload(state);
  db.prepare('UPDATE config_snapshot SET payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=?').run(encoded.version, encoded.hash, encoded.json, encoded.mirrorHash);
  id.prepare('UPDATE config_identity SET source_length=source_length').run();
  const original = db.prepare('SELECT * FROM config_snapshot').get(), originalIdentity = id.prepare('SELECT * FROM config_identity').get();
  if (!live) { db.close(); id.close(); }
  fs.mkdirSync(path.join(directory, 'nested')); fs.mkdirSync(path.join(directory, 'nested', 'empty'));
  fs.writeFileSync(path.join(directory, 'credentials.enc'), Buffer.from('SYNTHETIC-OPAQUE-ENCRYPTED-BYTES'));
  fs.writeFileSync(path.join(directory, 'nested', 'SingletonLock'), Buffer.from('THIS IS USER CONTENT, NOT A TOP-LEVEL LOCK'));
  t.after(() => { if (live) { db.close(); id.close(); } fs.rmSync(root, { recursive: true, force: true }); });
  function prepare(options = {}, fault) { return prepareConfigPreferencesUpgrade({ userDataPath: directory, now: () => NOW, ...options }, ports(fault)); }
  return { root, directory, database, identity, state, original, originalIdentity, prepare,
    capture: () => tree(directory), liveDb: live ? db : null };
}
module.exports = { fixture, ports, NOW, tree };
