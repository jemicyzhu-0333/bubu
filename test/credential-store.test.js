'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecureCredentialStore } = require('../src/platform/providers');

test('AI credentials are encrypted outside canonical state and never returned by status', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuspix-credential-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: value => value.toString('utf8').replace(/^encrypted:/, '')
  };
  const store = createSecureCredentialStore({ safeStorage, userDataPath: dir });
  assert.deepEqual(store.status(), { available: true, configured: false });
  store.set('secret-key');
  assert.equal(store.get(), 'secret-key');
  assert.deepEqual(store.status(), { available: true, configured: true });
  assert.doesNotMatch(fs.readFileSync(store.filePath, 'utf8'), /^secret-key$/);
  assert.equal(fs.statSync(store.filePath).mode & 0o777, 0o600);
  assert.equal(store.clear(), true);
  assert.equal(store.get(), null);
});
