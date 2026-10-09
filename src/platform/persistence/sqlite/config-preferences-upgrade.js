'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { admitConfigCopy } = require('./config-admission-copy');
const { readIdentity, setDurability } = require('./config-authority-identity');
const { encodePayload, readAuthoritySnapshot, verifyEvidence } = require('./config-authority-schema');
const { proveConfigSnapshotDurable } = require('./config-authority-proof');
const { createProfileUpgradeBackup } = require('./profile-upgrade-backup-container');
const { assertCanonicalPersistedState } = require('../persisted-schema');
const { prepareInterfacePreferencesUpgrade } = require('../../../application/workflows/upgrade-interface-preferences');
const fail = reason => Object.assign(new Error(reason), { code: reason });
function prepareConfigPreferencesUpgrade({ userDataPath, io = fs, now = () => Date.now(), checkpoint = () => {},
  verifyPermissions } = {}, ports) {
  const sourcePath = path.resolve(userDataPath);
  const filePath = path.join(sourcePath, 'config.sqlite'), identityPath = `${filePath}.identity.sqlite`;
  function inspect() {
    let inspected;
    admitConfigCopy({ filePath, identityPath, io,
      prepareInitial() { throw fail('config-preferences-upgrade-source-invalid'); },
      validateCurrent(snapshot, identity) {
        if (!identity || identity.phase !== 'READY' || snapshot.payloadVersion !== 18) throw fail('config-preferences-upgrade-source-invalid');
        const candidate = prepareInterfacePreferencesUpgrade(snapshot.state, assertCanonicalPersistedState);
        inspected = { snapshot, identity, candidate };
      } }, { ...ports, verifyPermissions });
    if (!inspected) throw fail('config-preferences-upgrade-source-invalid');
    return inspected;
  }
  const inspected = inspect(), encoded = encodePayload(inspected.candidate);
  assertCanonicalPersistedState(JSON.parse(encoded.json));
  const token = randomUUID();
  const backupPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}.schema18-to19-${token}.backup`);
  const binding = Object.freeze({ sourcePath, authorityId: inspected.identity.authorityId,
    applicationId: inspected.identity.applicationId, sourceRevision: inspected.snapshot.revision,
    sourceHash: inspected.snapshot.hash, sourceVersion: 18, targetVersion: 19, targetHash: encoded.hash, token });
  let used = false;
  function compare(current) {
    if (!isDeepStrictEqual(current.identity, inspected.identity) || current.snapshot.revision !== binding.sourceRevision
      || current.snapshot.hash !== binding.sourceHash || !isDeepStrictEqual(current.snapshot, inspected.snapshot)) throw fail('config-preferences-upgrade-source-drift');
  }
  function execute(confirmation) {
    if (used || confirmation !== token) throw fail('config-preferences-upgrade-confirmation-required');
    used = true;
    compare(inspect()); checkpoint('admitted');
    const backup = createProfileUpgradeBackup({ sourcePath, backupPath, binding, io, checkpoint, verifyPermissions }, ports);
    compare(inspect()); checkpoint('candidate-validated');
    backup.verifyBackup(); backup.verifySource(); checkpoint('before-writer');
    // Recheck after the fault boundary too: consent is never a standing grant
    // to a replaced profile, changed revision, or a different backup.
    compare(inspect()); backup.verifyBackup(); backup.verifySource();
    const result = commitUpgrade({ filePath, identityPath, inspected, encoded, backup, now, io, checkpoint }, ports);
    return Object.freeze({ status: 'upgraded', backupPath, backupFile: backup.filePath,
      sourceVersion: 18, targetVersion: 19, revision: result.revision, reconciled: result.reconciled });
  }
  return Object.freeze({ status: 'verified-upgrade-required', confirmation: token,
    sourceVersion: 18, targetVersion: 19, sourcePath, backupPath, binding, execute });
}
function commitUpgrade({ filePath, identityPath, inspected, encoded, backup, now, io, checkpoint }, ports) {
  const { driver, makeHandle } = ports, { identity, snapshot: before } = inspected;
  const desiredRevision = before.revision + 1;
  if (!Number.isSafeInteger(desiredRevision)) throw fail('config-revision-invalid');
  const evidenceId = `preferences-18-19-${before.hash}`;
  const matchesEvidence = row => row && row.kind === 'payload-migration' && row.source_version === 18 && row.target_version === 19
    && row.source_revision === before.revision && row.source_hash === before.hash && Buffer.from(row.source_bytes).equals(Buffer.from(before.json));
  const verifyReceipt = handle => {
    verifyEvidence(handle, identity);
    if (!matchesEvidence(handle.get('SELECT * FROM config_evidence WHERE backup_id=?', [evidenceId]))) throw fail('config-upgrade-evidence-invalid');
  };
  function currentIdentity() {
    const current = readIdentity({ identityPath, io, ...ports });
    if (!isDeepStrictEqual(current, identity)) throw fail('config-identity-mismatch');
  }
  function readCurrent() {
    currentIdentity();
    const reader = makeHandle(driver.open(filePath, { readOnly: true }));
    try {
      const value = readAuthoritySnapshot(reader, identity); verifyEvidence(reader, identity);
      if (value.revision === desiredRevision && value.hash === encoded.hash) verifyReceipt(reader);
      return value;
    } finally { reader.close(); }
  }
  let writer, error, writerOpened = false;
  try {
    const opened = driver.open(filePath); writerOpened = true;
    writer = makeHandle(opened); checkpoint('writer-open');
    setDurability(writer); writer.exec('BEGIN IMMEDIATE');
    try {
      currentIdentity();
      const current = readAuthoritySnapshot(writer, identity); verifyEvidence(writer, identity);
      if (!isDeepStrictEqual(current, before)) throw fail('config-revision-conflict');
      if (writer.get('SELECT COUNT(*) AS count FROM config_evidence').count >= 64) throw fail('config-migration-backup-capacity');
      if (writer.get('SELECT * FROM config_evidence WHERE backup_id=?', [evidenceId])) throw fail('config-migration-backup-conflict');
      const createdAt = now();
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw fail('config-upgrade-clock-invalid');
      writer.run('INSERT INTO config_evidence VALUES(?,?,?,?,?,?,?,?)', [evidenceId, 'payload-migration', 18, 19,
        before.revision, before.hash, Buffer.from(before.json), createdAt]);
      checkpoint('evidence-written');
      const changed = writer.run('UPDATE config_snapshot SET revision=?,payload_version=?,payload_hash=?,payload_json=?,mirror_target_hash=? WHERE singleton=1 AND revision=? AND payload_hash=?',
        [desiredRevision, 19, encoded.hash, encoded.json, encoded.mirrorHash, before.revision, before.hash]);
      if (Number(changed.changes) !== 1) throw fail('config-revision-conflict');
      checkpoint('payload-written');
      assertCanonicalPersistedState(readAuthoritySnapshot(writer, identity).state); verifyReceipt(writer);
      checkpoint('before-commit'); writer.exec('COMMIT'); checkpoint('after-commit');
    } catch (caught) { try { writer.exec('ROLLBACK'); } catch (_) {} throw caught; }
  } catch (caught) { error = caught; }
  finally { writer?.close(); }
  // A rejected open cannot have attempted our transaction. Do not turn that
  // pre-writer failure into an original read-only connection with WAL effects.
  if (!writerOpened) throw Object.assign(error || fail('config-upgrade-open-failed'), { backupPath: backup.backupPath });
  let current;
  try { current = readCurrent(); }
  catch (_) { throw Object.assign(fail('config-commit-outcome-unknown'), { backupPath: backup.backupPath }); }
  if (current.revision === before.revision && current.hash === before.hash) {
    throw Object.assign(error || fail('config-upgrade-commit-failed'), { backupPath: backup.backupPath });
  }
  if (current.revision !== desiredRevision || current.hash !== encoded.hash) {
    throw Object.assign(fail('config-commit-outcome-unknown'), { backupPath: backup.backupPath });
  }
  try {
    assertCanonicalPersistedState(current.state); currentIdentity();
    // Includes the exact migration receipt; the business transition is never
    // replayed to reconcile COMMIT uncertainty.
    proveConfigSnapshotDurable({ filePath, identity, expected: current, verifyExtra: verifyReceipt }, ports);
  } catch (_) { throw Object.assign(fail('config-commit-outcome-unknown'), { backupPath: backup.backupPath }); }
  return { revision: desiredRevision, reconciled: Boolean(error) };
}
module.exports = { prepareConfigPreferencesUpgrade };
