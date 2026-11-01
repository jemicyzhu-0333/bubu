'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const owners = new WeakMap();
const FIXTURE = Object.freeze({ scenario: 'realtime-capture', schemaVersion: 20,
  noAI: true, noCredential: true, emptyBusiness: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('capture-handoff-rejected'); };
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mac = (token, value) => crypto.createHmac('sha256', Buffer.from(token, 'hex')).update(JSON.stringify(value)).digest('hex');
function paths(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
    || !/^bubu-rt-[A-Za-z0-9_-]{6,}$/.test(path.basename(directory))) fail();
  return { directory, fixture: path.join(directory, 'fixture'), profile: path.join(directory, 'fixture/profile-dev'),
    request: path.join(directory, 'request.json'), launch: path.join(directory, 'launch.json'),
    claimed: path.join(directory, 'launch.claimed'), report: path.join(directory, 'partial.json') };
}
function directoryIdentity(file, privateMode = false) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || privateMode && process.platform !== 'win32' && (Number(stat.mode) & 0o077)) fail();
  return identity(stat);
}
function rootIdentity(p) {
  const parsed = path.parse(p.directory); let cursor = parsed.root;
  for (const part of p.directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); directoryIdentity(cursor, cursor === p.directory);
  }
  if (fs.realpathSync(p.directory) !== p.directory) fail();
  return { run: directoryIdentity(p.directory, true), fixture: directoryIdentity(p.fixture), profile: directoryIdentity(p.profile) };
}
function readRegular(file, limit, privateMode = false) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(limit)
    || privateMode && process.platform !== 'win32' && (Number(before.mode) & 0o077)) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!same(identity(before), identity(opened)) || opened.size !== before.size || opened.nlink !== 1n) fail();
    const bytes = Buffer.alloc(limit + 1); let at = 0;
    while (at < bytes.length) { const size = fs.readSync(fd, bytes, at, bytes.length - at, at); if (!size) break; at += size; }
    const after = fs.fstatSync(fd, { bigint: true });
    if (at > limit || BigInt(at) !== before.size || !same(identity(before), identity(after)) || after.size !== before.size
      || after.nlink !== 1n || privateMode && process.platform !== 'win32' && (Number(after.mode) & 0o077)) fail();
    return { bytes: bytes.subarray(0, at), identity: identity(before), sha256: hash(bytes.subarray(0, at)) };
  } finally { fs.closeSync(fd); }
}
function assertNoCredential(p) {
  try { fs.lstatSync(path.join(p.profile, 'ai-credential.bin')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail();
}
function databaseIdentity(p) {
  return Object.fromEntries(['config.sqlite', 'config.sqlite.identity.sqlite'].map(name => {
    const file = readRegular(path.join(p.profile, name), 2 * 1024 * 1024);
    return [name, { ...file.identity, bytes: file.bytes.length, sha256: file.sha256 }];
  }));
}
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail();
}
function parse(bytes) { try { return JSON.parse(bytes); } catch { fail(); } }
function validateRequest(request, p) {
  closed(request, ['runId', 'fixture', 'reportFile', 'source', 'screenshots']);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(request.runId) || request.reportFile !== p.report
    || typeof request.screenshots !== 'boolean' || !request.source || typeof request.source !== 'object' || Array.isArray(request.source)) fail();
  closed(request.fixture, ['root', 'userDataPath']);
  if (request.fixture.root !== p.fixture || request.fixture.userDataPath !== p.profile) fail();
}
function createCaptureHandoff({ runDirectory, runId, profileProof, source, screenshots } = {}) {
  const p = paths(runDirectory);
  // Reject caller-supplied external paths before any path from that proof is accessed.
  if (profileProof?.root !== p.fixture || profileProof?.userDataPath !== p.profile) fail();
  const request = { runId, fixture: { root: p.fixture, userDataPath: p.profile }, reportFile: p.report, source, screenshots };
  validateRequest(request, p);
  const bytes = Buffer.from(JSON.stringify(request)); if (bytes.length > 65536) fail();
  const directories = rootIdentity(p); assertNoCredential(p);
  const token = crypto.randomBytes(32).toString('hex');
  const body = { version: 1, runId, requestSHA256: hash(bytes), fixtureIdentity: FIXTURE,
    directories, databases: databaseIdentity(p) };
  const marker = Buffer.from(JSON.stringify({ ...body, hmac: mac(token, body) }));
  fs.writeFileSync(p.request, bytes, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(p.launch, marker, { flag: 'wx', mode: 0o600 });
  return Object.freeze({ requestFile: p.request, reportFile: p.report, token });
}
function consumeCaptureHandoff(requestFile, token) {
  if (typeof requestFile !== 'string' || path.basename(requestFile) !== 'request.json'
    || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail();
  const p = paths(path.dirname(requestFile)); if (requestFile !== p.request) fail();
  const directories = rootIdentity(p);
  const requestFileData = readRegular(p.request, 65536, true), request = parse(requestFileData.bytes);
  validateRequest(request, p); assertNoCredential(p);
  const marker = readRegular(p.launch, 16384, true), document = parse(marker.bytes);
  closed(document, ['version', 'runId', 'requestSHA256', 'fixtureIdentity', 'directories', 'databases', 'hmac']);
  const { hmac, ...body } = document;
  if (typeof hmac !== 'string' || !/^[a-f0-9]{64}$/.test(hmac)
    || !crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(mac(token, body), 'hex'))
    || document.version !== 1 || document.runId !== request.runId || document.requestSHA256 !== requestFileData.sha256
    || !same(document.fixtureIdentity, FIXTURE) || !same(document.directories, directories)
    || !same(document.databases, databaseIdentity(p))) fail();
  // link is an exclusive atomic one-time claim; an existing claim is never replaced.
  fs.linkSync(p.launch, p.claimed); fs.unlinkSync(p.launch);
  const claimed = readRegular(p.claimed, 16384, true);
  if (claimed.sha256 !== marker.sha256 || !same(claimed.identity, marker.identity)) fail();
  Object.freeze(request.fixture); Object.freeze(request);
  owners.set(request, { paths: p, directories, claim: claimed });
  return request;
}
function assertCaptureOwnership(request) {
  const owner = owners.get(request); if (!owner) fail();
  const p = owner.paths;
  if (!same(rootIdentity(p), owner.directories)) fail();
  assertNoCredential(p);
  const marker = readRegular(p.claimed, 16384, true);
  if (!same(marker.identity, owner.claim.identity) || marker.sha256 !== owner.claim.sha256) fail();
  // No database reads here: the real application now owns and may write its SQL.
  return true;
}
module.exports = { createCaptureHandoff, consumeCaptureHandoff, assertCaptureOwnership };
