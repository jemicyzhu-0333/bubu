'use strict';
const { verifySchema, readSnapshot } = require('./config-authority-schema');
const { setDurability } = require('./config-authority-identity');

// Readability after a failed COMMIT does not prove a successful FULL flush.
// Persist a bounded metadata counter without replaying business work, advancing
// its revision, or changing receipt identity, payload or mirror lineage.
function proveConfigSnapshotDurable({ filePath, identity, expected, verifyExtra = () => {} }, { driver, makeHandle }) {
  const nextCount = expected.verificationCount + 1;
  if (!Number.isSafeInteger(nextCount)) throw new Error('config-durability-proof-limit');
  function read(handle, verificationCount) {
    verifySchema(handle);
    if (Number(handle.get('PRAGMA application_id')?.application_id) !== identity.applicationId) throw new Error('config-authority-identity-mismatch');
    const value = readSnapshot(handle, identity);
    if (value.revision !== expected.revision || value.hash !== expected.hash || value.verificationCount !== verificationCount
      || value.mirrorBaseHash !== expected.mirrorBaseHash || value.mirrorTargetHash !== expected.mirrorTargetHash) {
      throw new Error('config-durability-proof-conflict');
    }
    verifyExtra(handle);
    return value;
  }
  const handle = makeHandle(driver.open(filePath));
  try {
    setDurability(handle);
    handle.exec('BEGIN IMMEDIATE');
    try {
      read(handle, expected.verificationCount);
      const changed = handle.run('UPDATE config_snapshot SET verification_count=? WHERE singleton=1 AND authority_id=? AND revision=? AND payload_hash=? AND verification_count=?',
        [nextCount, identity.authorityId, expected.revision, expected.hash, expected.verificationCount]);
      if (Number(changed.changes) !== 1) throw new Error('config-durability-proof-conflict');
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch (_) {} throw error; }
  } finally { handle.close(); }
  const proof = makeHandle(driver.open(filePath, { readOnly: true }));
  try { return read(proof, nextCount); } finally { proof.close(); }
}
module.exports = { proveConfigSnapshotDurable };
