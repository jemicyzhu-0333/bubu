'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runMigrations, LATEST_USER_VERSION } = require('./migrations');
const { captureFactDatabase, verifyFactBackup, verifyFactSchema } = require('./fact-database-guard');
const { markerPath, readFactIdentity, initializeFactIdentity, readyFactIdentity } = require('./fact-identity-guard');
const { createSqlTimelineRepository } = require('./timeline-repository');
const { createSqlMemoryRepository } = require('./memory-repository');
const { createSqlInboxArchiveRepository, UNAVAILABLE_INBOX_ARCHIVE } = require('./inbox-archive-repository');
const { openJsonlStore } = require('./jsonl-store');
const { buildRecentActivityDigest, DIGEST_FIELDS } = require('./memory-rules');
const { memoryAuthorityState, openVersionedMemoryAuthority } = require('./versioned-memory-repository');

// The one and only place in the repository that requires a SQLite driver
// (ARCHITECTURE「事实流与长期记忆」, guarded by scripts/check-boundaries.js). Everything else sees the
// repository interface, so switching drivers — or falling all the way to the
// pure-Node JSONL tier — is a change confined to this file.
//
// Tier order, chosen at runtime with no user-facing switch (compatibility is
// ours to absorb, never the user's to configure):
//   1. node:sqlite         — verified available on Electron 44 / Node 24 (arm64).
//                            Zero new dependency, zero native rebuild.
//   2. better-sqlite3      — only if already installed AND it dlopens here.
//   3. JSONL append files — available only without an existing SQL authority.
// Derived ordinary facts may degrade; confirmed AI events remain in canonical
// outbox until a durable SQL append and exact-content verification succeed.

function requireNodeSqlite() {
  try {
    const sqlite = require('node:sqlite');
    if (sqlite && typeof sqlite.DatabaseSync === 'function') {
      return { name: 'node:sqlite', open: (filePath, options = {}) => new sqlite.DatabaseSync(filePath, options) };
    }
  } catch (_) { /* not present on this runtime */ }
  return null;
}

function requireBetterSqlite3() {
  try {
    // A successful require already dlopens the native binding, so reaching this
    // line means the addon loaded for this arch. "Not installed" is caught here
    // and never surfaces to the user as an error.
    const Database = require('better-sqlite3');
    if (typeof Database === 'function') {
      return { name: 'better-sqlite3', open: (filePath, options = {}) => new Database(filePath, { readonly: options.readOnly === true }) };
    }
  } catch (_) { /* not installed or failed to dlopen */ }
  return null;
}

// One driver-neutral surface over node:sqlite and better-sqlite3. Both expose
// prepare().run/get/all and exec/close with the same shapes, so the migrations
// and repositories are written once.
function makeHandle(rawDb) {
  const cache = new Map();
  function stmt(sql) {
    let prepared = cache.get(sql);
    if (!prepared) { prepared = rawDb.prepare(sql); cache.set(sql, prepared); }
    return prepared;
  }
  return {
    exec: sql => rawDb.exec(sql),
    run: (sql, params = []) => stmt(sql).run(...params),
    get: (sql, params = []) => stmt(sql).get(...params),
    all: (sql, params = []) => stmt(sql).all(...params),
    userVersion: () => Number((stmt('PRAGMA user_version').get() || {}).user_version) || 0,
    setUserVersion: version => rawDb.exec(`PRAGMA user_version = ${Number(version)}`),
    close: () => { try { rawDb.close(); } catch (_) {} }
  };
}

function applyPragmas(handle) {
  // WAL allows ordinary reads during committed single-row appends. The opener
  // upgrades synchronous to FULL before confirmed event delivery. FK on;
  // busy_timeout covers a brief WAL checkpoint even in a single process.
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA synchronous = NORMAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 2000');
}

