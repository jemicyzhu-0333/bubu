'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '../..');
const OWNER = 'synthetic-independent-migration-owner';
// Frozen historical SQL, deliberately not read from the implementation under review.
const OLD_SQL = Object.freeze([
  `CREATE TABLE collaboration_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), owner_id TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE conversations (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES collaboration_identity(owner_id),
    revision INTEGER NOT NULL CHECK(revision > 0), created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, expires_at INTEGER, snapshot TEXT NOT NULL
  )`,
  'CREATE INDEX conversations_owner_updated ON conversations(owner_id, updated_at DESC, id)',
  'CREATE INDEX conversations_retention ON conversations(owner_id, expires_at)'
]);
const canonical = sql => sql.replace(/\s+/g, ' ').trim();
function snapshot() {
  return { version: 1, id: 'synthetic-history', ownerId: OWNER, revision: 7,
    purpose: 'task', mode: 'talk', relatedEntity: null, createdAt: 1000, updatedAt: 2000,
    status: 'paused', retention: { mode: 'saved', days: 30, pinned: false }, messages: [], summaries: [],
    inputDraft: 'Synthetic exact bytes: e\u0301 / é / 🐇 / \\n / \\u0000', selectedProposalId: null,
    scrollTop: 0, segment: { index: 0, turns: 0, bytes: 0 }, softNoticeShown: false };
}
function capture(filePath) {
  return ['', '-wal', '-shm'].filter(suffix => fs.existsSync(filePath + suffix))
    .map(suffix => ({ suffix, bytes: fs.readFileSync(filePath + suffix) }));
}
function fixture(t, version = 3, setup = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-storage-independent-'));
  const filePath = path.join(directory, 'collaboration.sqlite');
  const keeper = new DatabaseSync(filePath);
  keeper.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0; BEGIN IMMEDIATE');
  const record = snapshot();
  if (version > 0) {
    for (const sql of OLD_SQL) keeper.exec(sql);
    keeper.prepare('INSERT INTO collaboration_identity VALUES(1,?)').run(OWNER);
    keeper.prepare('INSERT INTO conversations VALUES(?,?,?,?,?,?,?)')
      .run(record.id, OWNER, record.revision, record.createdAt, record.updatedAt,
        record.updatedAt + 30 * 86400000, JSON.stringify(record));
    if (version >= 4) {
      keeper.exec(`CREATE TABLE collaboration_durability (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    verification_count INTEGER NOT NULL CHECK(verification_count >= 0)
  )`);
      keeper.exec('INSERT INTO collaboration_durability VALUES(1,0)');
    }
  }
  keeper.exec(`PRAGMA user_version=${version}; COMMIT`);
  if (setup) setup(keeper);
  const original = capture(filePath);
  t.after(() => { try { keeper.close(); } catch (_) {} fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, filePath, keeper, record, original,
    rows: () => keeper.prepare('SELECT * FROM conversations ORDER BY id').all(),
    identity: () => keeper.prepare('SELECT * FROM collaboration_identity').all(),
    version: () => keeper.prepare('PRAGMA user_version').get().user_version,
    count: () => keeper.prepare('SELECT verification_count FROM collaboration_durability').get().verification_count };
}
// Each event carries the real connection and SQL operation. Failure injection changes only
// this synthetic driver's behavior; no monkeypatching of repository source or shared modules.
function ports(fault = () => {}) {
  const observed = { events: [], live: 0, proofCommits: 0, migrationCommits: 0, backupCommits: 0, businessCommits: 0 };
  const notify = event => { observed.events.push({ ...event, db: undefined }); return fault(event, observed); };
  const driver = { name: 'independent-node-sqlite', open(filePath, options = {}) {
    const readOnly = options.readOnly === true;
    notify({ phase: 'open', filePath, readOnly });
    const db = new DatabaseSync(filePath, options); observed.live++;
    return { db, filePath, readOnly };
  } };
  const makeHandle = ({ db, filePath, readOnly }) => {
    let stage = filePath.includes('.backup') ? 'backup' : null;
    let closed = false;
    const operate = (kind, sql, params, action) => {
      if (!readOnly && /CREATE TABLE collaboration_durability|INSERT INTO collaboration_durability/.test(sql)) stage = 'migration';
      if (!readOnly && /UPDATE collaboration_durability/.test(sql)) stage = 'proof';
      if (!readOnly && /INSERT INTO conversations/.test(sql)) stage = 'business';
      const event = { filePath, readOnly, stage, kind, sql, params, db };
      const override = notify({ ...event, phase: 'before' });
      const result = override === undefined ? action() : override;
      if (sql === 'COMMIT' && stage) observed[stage + 'Commits']++;
      notify({ ...event, phase: 'after' });
      if (sql === 'COMMIT' || sql === 'ROLLBACK') stage = filePath.includes('.backup') ? 'backup' : null;
      return result;
    };
    return {
      exec: sql => operate('exec', sql, null, () => db.exec(sql)),
      run: (sql, params = []) => operate('run', sql, params, () => db.prepare(sql).run(...params)),
      get: (sql, params = []) => operate('get', sql, params, () => db.prepare(sql).get(...params)),
      all: (sql, params = []) => operate('all', sql, params, () => db.prepare(sql).all(...params)),
      userVersion: () => operate('get', 'PRAGMA user_version', [], () => db.prepare('PRAGMA user_version').get().user_version),
      setUserVersion: version => operate('exec', `PRAGMA user_version=${version}`, null, () => db.exec(`PRAGMA user_version=${version}`)),
      close() { if (!closed) { db.close(); closed = true; observed.live--; } }
    };
  };
  return { driver, makeHandle, selectDriver: () => driver, observed };
}
function open(filePath, p = ports(), extra = {}) {
  const { openAuthoritativeCollaborationDatabase } = require(path.join(ROOT, 'src/platform/persistence/sqlite/collaboration-database'));
  return openAuthoritativeCollaborationDatabase({ filePath, ownerId: OWNER, ...extra }, p);
}
module.exports = { ROOT, OWNER, OLD_SQL, canonical, snapshot, capture, fixture, ports, open };
