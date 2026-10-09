'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSqliteStateAdapter } = require('../../src/platform/persistence/sqlite-state-adapter');
const { SCENARIOS, buildScenario } = require('./scenarios');

// A capability for one directory allocated here, never an arbitrary profile path.
const ownedProfiles = new WeakMap();
const fileKey = file => {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('fixture-path-replaced');
  return `${stat.dev}:${stat.ino}`;
};
function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function assertOwned(profile) {
  const owned = ownedProfiles.get(profile);
  if (!owned) throw new Error('fixture-profile-not-owned');
  for (const [directory, key] of owned.directories) {
    if (!fs.lstatSync(directory).isDirectory() || fileKey(directory) !== key
      || fs.realpathSync(directory) !== directory) throw new Error('fixture-path-replaced');
  }
  return owned;
}
function assertAuthority(profile, owned) {
  for (const [file, key] of owned.authorities) {
    if (!fs.existsSync(file)) throw new Error('fixture-authority-missing');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || fileKey(file) !== key) throw new Error('fixture-authority-replaced');
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = statIfPresent(file + suffix);
      if (!sidecar) continue;
      if (!sidecar.isFile() || sidecar.nlink !== 1) throw new Error('fixture-sidecar-invalid');
    }
  }
  if (statIfPresent(path.join(profile.userDataPath, 'config.json'))) throw new Error('fixture-json-authority-forbidden');
  if (hash(owned.identityPath) !== owned.identityHash) throw new Error('fixture-identity-changed');
}

function createDisposableProfile(options = {}, { repositoryFactory = createSqliteStateAdapter } = {}) {
  const { scenario = 'all', purpose = 'bench', now = Date.now() } = options;
  if (Object.keys(options).some(key => !['scenario', 'purpose', 'now'].includes(key))) throw new TypeError('fixture-options-invalid');
  if (!SCENARIOS.includes(scenario) || !['bench', 'install'].includes(purpose)
    || !Number.isSafeInteger(now) || now < 0) throw new TypeError('fixture-options-invalid');
  const initial = buildScenario(scenario, now);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `bubu-${purpose}-`)));
  const userDataPath = path.join(root, 'profile-dev');
  fs.mkdirSync(userDataPath);
  const repository = repositoryFactory({ userDataPath, now: () => now });
  let revision;
  try {
    repository.commit(initial, { now });
    revision = repository.revision();
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('fixture-revision-invalid');
  } finally {
    // A failed commit or close must never hand the profile to another owner.
    repository.close();
  }
  const identityPath = path.join(userDataPath, 'config.sqlite.identity.sqlite');
  const profile = Object.freeze({ root, userDataPath, scenario, initial: structuredClone(initial), revision });
  const owned = {
    directories: [root, userDataPath].map(directory => [directory, fileKey(directory)]),
    authorities: [path.join(userDataPath, 'config.sqlite'), identityPath].map(file => [file, fileKey(file)]),
    identityPath, identityHash: hash(identityPath), now
  };
  ownedProfiles.set(profile, owned);
  assertAuthority(profile, owned);
  return profile;
}

function admitCopiedAuthority(profile, owned, repositoryFactory) {
  // SQLite may update SHM read marks even on a read-only connection. Admit an
  // exact closed-profile copy first, so refusal cannot alter the source bytes.
  // The copy is never substituted for the application's persisted authority.
  const probePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-admission-'));
  const captured = [];
  try {
    for (const [file] of owned.authorities) for (const suffix of ['', '-wal', '-shm']) {
      const source = file + suffix;
      if (!fs.existsSync(source)) { captured.push([source, null]); continue; }
      const content = fs.readFileSync(source);
      captured.push([source, createHash('sha256').update(content).digest('hex')]);
      fs.writeFileSync(path.join(probePath, path.basename(source)), content, { flag: 'wx', mode: 0o600 });
    }
    const probe = repositoryFactory({ userDataPath: probePath, now: () => owned.now });
    try { probe.snapshot(); } finally { probe.close(); }
    assertAuthority(profile, owned);
    for (const [file, digest] of captured) {
      const actual = fs.existsSync(file) ? hash(file) : null;
      if (actual !== digest) throw new Error('fixture-authority-changed-during-read');
    }
  } finally { fs.rmSync(probePath, { recursive: true, force: true }); }
}

// Call only after the application owner has closed. Missing data is an error,
// never permission to create another authority or normalize a historical profile.
function readDisposableProfile(profile, { repositoryFactory = createSqliteStateAdapter } = {}) {
  const owned = assertOwned(profile);
  assertAuthority(profile, owned);
  admitCopiedAuthority(profile, owned, repositoryFactory);
  const repository = repositoryFactory({ userDataPath: profile.userDataPath, now: () => owned.now });
  try {
    const state = repository.snapshot();
    const revision = repository.revision();
    if (revision < profile.revision) throw new Error('fixture-revision-regressed');
    return { state, revision };
  } finally { repository.close(); }
}

function removeDisposableProfile(profile) {
  assertOwned(profile);
  fs.rmSync(profile.root, { recursive: true, force: true });
  ownedProfiles.delete(profile);
}

module.exports = { createDisposableProfile, readDisposableProfile, removeDisposableProfile };
