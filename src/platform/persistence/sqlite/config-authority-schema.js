'use strict';
const { createHash } = require('node:crypto');
const SQL_VERSION = 1;
const MAX_BYTES = 64 * 1024 * 1024;
const SCHEMA = [
  `CREATE TABLE config_snapshot (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), authority_id TEXT NOT NULL,
    revision INTEGER NOT NULL, payload_version INTEGER NOT NULL, payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL, mirror_base_hash TEXT, mirror_target_hash TEXT NOT NULL,
    verification_count INTEGER NOT NULL CHECK(verification_count>=0 AND verification_count<=9007199254740991)
  )`,
  `CREATE TABLE config_evidence (
    backup_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('import', 'payload-migration')),
    source_version INTEGER NOT NULL, target_version INTEGER NOT NULL, source_revision INTEGER NOT NULL,
    source_hash TEXT NOT NULL, source_bytes BLOB NOT NULL, created_at INTEGER NOT NULL
  )`
];
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonicalSql = sql => String(sql).replace(/\s+/g, ' ').trim();
function encodePayload(value) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > MAX_BYTES) throw new Error('config-authority-capacity');
  const version = value?.schemaVersion;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('config-payload-schema-invalid');
  return { json, version, hash: hashBytes(json), mirrorHash: hashBytes(JSON.stringify(value, null, 2)) };
}
function verifySchema(handle, { allowEmpty = false } = {}) {
  const version = handle.userVersion();
  if (version > SQL_VERSION) throw new Error('config-authority-future-schema');
  const actual = handle.all("SELECT type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (allowEmpty && version === 0 && actual.length === 0) return 0;
  if (version !== SQL_VERSION || actual.length !== SCHEMA.length
    || Object.values(handle.get('PRAGMA quick_check') || {})[0] !== 'ok'
    || SCHEMA.some(sql => !actual.some(row => row.type === 'table' && canonicalSql(row.sql) === canonicalSql(sql)))) {
    throw new Error('config-authority-schema-invalid');
  }
  return version;
}
function readAuthoritySnapshot(handle, identity, { allowEmpty = false } = {}) {
  const version = verifySchema(handle, { allowEmpty });
  const applicationId = Number(handle.get('PRAGMA application_id')?.application_id || 0);
  if (version === 0 && allowEmpty && applicationId === 0) return null;
  if (applicationId !== identity.applicationId) throw new Error('config-authority-identity-mismatch');
  return readSnapshot(handle, identity);
}
function readSnapshot(handle, identity) {
  const rows = handle.all('SELECT * FROM config_snapshot');
  const row = rows[0];
  if (rows.length !== 1 || row.singleton !== 1 || row.authority_id !== identity.authorityId
    || !Number.isSafeInteger(row.revision) || row.revision < 0 || !hashValid(row.payload_hash)
    || !Number.isSafeInteger(row.verification_count) || row.verification_count < 0
    || row.mirror_base_hash !== null && !hashValid(row.mirror_base_hash) || !hashValid(row.mirror_target_hash)
    || typeof row.payload_json !== 'string' || Buffer.byteLength(row.payload_json) > MAX_BYTES
    || hashBytes(row.payload_json) !== row.payload_hash) throw new Error('config-authority-snapshot-invalid');
  let value;
  try { value = JSON.parse(row.payload_json); } catch (_) { throw new Error('config-authority-snapshot-invalid'); }
  const encoded = encodePayload(value);
  if (encoded.version !== row.payload_version || encoded.mirrorHash !== row.mirror_target_hash) throw new Error('config-authority-snapshot-invalid');
  return { state: value, revision: row.revision, hash: row.payload_hash, json: row.payload_json,
    payloadVersion: row.payload_version, verificationCount: row.verification_count, mirrorBaseHash: row.mirror_base_hash, mirrorTargetHash: row.mirror_target_hash };
}
function verifyEvidence(handle, identity) {
  const rows = handle.all('SELECT * FROM config_evidence');
  if (rows.length < 1 || rows.length > 64) throw new Error('config-authority-evidence-invalid');
  for (const row of rows) {
    const bytes = Buffer.from(row.source_bytes);
    if (!['import', 'payload-migration'].includes(row.kind) || bytes.length > MAX_BYTES || !hashValid(row.source_hash)
      || hashBytes(bytes) !== row.source_hash || !Number.isSafeInteger(row.source_revision) || row.source_revision < 0
      || !Number.isSafeInteger(row.source_version) || row.source_version < 0 || !Number.isSafeInteger(row.target_version)
      || row.target_version < 1 || !Number.isSafeInteger(row.created_at) || row.created_at < 0) throw new Error('config-authority-evidence-invalid');
  }
  const initial = rows.filter(row => row.kind === 'import');
  if (initial.length !== 1 || initial[0].source_hash !== identity.sourceHash
    || Buffer.from(initial[0].source_bytes).length !== identity.sourceLength) throw new Error('config-authority-import-mismatch');
}
module.exports = { SQL_VERSION, MAX_BYTES, SCHEMA, hashBytes, hashValid, encodePayload, verifySchema, readAuthoritySnapshot, readSnapshot, verifyEvidence };