function openSqlTier(driver, filePath, logger, now, io = fs) {
  if (filePath !== ':memory:') io.mkdirSync(path.dirname(filePath), { recursive: true });
  const originals = captureFactDatabase(filePath, io);
  const existing = originals.some(item => item.suffix === '');
  if (originals.length && !existing) throw new Error('history-database-missing');
  const identityPorts = { filePath, driver, makeHandle, io };
  let identity = readFactIdentity(identityPorts);
  if (identity?.phase === 'READY' && !existing) throw new Error('history-database-missing');
  if (!existing && filePath !== ':memory:' && io.existsSync(jsonlDirFor(filePath))) throw new Error('history-jsonl-import-required');
  if (!existing && !identity) identity = initializeFactIdentity(identityPorts);
  let handle;
  try {
    // Read-only preflight before WAL pragmas, schema edits or checkpointing.
    handle = makeHandle(driver.open(filePath, existing ? { readOnly: true } : {}));
    const current = verifyFactSchema(handle);
    if (existing && current === 0 && identity?.phase !== 'INITIALIZING') throw new Error('history-schema-uninitialized');
    const applicationId = Number(handle.get('PRAGMA application_id')?.application_id || 0);
    if (identity && (applicationId !== 0 && applicationId !== identity.applicationId
      || identity.phase === 'READY' && applicationId !== identity.applicationId)) throw new Error('history-identity-mismatch');
    if (!identity && applicationId !== 0) throw new Error('history-identity-missing');
    if (existing) {
      if (current > 0 && current < LATEST_USER_VERSION) {
        try { verifyFactBackup({ filePath, sourceVersion: current, originals, io }, { driver, makeHandle }); }
        catch (_) { throw new Error('history-backup-failed'); }
      }
      if (!identity) identity = initializeFactIdentity(identityPorts);
      handle.close();
      handle = makeHandle(driver.open(filePath));
    }
    applyPragmas(handle);
    // A confirmed append is acknowledged after durable SQL commit. FULL is
    // required for that guarantee; legacy NORMAL could lose an acked event.
    handle.exec('PRAGMA synchronous = FULL');
    if (Number(handle.get('PRAGMA synchronous')?.synchronous) !== 2
        || (filePath !== ':memory:' && handle.get('PRAGMA journal_mode')?.journal_mode !== 'wal')) {
      throw new Error('history-durability-unavailable');
    }
    runMigrations(handle);
    verifyFactSchema(handle);
    if (identity && applicationId === 0) {
      handle.exec('BEGIN IMMEDIATE');
      try { handle.exec(`PRAGMA application_id=${identity.applicationId}`); handle.exec('COMMIT'); }
      catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
    }
    if (identity && Number(handle.get('PRAGMA application_id')?.application_id) !== identity.applicationId) throw new Error('history-identity-mismatch');
    readyFactIdentity({ ...identityPorts, identity });
  } catch (error) {
    if (handle) handle.close();
    throw error;
  }
  const degradedReason = null;

  const timeline = createSqlTimelineRepository({ handle, logger, now });
  const memories = createSqlMemoryRepository({ handle, timeline, now, logger });
  return Object.freeze({
    tier: driver.name,
    healthy: true,
    degradedReason,
    userVersion: LATEST_USER_VERSION,
    timeline,
    memories,
    memoryAuthorityState: () => memoryAuthorityState(handle),
    openMemoryAuthority: options => openVersionedMemoryAuthority({ ...options, handle, now: options?.now || now,
      readFresh: action => {
        if (filePath === ':memory:') return action(handle);
        const reader = makeHandle(driver.open(filePath, { readOnly: true }));
        try { verifyFactSchema(reader); return action(reader); } finally { reader.close(); }
      } }),
    inboxArchive: createSqlInboxArchiveRepository({ handle, logger }),
    close: () => handle.close()
  });
}

function jsonlDirFor(filePath) {
  if (/\.sqlite$/i.test(filePath)) return filePath.replace(/\.sqlite$/i, '.jsonl.d');
  return `${filePath}.jsonl.d`;
}

