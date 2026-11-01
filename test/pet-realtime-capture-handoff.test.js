'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCaptureHandoff, consumeCaptureHandoff, assertCaptureOwnership } = require('../tools/pet-realtime-capture/handoff.cjs');
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-rt-')));
  fs.chmodSync(directory, 0o700);
  const root = path.join(directory, 'fixture'), userDataPath = path.join(root, 'profile-dev');
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(userDataPath, { mode: 0o700 });
  fs.writeFileSync(path.join(userDataPath, 'config.sqlite'), 'synthetic-schema20-only');
  fs.writeFileSync(path.join(userDataPath, 'config.sqlite.identity.sqlite'), 'synthetic-BUBU-identity-only');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, root, userDataPath, options: { runDirectory: directory, runId: 'capture-test-run',
    profileProof: { root, userDataPath, initial: { private: 'NEVER-SERIALIZE' } }, source: { commit: 'a'.repeat(40) }, screenshots: true } };
}
function issue(t) { const f = fixture(t); return { ...f, handoff: createCaptureHandoff(f.options) }; }
function rewriteMarker(f, edit, authenticate = false) {
  const file = path.join(f.directory, 'launch.json'), marker = JSON.parse(fs.readFileSync(file)); edit(marker);
  if (authenticate) { const { hmac, ...body } = marker; marker.hmac = crypto.createHmac('sha256', Buffer.from(f.handoff.token, 'hex')).update(JSON.stringify(body)).digest('hex'); }
  fs.writeFileSync(file, JSON.stringify(marker));
}

test('authenticated capture handoff derives its profile and consumes exactly once', t => {
  const f = issue(t), requestBytes = fs.readFileSync(f.handoff.requestFile, 'utf8');
  assert.match(f.handoff.token, /^[a-f0-9]{64}$/);
  for (const file of ['request.json', 'launch.json']) {
    const text = fs.readFileSync(path.join(f.directory, file), 'utf8');
    assert.equal(text.includes(f.handoff.token), false); assert.equal(text.includes('NEVER-SERIALIZE'), false);
  }
  assert.equal(JSON.parse(requestBytes).reportFile, path.join(f.directory, 'partial.json'));
  const request = consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token);
  assert.deepEqual(request.fixture, { root: f.root, userDataPath: f.userDataPath });
  assert.equal(assertCaptureOwnership(request), true);
  assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token));
  assert.throws(() => assertCaptureOwnership({ ...request }), /capture-handoff/);
  assert.equal(fs.existsSync(path.join(f.directory, 'launch.json')), false);
  assert.equal(fs.existsSync(path.join(f.directory, 'launch.claimed')), true);
  // Runtime ownership deliberately does not read SQL while the app owns it.
  fs.writeFileSync(path.join(f.userDataPath, 'config.sqlite'), 'changed-by-real-app');
  assert.equal(assertCaptureOwnership(request), true);
});
test('external supplied profile paths are rejected before filesystem access', t => {
  const f = fixture(t), native = fs.lstatSync; let touches = 0;
  fs.lstatSync = (...args) => { touches++; return native(...args); };
  try {
    assert.throws(() => createCaptureHandoff({ ...f.options, profileProof: { root: '/outside', userDataPath: '/outside/profile-dev' } }), /capture-handoff/);
    assert.equal(touches, 0);
  } finally { fs.lstatSync = native; }
});
test('request tampering, wrong tokens, and renamed entrypoints fail without consuming the marker', t => {
  const f = issue(t);
  assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, '0'.repeat(64)), /capture-handoff/);
  assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, 'bad'), /capture-handoff/);
  assert.throws(() => consumeCaptureHandoff(path.join(f.directory, 'foreign.json'), f.handoff.token), /capture-handoff/);
  const request = JSON.parse(fs.readFileSync(f.handoff.requestFile)); request.screenshots = false;
  fs.writeFileSync(f.handoff.requestFile, JSON.stringify(request));
  assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token), /capture-handoff/);
  assert.equal(fs.existsSync(path.join(f.directory, 'launch.json')), true);
});
test('a forged inode remains rejected even with a correctly recomputed message MAC', t => {
  const f = issue(t); rewriteMarker(f, marker => { marker.directories.profile.ino = '0'; }, true);
  assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token), /capture-handoff/);
});
test('changed or missing DB bytes cannot borrow a valid parent launch marker', t => {
  for (const change of ['changed', 'missing']) {
    const f = issue(t), file = path.join(f.userDataPath, 'config.sqlite');
    if (change === 'changed') fs.writeFileSync(file, 'different'); else fs.unlinkSync(file);
    assert.throws(() => consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token));
  }
});
test('credential files are rejected before main and on future ownership checks', t => {
  const f = fixture(t), credential = path.join(f.userDataPath, 'ai-credential.bin');
  fs.writeFileSync(credential, 'synthetic-secret-not-read'); assert.throws(() => createCaptureHandoff(f.options), /capture-handoff/);
  fs.unlinkSync(credential); const handoff = createCaptureHandoff(f.options);
  fs.writeFileSync(credential, 'synthetic-secret-not-read'); assert.throws(() => consumeCaptureHandoff(handoff.requestFile, handoff.token), /capture-handoff/);
  fs.unlinkSync(credential); const request = consumeCaptureHandoff(handoff.requestFile, handoff.token);
  fs.writeFileSync(credential, 'synthetic-secret-not-read'); assert.throws(() => assertCaptureOwnership(request), /capture-handoff/);
});
test('replacement profile directories fail both initial and runtime inode ownership', t => {
  for (const afterConsume of [false, true]) {
    const f = issue(t), request = afterConsume ? consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token) : null;
    fs.renameSync(f.userDataPath, path.join(f.root, 'old-profile'));
    fs.mkdirSync(f.userDataPath); fs.writeFileSync(path.join(f.userDataPath, 'config.sqlite'), 'synthetic-schema20-only');
    fs.writeFileSync(path.join(f.userDataPath, 'config.sqlite.identity.sqlite'), 'synthetic-BUBU-identity-only');
    assert.throws(() => afterConsume ? assertCaptureOwnership(request) : consumeCaptureHandoff(f.handoff.requestFile, f.handoff.token), /capture-handoff/);
  }
});
test('symlinked entry, linked database and unsafe root mode are rejected', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), db = path.join(f.userDataPath, 'config.sqlite');
  fs.linkSync(db, path.join(f.directory, 'db-link')); assert.throws(() => createCaptureHandoff(f.options), /capture-handoff/);
  fs.unlinkSync(path.join(f.directory, 'db-link')); fs.chmodSync(f.directory, 0o755);
  assert.throws(() => createCaptureHandoff(f.options), /capture-handoff/); fs.chmodSync(f.directory, 0o700);
  const h = createCaptureHandoff(f.options); fs.renameSync(h.requestFile, path.join(f.directory, 'real-request.json'));
  fs.symlinkSync(path.join(f.directory, 'real-request.json'), h.requestFile);
  assert.throws(() => consumeCaptureHandoff(h.requestFile, h.token), /capture-handoff/);
});
test('request, marker and database input sizes stay bounded', t => {
  const f = fixture(t); assert.throws(() => createCaptureHandoff({ ...f.options, source: { data: 'x'.repeat(65536) } }), /capture-handoff/);
  fs.writeFileSync(path.join(f.userDataPath, 'config.sqlite'), Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => createCaptureHandoff(f.options), /capture-handoff/);
});
