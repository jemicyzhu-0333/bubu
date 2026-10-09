'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { facts, inspect, seed, tracedFactory, fixture } = require('../test-support/config-admission-fixture');
const kinds = ['old17', 'future19', 'malformed18', 'wrong-application', 'wrong-identity', 'invalid-evidence'];
const modes = ['closed-clean', 'live-unwarmed', 'live-warmed', 'unclean-exit', 'unclean-no-shm'];
function seedMode(f, kind, mode) {
  if (mode.startsWith('unclean')) {
    const script = `require(${JSON.stringify(require.resolve('../test-support/config-admission-fixture'))}).seed(process.argv[1], process.argv[2], 'unclean-exit'); process.exit(0);`;
    const child = spawnSync(process.execPath, ['-e', script, f.directory, kind], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    if (mode === 'unclean-no-shm') for (const name of fs.readdirSync(f.directory)) if (name.endsWith('-shm')) fs.unlinkSync(path.join(f.directory, name));
  } else f.retain(seed(f.directory, kind, mode));
}
function refused(f, options = {}) {
  const before = f.capture(), beforeFacts = facts(before), events = [];
  let normalizeCalls = 0, migrationCalls = 0;
  assert.throws(() => f.open({ normalize() { normalizeCalls++; throw new Error('must not normalize'); },
    migration: { prepareStoreMigration() { migrationCalls++; }, detectCurrentSchemaMigration() { migrationCalls++; },
      prepareCurrentSchemaMigrationBackup() { migrationCalls++; } }, authorityFactory: tracedFactory(events), ...options }));
  const after = f.capture();
  assert.deepEqual(Object.keys(after), Object.keys(before), 'original tuple membership survives refusal');
  for (const name of Object.keys(before)) assert.ok(after[name].equals(before[name]), `${name} bytes survive refusal`);
  assert.deepEqual(facts(after), beforeFacts, 'original logical state, proof, identity and evidence survive refusal');
  assert.equal(normalizeCalls, 0); assert.equal(migrationCalls, 0);
  assert.ok(events.every(event => event.kind === 'open' && event.readOnly), 'copies use only read-only validation');
  assert.ok(events.every(event => path.dirname(event.filePath) !== f.directory), 'neither original is opened by SQLite');
}
for (const mode of modes) for (const kind of kinds) test(`copied admission preserves ${mode} ${kind}`, t => {
  const f = fixture(t); seedMode(f, kind, mode); refused(f);
});
for (const kind of ['missing-main', 'missing-identity', 'corrupt-main', 'corrupt-identity', 'orphan-main-wal', 'orphan-identity-shm']) {
  test(`incomplete or corrupt tuple refuses without touching ${kind}`, t => {
    const f = fixture(t); seed(f.directory);
    if (kind.startsWith('orphan')) {
      for (const name of fs.readdirSync(f.directory)) fs.unlinkSync(path.join(f.directory, name));
      fs.writeFileSync(kind === 'orphan-main-wal' ? `${f.database}-wal` : `${f.identity}-shm`, 'retained');
    } else {
      const target = kind.endsWith('main') ? f.database : f.identity;
      if (kind.startsWith('missing')) fs.unlinkSync(target); else fs.writeFileSync(target, 'corrupt retained bytes');
    }
    refused(f);
  });
}
test('committed old17 in WAL must not be masked by the valid18 main file', t => {
  const f = fixture(t); seedMode(f, 'old17', 'unclean-exit');
  const before = f.capture();
  const version = bytes => inspect(bytes, directory => {
    const db = new DatabaseSync(path.join(directory, 'config.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT payload_version FROM config_snapshot').get().payload_version; } finally { db.close(); }
  });
  assert.equal(version(before), 17);
  assert.equal(version(Object.fromEntries(Object.entries(before).filter(([name]) => !/-wal$|-shm$/.test(name)))), 18);
  refused(f);
});
for (const mode of modes) test(`valid18 ${mode} retains original and proves only once before subsequent commit/reopen`, t => {
  const f = fixture(t); seedMode(f, 'valid18', mode);
  const before = facts(f.capture()), key = fs.statSync(f.database).ino, events = [];
  const repo = f.open({ authorityFactory: tracedFactory(events) });
  assert.equal(fs.statSync(f.database).ino, key);
  assert.equal(repo.snapshot().settings.autoCheckUpdates, false);
  const after = facts(f.capture()), a = after['config.sqlite'].rows[0][0], b = before['config.sqlite'].rows[0][0];
  assert.deepEqual({ ...a, verification_count: b.verification_count }, { ...b });
  assert.equal(a.verification_count, b.verification_count + 1);
  assert.deepEqual(after['config.sqlite'].rows[1], before['config.sqlite'].rows[1]);
  assert.deepEqual(after['config.sqlite.identity.sqlite'], before['config.sqlite.identity.sqlite']);
  const proof = events.filter(event => event.sql?.startsWith('UPDATE config_snapshot SET verification_count='));
  assert.equal(proof.length, 1); assert.equal(proof[0].filePath, f.database);
  assert.ok(events.filter(event => path.dirname(event.filePath) !== f.directory).every(event => event.kind === 'open' && event.readOnly));
  const revision = repo.revision(); repo.update(state => { state.settings.autoCheckUpdates = true; }); repo.close();
  const next = f.open(); assert.equal(next.revision(), revision + 1); assert.equal(next.snapshot().settings.autoCheckUpdates, true); next.close();
  assert.equal(fs.existsSync(path.join(f.directory, 'config.json')), false);
});
