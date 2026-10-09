'use strict';
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { hashBytes } = require('./sqlite/config-authority-schema');

// JSON is a compatibility mirror after adoption. Only known mirror lineage may
// be replaced; changed, corrupt, removed or unreadable files remain evidence.
function createConfigAuthorityMirror({ filePath, authority, writer, io = fs, initialCreateAllowed = false }) {
  let mayCreate = initialCreateAllowed;
  function observe() {
    try {
      if (!io.existsSync(filePath)) return { exists: false, hash: null, bytes: null };
      const bytes = io.readFileSync(filePath); mayCreate = false;
      return { exists: true, hash: hashBytes(bytes), bytes };
    } catch (_) { return { reason: 'config-mirror-unreadable' }; }
  }
  function inspect(snapshot = authority.read()) {
    const found = observe();
    if (found.reason) return { pending: true, reason: found.reason };
    if (!found.exists) return { pending: true, reason: mayCreate && snapshot.mirrorBaseHash === null
      ? 'config-mirror-pending' : 'config-mirror-conflict' };
    if (![snapshot.mirrorBaseHash, snapshot.mirrorTargetHash].includes(found.hash)) return { pending: true, reason: 'config-mirror-conflict' };
    try {
      if (isDeepStrictEqual(JSON.parse(found.bytes.toString('utf8')), snapshot.state)) return { pending: false, reason: null };
    } catch (_) { return { pending: true, reason: 'config-mirror-conflict' }; }
    return { pending: true, reason: 'config-mirror-pending' };
  }
  function knownHash(snapshot) {
    const found = observe();
    return !found.reason && [snapshot.mirrorBaseHash, snapshot.mirrorTargetHash].includes(found.hash)
      ? found.hash : snapshot.mirrorBaseHash;
  }
  function retry() {
    let snapshot;
    try { snapshot = authority.read(); } catch (_) { return { ok: false, pending: true, reason: 'config-authority-unavailable' }; }
    const before = inspect(snapshot);
    if (before.reason === 'config-mirror-conflict' || before.reason === 'config-mirror-unreadable') return { ok: false, ...before };
    if (before.pending) {
      const original = observe();
      if (original.reason || ![snapshot.mirrorBaseHash, snapshot.mirrorTargetHash].includes(original.hash)) {
        return { ok: false, pending: true, reason: 'config-mirror-conflict' };
      }
      try { writer.write(snapshot.state, { requireDurable: false, expectedSourceHash: original.hash }); }
      catch (error) { return { ok: false, pending: true, reason: error?.code === 'CONFIG_MIRROR_CONFLICT'
        ? 'config-mirror-conflict' : 'config-mirror-write-failed' }; }
    }
    const found = observe();
    if (!found.exists || ![snapshot.mirrorBaseHash, snapshot.mirrorTargetHash].includes(found.hash)) {
      return { ok: false, pending: true, reason: 'config-mirror-write-failed' };
    }
    const after = inspect(snapshot);
    if (after.pending) return { ok: false, ...after };
    if (found.hash !== snapshot.mirrorBaseHash && !authority.acknowledgeMirror({ revision: snapshot.revision, hash: snapshot.hash, mirrorHash: found.hash }).ok) {
      return { ok: false, pending: true, reason: 'config-mirror-ack-pending' };
    }
    return { ok: true, pending: false, reason: null };
  }
  return Object.freeze({ status: () => inspect(), retry, knownHash });
}
module.exports = { createConfigAuthorityMirror };
