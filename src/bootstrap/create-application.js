'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDevProfile, profileUserDataPath } = require('../core/runtime-profile');
const { createAppHost } = require('../platform/electron/app-host');
const { createSqliteStateAdapter } = require('../platform/persistence/sqlite-state-adapter');
const { openDatabase } = require('../platform/persistence/sqlite/sqlite-database');
const { createSecureCredentialStore } = require('../platform/providers');
const { openMemoryAuthority } = require('./memory-authority');
const { randomUUID } = require('node:crypto');
const { openCollaborationStorageAt } = require('./collaboration-storage');
const { createProviderRequestScope } = require('../application/ai/provider-request-scope');

// ARCHITECTURE「事实流与长期记忆」: report the selected storage tier in one
// concise startup diagnostic; storage selection belongs to the application.
function reportFactStoreTier(record) {
  if (record && record.event === 'tier-selected') {
    const suffix = record.degradedReason ? ` (${record.degradedReason})` : '';
    process.stdout.write(`[fact-store] tier=${record.tier}${suffix}\n`);
  }
}

// Fact storage selects an available SQLite driver. Unavailable storage is
// explicit; an established authority never becomes an empty replacement.
function openFactStoreAt({ userDataPath, logger }) {
  return openDatabase({ filePath: path.join(userDataPath, 'bubu.sqlite'), logger });
}

const REQUIRED_APP_HOST_METHODS = Object.freeze([
  'userDataPath',
  'hasExplicitUserDataPath',
  'setDataDirectory',
  'acquireSingleInstanceLock',
  'isPackaged',
  'isReady',
  'whenReady',
  'hideDock',
  'openAtLogin',
  'setOpenAtLogin',
  'quit',
  'subscribeLifecycle'
]);

function createApplication({
  argv = process.argv,
  schemaVersion,
  normalizePersistedState,
  appHost = createAppHost(),
  makeDirectory = directory => fs.mkdirSync(directory, { recursive: true }),
  createStateRepository = createSqliteStateAdapter,
  createCredentialStore = createSecureCredentialStore,
  openFactStore = openFactStoreAt,
  openCollaborationStorage = openCollaborationStorageAt,
  factStoreLogger = reportFactStoreTier
} = {}) {
  if (!Array.isArray(argv)) throw new TypeError('application argv must be an array');
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new RangeError('application schemaVersion must be a positive integer');
  }
  if (typeof normalizePersistedState !== 'function') {
    throw new TypeError('application state normalizer must be a function');
  }
  if (!appHost || REQUIRED_APP_HOST_METHODS.some(method => typeof appHost[method] !== 'function')) {
    throw new TypeError('application requires a complete app host');
  }
  if (typeof makeDirectory !== 'function'
      || typeof createStateRepository !== 'function'
      || typeof createCredentialStore !== 'function'
      || typeof openFactStore !== 'function'
      || typeof openCollaborationStorage !== 'function') {
    throw new TypeError('application composition ports must be functions');
  }

  const profile = isDevProfile(argv) ? 'development' : 'production';
  if (profile === 'development' && !appHost.hasExplicitUserDataPath()) {
    const directory = profileUserDataPath(appHost.userDataPath(), argv);
    makeDirectory(directory);
    appHost.setDataDirectory(directory);
  }

  if (!appHost.acquireSingleInstanceLock()) {
    appHost.quit();
    return Object.freeze({ status: 'secondary-instance', profile });
  }

  const userDataPath = appHost.userDataPath();
  const resources = [];
  let closed = false;
  function closeStorage() {
    if (closed) return;
    closed = true;
    for (const resource of [...resources].reverse()) {
      try { resource?.close?.(); } catch (_) { /* Release the remaining stores on shutdown. */ }
    }
  }
  try {
    const stateRepository = createStateRepository({ userDataPath, schemaVersion, normalize: normalizePersistedState });
    resources.push(stateRepository);
    const credentialStore = createCredentialStore({ userDataPath });
    const collaborationStorage = openCollaborationStorage({ userDataPath });
    resources.push(collaborationStorage);
    const factStore = openFactStore({ userDataPath, logger: factStoreLogger });
    resources.push(factStore);
    const memoryAuthority = openMemoryAuthority({ factStore, storage: collaborationStorage, userDataPath,
      now: () => Date.now(), idFactory: kind => `${kind}-${randomUUID()}` });
    resources.push(memoryAuthority);
    const requestScope = createProviderRequestScope();
    resources.push(requestScope);
    return Object.freeze({ status: 'primary-instance', profile, userDataPath, appHost,
      stateRepository, credentialStore, collaborationStorage, factStore, closeStorage, memoryAuthority, requestScope });
  } catch (error) { closeStorage(); throw error; }
}

module.exports = { createApplication };
