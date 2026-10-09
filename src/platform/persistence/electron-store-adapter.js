'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { createAuthoritativeConfigWriter } = require('./authoritative-config-writer');
const { createConfigAuthorityMirror } = require('./config-authority-mirror');
const { openConfigAuthority } = require('./sqlite/sqlite-database');
const { hashBytes, MAX_BYTES } = require('./sqlite/config-authority-schema');
const { prepareStoreMigration, detectCurrentSchemaMigration, prepareCurrentSchemaMigrationBackup } = require('../../core/store-migration');

const UNSUPPORTED = 'Current bubu data failed validation; refusing to rewrite it without a migration backup';
function createElectronStoreAdapter({ userDataPath, schemaVersion, normalize, now = () => Date.now(), io = fs,
  platform = process.platform, migration = {}, authorityFactory = openConfigAuthority,
  mirrorWriterFactory = createAuthoritativeConfigWriter, driver = 'auto', jsonMirror = true,
  currentOnly = false, assertCanonical = null } = {}) {
  if (typeof userDataPath !== 'string' || !userDataPath) throw new TypeError('userDataPath must be a non-empty string');
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new RangeError('schemaVersion must be a positive integer');
  if (typeof normalize !== 'function') throw new TypeError('normalize must be a function');
  if (typeof jsonMirror !== 'boolean') throw new TypeError('jsonMirror must be a boolean');
  if (currentOnly && typeof assertCanonical !== 'function') throw new TypeError('current-only admission requires canonical validation');
  const storePath = path.join(userDataPath, 'config.json');
  const migrationTools = { prepareStoreMigration, detectCurrentSchemaMigration, prepareCurrentSchemaMigrationBackup, ...migration };
  function normalized(value, context = {}) {
    const first = normalize(value, context), second = normalize(first, context);
    if (!isDeepStrictEqual(first, second)) throw new Error('canonical state normalization is not idempotent');
    if (first?.schemaVersion !== schemaVersion) throw new Error('config-payload-schema-invalid');
    if (currentOnly) assertCanonical(first);
    return first;
  }
  function prepareInitial() {
    if (!jsonMirror && io.existsSync(storePath)) throw new Error('legacy-json-profile-requires-explicit-import');
    if (io.existsSync(storePath) && io.statSync(storePath).size > MAX_BYTES) throw new Error('config-authority-capacity');
    const exists = io.existsSync(storePath), bytes = exists ? io.readFileSync(storePath) : Buffer.alloc(0);
    const source = migrationTools.prepareStoreMigration(storePath, schemaVersion, { fs: io });
    if (!source || typeof source !== 'object' || source.exists !== exists) throw new Error('config-import-source-conflict');
    if (exists && !isDeepStrictEqual(JSON.parse(bytes.toString('utf8')), source.raw)) throw new Error('config-import-source-conflict');
    const state = normalized(source.raw, { now: now() });
    let kind = null;
    if (exists && source.sourceVersion === schemaVersion && !isDeepStrictEqual(source.raw, state)) {
      kind = migrationTools.detectCurrentSchemaMigration(source.raw, state, schemaVersion);
      if (!kind) throw new Error(UNSUPPORTED);
      migrationTools.prepareCurrentSchemaMigrationBackup(storePath, source.raw, kind, { fs: io });
    }
    if (exists !== io.existsSync(storePath) || exists && !io.readFileSync(storePath).equals(bytes)) throw new Error('config-import-source-conflict');
    const revision = Math.max(0, ...(state.aiCollaboration?.receipts || []).map(receipt => receipt.appliedRevision || 0));
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('config-revision-invalid');
    return { state, revision, sourceVersion: source.sourceVersion, source: { exists, bytes, hash: hashBytes(bytes) },
      migration: { sourceVersion: source.sourceVersion, backupPath: source.backupPath, backupCreated: source.backupCreated,
        currentSchemaMigrationKind: kind, backupId: 'initial-import' } };
  }
  function admitCurrent(current) {
    if (current.payloadVersion > schemaVersion) throw new Error('config-payload-future-schema');
    if (currentOnly) {
      if (current.payloadVersion !== schemaVersion) throw new Error('config-payload-current-schema-required');
      assertCanonical(current.state);
    }
  }
  function validateCurrent(current) {
    admitCurrent(current);
    const state = normalized(current.state, { now: now() });
    const kind = !currentOnly && current.payloadVersion === schemaVersion && !isDeepStrictEqual(state, current.state)
      ? migrationTools.detectCurrentSchemaMigration(current.state, state, schemaVersion) : null;
    if (current.payloadVersion === schemaVersion && !isDeepStrictEqual(state, current.state) && !kind) throw new Error(UNSUPPORTED);
    return { state, kind };
  }
  const authority = authorityFactory({ filePath: path.join(userDataPath, 'config.sqlite'), prepareInitial, validateCurrent,
    admitCurrent: currentOnly ? admitCurrent : null, now, io, driver });
  let mirror;
  let migrationResult = authority.initialMigration;
  try {
    mirror = jsonMirror ? createConfigAuthorityMirror({ filePath: storePath, authority, io,
      writer: mirrorWriterFactory({ filePath: storePath, io, platform }), initialCreateAllowed: authority.initialCreateAllowed })
      : Object.freeze({ status: () => ({ enabled: false, pending: false, reason: null }),
        retry: () => ({ ok: true, pending: false, reason: null }), knownHash: current => current.mirrorBaseHash });
    const current = authority.read();
    const { state, kind } = validateCurrent(current);
    if (!isDeepStrictEqual(state, current.state)) {
      const backupId = `payload-${current.payloadVersion}-${schemaVersion}-${current.hash}`;
      authority.write({ state, expectedRevision: current.revision, expectedHash: current.hash,
        backup: { id: backupId }, mirrorBaseHash: mirror.knownHash(current) });
      migrationResult = { sourceVersion: current.payloadVersion, backupPath: null, backupCreated: true,
        currentSchemaMigrationKind: kind, backupId };
    }
    migrationResult ||= { sourceVersion: current.payloadVersion, backupPath: null, backupCreated: false, currentSchemaMigrationKind: null };
  } catch (error) { authority.close(); throw error; }
  // Compatibility mirror faults never change an already acknowledged SQL result.
  try { mirror.retry(); } catch (_) {}
  const readVersions = new WeakMap();
  function snapshot() {
    const current = authority.read(), state = structuredClone(current.state);
    readVersions.set(state, current); return state;
  }
  function commit(candidate, context = {}) {
    const current = authority.read();
    const captured = candidate && typeof candidate === 'object' ? readVersions.get(candidate) : null;
    const expectedRevision = context.expectedRevision ?? captured?.revision ?? current.revision;
    if (expectedRevision !== current.revision) throw new Error('config-revision-conflict');
    if (currentOnly) assertCanonical(candidate);
    const state = normalized(candidate, context);
    const result = authority.write({ state, expectedRevision, expectedHash: captured?.hash || current.hash,
      mirrorBaseHash: mirror.knownHash(current) });
    try { mirror.retry(); } catch (_) {}
    return structuredClone(result.state);
  }
  function update(mutator, context = {}) {
    if (typeof mutator !== 'function') throw new TypeError('state mutator must be a function');
    const current = snapshot(), returned = mutator(current);
    return commit(returned === undefined ? current : returned, { ...context,
      expectedRevision: context.expectedRevision ?? readVersions.get(current).revision });
  }
  function status() {
    const canonical = authority.status();
    if (!canonical.available) return canonical;
    try { const result = mirror.status(); return { ...canonical, mirrorPending: result.pending, mirrorReason: result.reason }; }
    catch (_) { return { ...canonical, mirrorPending: true, mirrorReason: 'config-mirror-unavailable' }; }
  }
  return Object.freeze({ authoritativeWrites: Object.freeze({ status, verify: authority.verify }),
    get: authority.get, snapshot, commit, update, revision: authority.revision,
    migration: Object.freeze(migrationResult), mirror: Object.freeze({ status: mirror.status, retry: mirror.retry }), close: authority.close });
}
module.exports = { createElectronStoreAdapter };
