'use strict';

const { openProfileIdentityDatabase, markProfileIdentityDatabaseReady } = require('./sqlite/sqlite-database');

// Identity is a separate, durable authority. The SQLite adapter owns platform-
// specific commit flushing; this public facade never depends on POSIX directory
// handles, renderer identities, or the disposable fact-store fallback chain.
function openProfileIdentity(options = {}) {
  return openProfileIdentityDatabase(options);
}

function markProfileIdentityReady(options = {}) {
  return markProfileIdentityDatabaseReady(options);
}

module.exports = { openProfileIdentity, markProfileIdentityReady };