function openJsonlTier(filePath, logger, now) {
  const store = openJsonlStore({ dir: jsonlDirFor(filePath), now, logger });
  return Object.freeze({
    tier: 'jsonl',
    healthy: true,
    degradedReason: 'jsonl-fallback',
    userVersion: null,
    timeline: store.timeline,
    memories: store.memories,
    inboxArchive: UNAVAILABLE_INBOX_ARCHIVE,
    close: store.close
  });
}

// Refused/failed storage stays explicitly unavailable. Ordinary focus commands
// can continue, while canonical AI receipts and pending delivery stay intact.
// queryRange distinguishes this from a successfully read empty history.
function unavailableStore(logger, now, reason = 'unavailable') {
  const emptyDigest = at => ({
    ...buildRecentActivityDigest([], {}),
    disclosure: { fields: DIGEST_FIELDS }
  });
  try { logger({ scope: 'fact-store', event: 'unavailable' }); } catch (_) {}
  return Object.freeze({
    tier: 'none',
    healthy: false,
    degradedReason: reason,
    userVersion: null,
    timeline: Object.freeze({
      supportsConfirmedChanges: false,
      upsertRoutineLogged: () => ({ ok: false, inserted: false, reason: 'store-unavailable' }),
      appendConfirmedEvent: () => ({ ok: false, inserted: false, reason: 'store-unavailable' }),
      queryRange: () => ({ ok: false, availability: 'unavailable', reason, items: [] }),
      append: () => ({ ok: false, inserted: false, reason: 'store-unavailable' }),
      readRange: () => [],
      readDay: () => [],
      remove: () => ({ ok: false, removed: 0, reason: 'store-unavailable' }),
      prune: () => ({ ok: false, removed: 0 })
    }),
    memories: Object.freeze({
      upsert: () => ({ ok: false, reason: 'store-unavailable' }),
      list: () => [],
      forget: () => ({ ok: false, removed: 0 }),
      clear: () => ({ ok: false, removed: 0 }),
      selectMemories: () => ({ memories: [], disclosure: { memoryIds: [] } }),
      recordUsage: () => ({ ok: false, updated: 0 }),
      pruneExpired: () => ({ ok: false, removed: 0 }),
      recentActivityDigest: ({ now: at = now() } = {}) => emptyDigest(at)
    }),
    inboxArchive: UNAVAILABLE_INBOX_ARCHIVE,
    close: () => {}
  });
}

function resolveTierOrder(driver) {
  if (driver === 'node:sqlite' || driver === 'better-sqlite3' || driver === 'jsonl') return [driver];
  return ['node:sqlite', 'better-sqlite3', 'jsonl'];
}

/**
 * Open the fact store, auto-selecting the best available tier.
 *
 * @param {object}   options
 * @param {string}   options.filePath  DB path (userData/focuspix.sqlite in prod), or ':memory:'.
 * @param {string}   [options.driver]  'auto' (default) | 'node:sqlite' | 'better-sqlite3' | 'jsonl' — forcing is for tests.
 * @param {function} [options.logger]  receives structured trace records; the only place tier choice is visible.
 * @param {function} [options.now]     injected clock for deterministic tests.
 * @returns {{ tier, healthy, degradedReason, timeline, memories, inboxArchive, close }}
 */
