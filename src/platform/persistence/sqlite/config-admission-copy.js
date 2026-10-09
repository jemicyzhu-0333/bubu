'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyProbePermissions } = require('./config-admission-permissions');
const { readIdentity } = require('./config-authority-identity');
const { readAuthoritySnapshot, verifyEvidence } = require('./config-authority-schema');

// An admission probe, not a backup/restore service. The caller owns the profile's
// instance lock and must keep the source quiescent (ARCHITECTURE「持久化与迁移」).
const MAX_ADMISSION_BYTES = 512 * 1024 * 1024;
const suffixes = ['', '-wal', '-shm'];
const fail = reason => Object.assign(new Error(reason), { code: reason });
const sameFile = (a, b) => a && b && ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const sameDirectory = (a, b) => a && b && a.isDirectory() && b.isDirectory() && a.dev === b.dev && a.ino === b.ino;
function stat(io, target) {
  try { return io.lstatSync(target, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function regular(io, target) {
  const value = stat(io, target);
  if (value && !value.isFile()) throw fail('config-admission-file-invalid');
  return value;
}
function readBytes(io, target, expected, consume = () => {}) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const fd = io.openSync(target, flags);
  try {
    if (!sameFile(expected, io.fstatSync(fd, { bigint: true }))) throw fail('config-admission-source-drift');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < Number(expected.size)) {
      const count = io.readSync(fd, buffer, 0, Math.min(buffer.length, Number(expected.size) - position), position);
      if (count <= 0) throw fail('config-admission-source-drift');
      const chunk = buffer.subarray(0, count); hash.update(chunk); consume(chunk); position += count;
    }
    if (!sameFile(expected, io.fstatSync(fd, { bigint: true })) || !sameFile(expected, regular(io, target))) {
      throw fail('config-admission-source-drift');
    }
    return hash.digest('hex');
  } finally { io.closeSync(fd); }
}
function copyMember(io, member, destination, fd, empty) {
  if (!sameFile(empty, io.fstatSync(fd, { bigint: true })) || !sameFile(empty, regular(io, destination))) {
    throw fail('config-admission-copy-failed');
  }
  member.hash = readBytes(io, member.source, member.stat, chunk => {
    let written = 0;
    while (written < chunk.length) {
      const count = io.writeSync(fd, chunk, written, chunk.length - written);
      if (count <= 0) throw fail('config-admission-copy-failed');
      written += count;
    }
  });
  const copied = regular(io, destination);
  if (!copied || (process.platform !== 'win32' && (copied.mode & 0o077n) !== 0n)
    || copied.size !== member.stat.size || readBytes(io, destination, copied) !== member.hash) {
    throw fail('config-admission-copy-failed');
  }
}
function closeAllocated(io, allocated) {
  let failed = false;
  for (const item of allocated) if (item.fd !== undefined) {
    try { io.closeSync(item.fd); item.fd = undefined; } catch (_) { failed = true; }
  }
  if (failed) throw fail('config-admission-cleanup-failed');
}
function cleanProbe(io, directory, owned, names) {
  // Before identity is known, only try removing the newly allocated empty
  // directory. Never unlink entries or recursively remove an unverified path.
  if (!owned) {
    try { io.rmdirSync(directory); return; } catch (_) { throw fail('config-admission-cleanup-failed'); }
  }
  const checkOwned = () => {
    if (!sameDirectory(owned, stat(io, directory))) throw fail('config-admission-cleanup-failed');
  };
  try {
    checkOwned();
    if (io.readdirSync(directory).some(name => !names.includes(name))) throw fail('config-admission-cleanup-failed');
    for (const name of names) {
      checkOwned();
      const target = path.join(directory, name), member = stat(io, target);
      if (member) {
        if (!member.isFile()) throw fail('config-admission-cleanup-failed');
        io.unlinkSync(target);
      }
      checkOwned();
    }
    checkOwned(); io.rmdirSync(directory);
  } catch (_) { throw fail('config-admission-cleanup-failed'); }
}

function validateProbe({ filePath, identityPath, io, driver, makeHandle, prepareInitial, validateCurrent }) {
  const identity = readIdentity({ identityPath, io, driver, makeHandle });
  const anyMain = suffixes.some(suffix => io.existsSync(filePath + suffix)), present = io.existsSync(filePath);
  if (!identity) throw fail('config-identity-missing');
  if ((!present && anyMain) || (identity.phase === 'READY' && !present)) throw fail('config-authority-missing');
  let startup;
  if (present) {
    const handle = makeHandle(driver.open(filePath, { readOnly: true }));
    try {
      startup = readAuthoritySnapshot(handle, identity, { allowEmpty: identity.phase === 'INITIALIZING' });
      if (startup) verifyEvidence(handle, identity);
    } finally { handle.close(); }
  }
  if (startup) { validateCurrent(startup); return null; }
  if (identity.phase !== 'INITIALIZING') throw fail('config-authority-uninitialized');
  const initial = prepareInitial();
  if (initial.source.exists !== identity.sourceExists || initial.source.hash !== identity.sourceHash
    || initial.source.bytes.length !== identity.sourceLength) throw fail('config-import-source-conflict');
  validateCurrent({ state: initial.state, payloadVersion: initial.state.schemaVersion });
  return initial;
}
function admitConfigCopy({ filePath, identityPath, io = fs, prepareInitial, validateCurrent }, { driver, makeHandle, verifyPermissions = verifyProbePermissions }) {
  const members = [filePath, identityPath].flatMap((source, index) => suffixes.map(suffix => ({
    source: source + suffix, index, suffix, stat: regular(io, source + suffix)
  })));
  if (!members.some(member => member.stat)) return null;
  const bytes = members.reduce((total, member) => total + (member.stat?.size || 0n), 0n);
  if (bytes > BigInt(MAX_ADMISSION_BYTES)) throw fail('config-admission-capacity');
  const directories = [...new Set(members.map(member => path.dirname(member.source)))].map(target => ({ target, stat: stat(io, target) }));
  if (directories.some(item => !item.stat?.isDirectory())) throw fail('config-admission-file-invalid');
  const directory = io.mkdtempSync(path.join(os.tmpdir(), 'focuspix-config-admission-'));
  // Distinct probe basenames also prevent cleanup paths from naming either
  // original tuple if a faulty actor substitutes its directory with the source.
  let prefix = path.basename(directory);
  const sourceNames = new Set(members.map(member => path.basename(member.source)));
  while (members.some(member => sourceNames.has(`${prefix}-${member.index}.sqlite${member.suffix}`))) prefix += '-probe';
  for (const member of members) member.name = `${prefix}-${member.index}.sqlite${member.suffix}`;
  let initial, owned;
  const allocated = [];
  try {
    owned = stat(io, directory);
    if (!owned?.isDirectory() || (process.platform !== 'win32' && (owned.mode & 0o077n) !== 0n)) throw fail('config-admission-file-invalid');
    verifyPermissions(directory, [], { io });
    // Validate actual empty-file DACLs before copying private bytes: a safe
    // directory without inheritable ACEs need not imply a safe token default.
    for (const member of members) if (member.stat) {
      const destination = path.join(directory, member.name), fd = io.openSync(destination, 'wx', 0o600);
      const item = { member, destination, fd }; allocated.push(item);
      item.empty = io.fstatSync(fd, { bigint: true });
    }
    const copiedPaths = allocated.map(item => item.destination);
    verifyPermissions(directory, copiedPaths, { io });
    for (const item of allocated) copyMember(io, item.member, item.destination, item.fd, item.empty);
    closeAllocated(io, allocated);
    verifyPermissions(directory, copiedPaths, { io });
    initial = validateProbe({ filePath: path.join(directory, members[0].name), identityPath: path.join(directory, members[3].name),
      io, driver, makeHandle, prepareInitial, validateCurrent });
  } finally {
    try { closeAllocated(io, allocated); }
    finally { cleanProbe(io, directory, owned, members.map(member => member.name)); }
  }
  // This detects observed drift; it is not a lock or a transactional snapshot of
  // an external writer. Never restore source sidecars to make this check pass.
  for (const item of directories) if (!sameDirectory(item.stat, stat(io, item.target))) throw fail('config-admission-source-drift');
  for (const member of members) {
    const current = regular(io, member.source);
    if (!member.stat && !current) continue;
    if (!sameFile(member.stat, current) || readBytes(io, member.source, member.stat) !== member.hash) throw fail('config-admission-source-drift');
  }
  return initial;
}
module.exports = { admitConfigCopy, MAX_ADMISSION_BYTES };
