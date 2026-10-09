'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SQL_VERSION, SCHEMA, encodePayload, readSnapshot, readAuthoritySnapshot, verifySchema, verifyEvidence } = require('./config-authority-schema');
const { admitConfigCopy } = require('./config-admission-copy');
const { proveConfigSnapshotDurable } = require('./config-authority-proof');
const { readIdentity, createIdentity, markReady, setDurability } = require('./config-authority-identity');

const failure = reason => Object.assign(new Error(reason), { code: reason });
function openSqliteConfigAuthority({ filePath, identityPath = `${filePath}.identity.sqlite`, prepareInitial,
  now = () => Date.now(), io = fs, driver = 'auto', validateCurrent = () => {}, admitCurrent = null } = {}, { selectDriver, makeHandle }) {
  if (typeof filePath !== 'string' || !filePath || filePath === ':memory:' || path.resolve(filePath) === path.resolve(identityPath)
    || typeof prepareInitial !== 'function') throw failure('config-authority-options-invalid');
  const selected = selectDriver(driver);
  if (!selected) throw failure('config-authority-unavailable');
  const ports = { identityPath, io, driver: selected, makeHandle };
  const proveDurable = (expected, verifyExtra) => proveConfigSnapshotDurable({ filePath, identity, expected, verifyExtra }, { driver: selected, makeHandle });
  // SQLite read-only opens can still alter WAL/SHM. Current-only refusal must
  // finish on a complete disposable tuple before connecting to either original.
  let initial = admitCurrent ? admitConfigCopy({ filePath, identityPath, io, prepareInitial, validateCurrent: admitCurrent },
    { driver: selected, makeHandle }) : null;
  let identity = readIdentity(ports), initializedNow = false, closed = false, unavailable = null;
  const present = () => io.existsSync(filePath);
  const anyMain = ['', '-wal', '-shm'].some(suffix => io.existsSync(filePath + suffix));
  if (!identity && anyMain) throw failure('config-identity-missing');
  if (identity?.phase === 'READY' && !present()) throw failure('config-authority-missing');
  if (!present() && anyMain) throw failure('config-authority-missing');
  if (!identity) {
    initial = prepareInitial();
    identity = createIdentity(ports, initial.source);
  }
  function checkIdentity() {
    if (closed || unavailable) throw failure(unavailable || 'config-authority-closed');
    const current = readIdentity(ports);
    if (!current || current.authorityId !== identity.authorityId || current.applicationId !== identity.applicationId
      || current.sourceHash !== identity.sourceHash || current.sourceExists !== identity.sourceExists
      || current.sourceLength !== identity.sourceLength) throw failure('config-identity-mismatch');
    if (!present()) throw failure('config-authority-missing');
  }
  function readHandle(handle, allowEmpty = false) {
    return readAuthoritySnapshot(handle, identity, { allowEmpty });
  }
  let startup;
  if (present()) {
    const handle = makeHandle(selected.open(filePath, { readOnly: true }));
    try {
      startup = readHandle(handle, identity.phase === 'INITIALIZING');
      if (startup) verifyEvidence(handle, identity);
    } finally { handle.close(); }
  }
  if (!startup) {
    if (identity.phase !== 'INITIALIZING') throw failure('config-authority-uninitialized');
    initial ||= prepareInitial();
    if (initial.source.exists !== identity.sourceExists || initial.source.hash !== identity.sourceHash
      || initial.source.bytes.length !== identity.sourceLength) throw failure('config-import-source-conflict');
    const encoded = encodePayload(initial.state);
    if (!present()) {
      io.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = io.openSync(filePath, 'wx', 0o600); try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
    }
    const handle = makeHandle(selected.open(filePath));
    try {
      setDurability(handle); handle.exec('BEGIN IMMEDIATE');
      try {
        if (verifySchema(handle, { allowEmpty: true }) !== 0) throw failure('config-authority-initialization-conflict');
        SCHEMA.forEach(sql => handle.exec(sql));
        handle.exec(`PRAGMA application_id=${identity.applicationId}`);
        handle.run('INSERT INTO config_snapshot VALUES(1,?,?,?,?,?,?,?,0)', [identity.authorityId,
          initial.revision, encoded.version, encoded.hash, encoded.json, initial.source.exists ? initial.source.hash : null, encoded.mirrorHash]);
        handle.run('INSERT INTO config_evidence VALUES(?,?,?,?,?,?,?,?)', ['initial-import', 'import', initial.sourceVersion,
          encoded.version, initial.revision, initial.source.hash, initial.source.bytes, now()]);
        handle.setUserVersion(SQL_VERSION); handle.exec('COMMIT');
      } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
    } catch (error) {
      // Reconcile exact logical state, then require a new successful FULL
      // proof before initialization can be acknowledged as durable.
      const proof = makeHandle(selected.open(filePath, { readOnly: true }));
      try {
        const result = readHandle(proof); verifyEvidence(proof, identity);
        if (result.hash !== encoded.hash || result.revision !== initial.revision) throw error;

      } finally { proof.close(); }
    } finally { handle.close(); }
    initializedNow = true;
  }
  if (!startup) {
    const proof = makeHandle(selected.open(filePath, { readOnly: true }));
    try { startup = readHandle(proof); verifyEvidence(proof, identity); }
    finally { proof.close(); }
  }
  // Revalidate the admitted original before its one normal startup proof.
  // Only the copied current-only gate promises byte-preserving refusal.
  validateCurrent(startup);
  try { proveDurable(startup, handle => verifyEvidence(handle, identity)); }
  catch (_) { throw failure('config-commit-outcome-unknown'); }
  markReady(ports, identity); identity = readIdentity(ports);
  const fileKey = target => { const stat = io.statSync(target); return `${stat.dev}:${stat.ino}`; };
  const mainKey = fileKey(filePath), identityKey = fileKey(identityPath);
  let reader, identityReader;
  try {
    reader = makeHandle(selected.open(filePath, { readOnly: true }));
    identityReader = makeHandle(selected.open(identityPath, { readOnly: true }));
  } catch (error) { if (reader) reader.close(); if (identityReader) identityReader.close(); throw error; }
  let schemaToken, identitySchemaToken;
  try {
    schemaToken = Number(reader.get('PRAGMA schema_version')?.schema_version);
    identitySchemaToken = Number(identityReader.get('PRAGMA schema_version')?.schema_version);
  } catch (error) { reader.close(); identityReader.close(); throw error; }
  let cached = null, dataVersion = null;

  function checkLive() {
    if (closed || unavailable) throw failure(unavailable || 'config-authority-closed');
    if (!present() || !io.existsSync(identityPath)) throw failure('config-authority-missing');
    if (fileKey(filePath) !== mainKey || fileKey(identityPath) !== identityKey) throw failure('config-authority-replaced');
    if (Number(reader.get('PRAGMA schema_version')?.schema_version) !== schemaToken
      || Number(identityReader.get('PRAGMA schema_version')?.schema_version) !== identitySchemaToken) throw failure('config-authority-schema-invalid');
    const marker = identityReader.get('SELECT authority_id,application_id,source_hash,source_length,source_exists,phase FROM config_identity WHERE singleton=1');
    if (identityReader.userVersion() !== 1 || marker?.authority_id !== identity.authorityId
      || marker.application_id !== identity.applicationId || marker.source_hash !== identity.sourceHash
      || marker.source_length !== identity.sourceLength || marker.source_exists !== (identity.sourceExists ? 1 : 0)
      || marker.phase !== 'READY') throw failure('config-identity-mismatch');
  }

  function cachedSnapshot() {
    checkLive();
    if (reader.userVersion() !== SQL_VERSION || Number(reader.get('PRAGMA application_id')?.application_id) !== identity.applicationId) throw failure('config-authority-schema-invalid');
    const version = Number(reader.get('PRAGMA data_version')?.data_version);
    if (!cached || dataVersion !== version) { cached = readSnapshot(reader, identity); dataVersion = version; }
    return cached;
  }
  function read() { const value = cachedSnapshot(); return { ...value, state: structuredClone(value.state) }; }
  function runtimeSnapshot(handle) {
    if (handle.userVersion() !== SQL_VERSION || Number(handle.get('PRAGMA application_id')?.application_id) !== identity.applicationId) {
      throw failure('config-authority-schema-invalid');
    }
    return readSnapshot(handle, identity);
  }
  function freshRead(fullVerification = false) {
    checkLive();
    const handle = makeHandle(selected.open(filePath, { readOnly: true }));
    try { return fullVerification ? readHandle(handle) : runtimeSnapshot(handle); } finally { handle.close(); }
  }
  function write({ state, expectedRevision, expectedHash, backup = null, mirrorBaseHash }) {
    checkIdentity();
    const encoded = encodePayload(state), desiredRevision = expectedRevision + 1;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(desiredRevision)) throw failure('config-revision-invalid');
    // Validate in read-only mode before acquiring any write connection. Unknown
    // or future schemas are evidence and must not be changed by WAL pragmas.
    const before = read();
    if (before.revision !== expectedRevision || before.hash !== expectedHash) throw failure('config-revision-conflict');
    if (backup) retainMigrationBackup(backup.id, before, encoded.version);
    const handle = makeHandle(selected.open(filePath));
    let error = null;
    try {
      setDurability(handle); handle.exec('BEGIN IMMEDIATE');
      try {
        const current = runtimeSnapshot(handle);
        if (current.revision !== expectedRevision || current.hash !== expectedHash) throw failure('config-revision-conflict');
        const base = [before.mirrorBaseHash, before.mirrorTargetHash].includes(mirrorBaseHash) ? mirrorBaseHash : before.mirrorBaseHash;
        const changed = handle.run('UPDATE config_snapshot SET revision=?,payload_version=?,payload_hash=?,payload_json=?,mirror_base_hash=?,mirror_target_hash=? WHERE singleton=1 AND revision=? AND payload_hash=?',
          [desiredRevision, encoded.version, encoded.hash, encoded.json, base, encoded.mirrorHash, expectedRevision, expectedHash]);
        if (Number(changed.changes) !== 1) throw failure('config-revision-conflict');
        handle.exec('COMMIT');
      } catch (caught) { try { handle.exec('ROLLBACK'); } catch (_) {} throw caught; }
    } catch (caught) { error = caught; }
    finally { handle.close(); }
    let proof;
    try { proof = freshRead(); }
    catch (_) { unavailable = 'config-commit-outcome-unknown'; throw failure(unavailable); }
    if (proof.revision === desiredRevision && proof.hash === encoded.hash) {
      if (error) {
        try { proof = proveDurable(proof); }
        catch (_) { unavailable = 'config-commit-outcome-unknown'; throw failure(unavailable); }
      }
      return { committed: true, ...proof, reconciled: Boolean(error) };
    }
    if (proof.revision === expectedRevision && proof.hash === expectedHash) throw error || failure('config-commit-failed');
    unavailable = 'config-commit-outcome-unknown'; throw failure(unavailable);
  }
  function retainMigrationBackup(backupId, before, targetVersion) {
    const matches = row => row && row.kind === 'payload-migration' && row.source_version === before.payloadVersion
      && row.target_version === targetVersion && row.source_revision === before.revision && row.source_hash === before.hash
      && Buffer.from(row.source_bytes).equals(Buffer.from(before.json));
    const handle = makeHandle(selected.open(filePath));
    let error = null, existingEvidence = false;
    try {
      setDurability(handle); handle.exec('BEGIN IMMEDIATE');
      try {
        const current = runtimeSnapshot(handle);
        if (current.revision !== before.revision || current.hash !== before.hash) throw failure('config-revision-conflict');
        const prior = handle.get('SELECT * FROM config_evidence WHERE backup_id=?', [backupId]);
        existingEvidence = Boolean(prior);
        if (prior && !matches(prior)) throw failure('config-migration-backup-conflict');
        if (!prior) {
          if (handle.get('SELECT COUNT(*) AS count FROM config_evidence').count >= 64) throw failure('config-migration-backup-capacity');
          handle.run('INSERT INTO config_evidence VALUES(?,?,?,?,?,?,?,?)', [backupId, 'payload-migration', before.payloadVersion,
            targetVersion, before.revision, before.hash, Buffer.from(before.json), now()]);
        }
        handle.exec('COMMIT');
      } catch (caught) { try { handle.exec('ROLLBACK'); } catch (_) {} throw caught; }
    } catch (caught) { error = caught; }
    finally { handle.close(); }
    let proof;
    try {
      proof = makeHandle(selected.open(filePath, { readOnly: true }));
      const retained = proof.get('SELECT * FROM config_evidence WHERE backup_id=?', [backupId]);
      if (!matches(retained)) throw error || failure('config-migration-backup-failed');
    } finally { if (proof) proof.close(); }
    if (error || existingEvidence) {
      try { proveDurable(before, handle => {
        if (!matches(handle.get('SELECT * FROM config_evidence WHERE backup_id=?', [backupId]))) throw failure('config-migration-backup-failed');
      }); } catch (_) { unavailable = 'config-commit-outcome-unknown'; throw failure(unavailable); }
    }
  }
  function acknowledgeMirror({ revision, hash, mirrorHash }) {
    checkIdentity();
    const handle = makeHandle(selected.open(filePath));
    try {
      setDurability(handle);
      const row = runtimeSnapshot(handle);
      if (row.revision !== revision || row.hash !== hash || ![row.mirrorBaseHash, row.mirrorTargetHash].includes(mirrorHash)) return { ok: false };
      handle.run('UPDATE config_snapshot SET mirror_base_hash=? WHERE singleton=1 AND revision=? AND payload_hash=?', [mirrorHash, revision, hash]);
      return { ok: true };
    } catch (_) { return { ok: false }; }
    finally { handle.close(); }
  }
  function status() {
    try { const value = cachedSnapshot(); return { available: true, revision: value.revision, hash: value.hash }; }
    catch (error) { return { available: false, reason: /^config-[a-z-]+$/.test(error.message) ? error.message : 'config-authority-unavailable' }; }
  }
  function verify() {
    try { const value = freshRead(true); return { ok: true, revision: value.revision, hash: value.hash }; }
    catch (error) { return { ok: false, reason: /^config-[a-z-]+$/.test(error.message) ? error.message : 'config-authority-unavailable' }; }
  }
  function close() { if (!closed) { closed = true; reader.close(); identityReader.close(); } }
  try {
    return Object.freeze({ read, write, acknowledgeMirror, status, verify, close,
      get: key => structuredClone(cachedSnapshot().state[key]), revision: () => cachedSnapshot().revision,
      initializedNow, initialMigration: initial?.migration || null, initialCreateAllowed: !identity.sourceExists && read().mirrorBaseHash === null });
  } catch (error) { close(); throw error; }
}
module.exports = { openSqliteConfigAuthority };
