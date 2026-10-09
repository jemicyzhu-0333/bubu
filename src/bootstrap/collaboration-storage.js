'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { openProfileIdentity, markProfileIdentityReady } = require('../platform/persistence/profile-identity');
const { openCollaborationDatabase } = require('../platform/persistence/sqlite/sqlite-database');

// Called only after createApplication has acquired this profile's instance lock.
// A broken authority never becomes an empty replacement. Temporary sessions can
// continue under a process-local identity, but cannot claim durable recovery.
function openCollaborationStorageAt({ userDataPath } = {}) {
  const filePath = path.join(userDataPath, 'collaboration.sqlite');
  const identityPath = path.join(userDataPath, 'profile-identity.sqlite');
  const identity = openProfileIdentity({ filePath: identityPath,
    databasePath: filePath, lockAcquired: true });
  if (identity.status !== 'available') return Object.freeze({ status: identity.status,
    reason: identity.reason, ownerId: `temporary-${randomUUID()}`, repository: null, close() {} });
  if (identity.phase === 'READY' && !fs.existsSync(filePath)) return Object.freeze({
    status: 'recovery-required', reason: 'collaboration-database-missing', ownerId: identity.ownerId,
    identityAvailable: true, repository: null, close() {} });
  const opened = openCollaborationDatabase({ filePath, ownerId: identity.ownerId, requireInitialized: identity.phase === 'READY' });
  if (opened.status !== 'available') return Object.freeze({ ...opened, ownerId: identity.ownerId, identityAvailable: true });
  const ready = markProfileIdentityReady({ filePath: identityPath, ownerId: identity.ownerId, lockAcquired: true });
  if (ready.status !== 'available') {
    opened.close();
    return Object.freeze({ ...ready, ownerId: identity.ownerId, identityAvailable: true, repository: null, close() {} });
  }
  return Object.freeze({ ...opened, ownerId: identity.ownerId, identityAvailable: true });
}
module.exports = { openCollaborationStorageAt };
