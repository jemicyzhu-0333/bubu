'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpgradeFixture, captureFiles, verifyUnchanged, verifyApproved, isRuntimeAddition } = require('../scripts/installed-upgrade-profile');
const { runUpgradeChild } = require('../scripts/verify-installed-upgrade');
const { prepareConfigPreferencesUpgrade } = require('../src/platform/persistence/sqlite/sqlite-database');
const CACHE = 'GPUPersistentCache/GPUCache/ZBVFTVEKBSX72Y7WF25TMOWFX3JUICO4/';
function fixture(t) { const f = createUpgradeFixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true })); return f; }
function write(f, name, bytes = 'synthetic runtime') {
  const file = path.join(f.userDataPath, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file;
}
test('known Electron additions preserve exact original seven files and remain in the verified backup', t => {
  const f = fixture(t), names = ['Local State', ...['cache.db', 'cache.db-wal', 'cache.journal'].map(name => CACHE + name)];
  for (const name of names) write(f, name);
  const proof = verifyUnchanged(f);
  assert.equal(proof.originals.length, 7); assert.equal(proof.originalFilesUnchanged, true);
  assert.equal(proof.authorityUnchanged, true); assert.equal(proof.schemaVersion, 18); assert.equal(proof.noBackupBeforeConsent, true);
  assert.deepEqual(proof.additions.map(item => item.path).sort(), names.sort());
  assert.equal(JSON.stringify(proof).includes('synthetic runtime'), false);
  const upgrade = prepareConfigPreferencesUpgrade({ userDataPath: f.userDataPath }); upgrade.execute(upgrade.confirmation);
  const backup = verifyApproved(f); assert.equal(backup.backupReopenedFromCopy, true);
  assert.deepEqual(backup.runtimeFilesIncludedInBackup, names.sort());
});
test('runtime classification never applies to pre-existing files, including Local State', t => {
  const f = fixture(t); write(f, 'Local State', 'original bytes'); f.before = captureFiles(f.userDataPath);
  write(f, 'Local State', 'different bytes');
  assert.throws(() => verifyUnchanged(f), /preserve source bytes and mtimes/);
});
for (const name of ['config.sqlite', 'config.sqlite-wal', 'config.sqlite-shm', 'config.sqlite.identity.sqlite',
  'config.sqlite.identity.sqlite-wal', 'config.sqlite.identity.sqlite-shm', 'nested/marker.bin']) {
  test(`recognized runtime additions cannot hide original mutation: ${name}`, t => {
    const f = fixture(t); write(f, 'Local State'); write(f, name, 'changed');
    assert.throws(() => verifyUnchanged(f), error => {
      const proof = error.preservationDiagnostic; assert.equal(proof.originalFilesUnchanged, false);
      assert.equal(proof.originals.find(item => item.path === name).bytesUnchanged, false); return true;
    });
  });
}
test('runtime classifier is anchored to specific observed file names and directory shape', () => {
  for (const name of ['other.db', 'nested/Local State', CACHE + 'config.sqlite', CACHE + 'cache.db-shm',
    'GPUPersistentCache/GPUCache/arbitrary/cache.db', 'GPUPersistentCache/other/cache.db', CACHE + 'nested/cache.db']) {
    assert.equal(isRuntimeAddition(name), false, name);
  }
});
test('unknown added file and pre-consent backup remain failures with safe evidence', t => {
  const f = fixture(t), added = write(f, 'foreign.sqlite');
  assert.throws(() => verifyUnchanged(f), error => {
    assert.equal(error.preservationDiagnostic.originalFilesUnchanged, true);
    assert.equal(error.preservationDiagnostic.additions[0].kind, 'unexpected'); return true;
  });
  fs.unlinkSync(added); fs.mkdirSync(path.join(f.root, 'unexpected.backup'));
  assert.throws(() => verifyUnchanged(f), /must not create a backup/);
});
test('failure diagnostic captures exact original evidence before cleanup and reports actual child closure', async t => {
  const f = fixture(t); let child, failed;
  await assert.rejects(runUpgradeChild('/owned/installed', f, false, {
    spawnChild() {
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => child.emit('close', null, 'SIGKILL');
      queueMicrotask(() => child.stderr.emit('data', 'Debugger listening on ws://127.0.0.1:1234/abcd-1234\n')); return child;
    },
    async connect() { return {
      async evaluate(expression) {
        if (expression.includes('calls: s.calls')) return { phase: 'confirm', error: null, calls: ['confirm'], relaunches: 0 };
        // Normal cleanup request closes this exact child without classifying it as a successful upgrade.
        queueMicrotask(() => child.emit('close', 0, null)); return true;
      }, async call() {}, close() {}
    }; },
    async intercept() { return 'owned-entry'; },
    async secondary() { write(f, 'unknown-added.sqlite'); return { secondaryNormalExit: true }; },
    async wait(completion, delay) { await Promise.resolve(); return delay >= 5000 ? completion : null; }
  }), error => { failed = error; return /unexpected file/.test(error.message); });
  assert.equal(failed.diagnostic.stage, 'consent-source-lock-retained');
  assert.equal(failed.diagnostic.childClosedAtFailure, false); assert.equal(failed.diagnostic.childClosed, true);
  assert.equal(failed.diagnostic.preCleanupSource.originals.length, 7);
  assert.equal(failed.diagnostic.preCleanupSource.originalFilesUnchanged, true);
  assert.equal(failed.diagnostic.preCleanupSource.authorityUnchanged, true);
  assert.equal(failed.diagnostic.preCleanupSource.additions[0].path, 'unknown-added.sqlite');
  assert.equal(f.childClosed, true);
});