function openDatabase({ filePath, driver = 'auto', logger = () => {}, now = () => Date.now(), io = fs } = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('openDatabase requires a filePath');
  // A logger that is not callable would throw on the first trace inside the tier
  // loop, be swallowed as "tier-failed", and drop every tier down to the no-op
  // store — a silent total loss of history from a caller-side slip. Tracing is
  // not worth a tier, so an unusable logger is discarded, not honoured.
  const trace = typeof logger === 'function' ? logger : () => {};
  const order = resolveTierOrder(driver);
  for (const tier of order) {
    try {
      if (tier === 'node:sqlite') {
        const acquired = requireNodeSqlite();
        if (!acquired) { trace({ scope: 'fact-store', event: 'tier-skip', tier, reason: 'unavailable' }); continue; }
        const store = openSqlTier(acquired, filePath, trace, now, io);
        trace({ scope: 'fact-store', event: 'tier-selected', tier: store.tier, degradedReason: store.degradedReason });
        return store;
      }
      if (tier === 'better-sqlite3') {
        const acquired = requireBetterSqlite3();
        if (!acquired) { trace({ scope: 'fact-store', event: 'tier-skip', tier, reason: 'not-installed' }); continue; }
        const store = openSqlTier(acquired, filePath, trace, now, io);
        trace({ scope: 'fact-store', event: 'tier-selected', tier: store.tier, degradedReason: store.degradedReason });
        return store;
      }
      if (filePath !== ':memory:' && (['', '-wal', '-shm'].some(suffix => io.existsSync(`${filePath}${suffix}`))
        || ['', '-wal', '-shm'].some(suffix => io.existsSync(markerPath(filePath) + suffix)))) {
        return unavailableStore(trace, now, 'history-sqlite-unavailable');
      }
      const store = openJsonlTier(filePath, trace, now);
      trace({ scope: 'fact-store', event: 'tier-selected', tier: store.tier, degradedReason: store.degradedReason });
      return store;
    } catch (error) {
      try { trace({ scope: 'fact-store', event: 'tier-failed', tier, reason: 'history-unavailable' }); } catch (_) {}
      // An opened/known SQLite authority never falls through to an empty tier.
      if (tier !== 'jsonl') return unavailableStore(trace, now,
        /^history-[a-z-]+$/.test(error?.message || '') ? error.message : 'history-unavailable');
    }
  }
  return unavailableStore(trace, now);
}

// Both authorities share the sole driver loader, never the disposable tiers.
function selectSqliteDriver(requested) {
  if (requested === 'jsonl' || (requested && !['auto', 'node:sqlite', 'better-sqlite3'].includes(requested))) return null;
  if (requested === 'node:sqlite') return requireNodeSqlite();
  if (requested === 'better-sqlite3') return requireBetterSqlite3();
  return requireNodeSqlite() || requireBetterSqlite3();
}
function openCollaborationDatabase(options = {}) {
  const { openAuthoritativeCollaborationDatabase } = require('./collaboration-database');
  return openAuthoritativeCollaborationDatabase(options, { selectDriver: selectSqliteDriver, makeHandle });
}
function openProfileIdentityDatabase(options = {}) {
  const { openSqliteProfileIdentity } = require('./profile-identity-database');
  return openSqliteProfileIdentity(options, { selectDriver: selectSqliteDriver, makeHandle });
}

function markProfileIdentityDatabaseReady(options = {}) {
  const { markSqliteProfileIdentityReady } = require('./profile-identity-database');
  return markSqliteProfileIdentityReady(options, { selectDriver: selectSqliteDriver, makeHandle });
}

function openForgettingLedger(options = {}) {
  const { openSqliteForgettingLedger } = require('./forgetting-ledger');
  return openSqliteForgettingLedger(options, { selectDriver: selectSqliteDriver, makeHandle });
}

function openConfigAuthority(options = {}) {
  const { openSqliteConfigAuthority } = require('./config-authority-database');
  return openSqliteConfigAuthority(options, { selectDriver: selectSqliteDriver, makeHandle });
}

function verifySqliteMigrationBackup(options = {}) {
  const { verifyBackupContainer } = require('./migration-backup-container');
  const driver = selectSqliteDriver(options.driver);
  if (!driver) throw new Error('migration-backup-sqlite-unavailable');
  return verifyBackupContainer(options, { driver, makeHandle });
}
function readSqliteMigrationBackup(options = {}) {
  const { readBackupContainer } = require('./migration-backup-container');
  const driver = selectSqliteDriver(options.driver);
  if (!driver) throw new Error('migration-backup-sqlite-unavailable');
  return readBackupContainer(options, { driver, makeHandle });
}

module.exports = { openDatabase, openCollaborationDatabase, openProfileIdentityDatabase, markProfileIdentityDatabaseReady, openForgettingLedger, openConfigAuthority, verifySqliteMigrationBackup, readSqliteMigrationBackup };
