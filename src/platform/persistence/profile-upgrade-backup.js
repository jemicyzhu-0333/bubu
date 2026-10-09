'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyProbePermissions } = require('./sqlite/config-admission-permissions');
const LIMIT_BYTES = 512 * 1024 * 1024;
const LIMIT_MEMBERS = 10000;
const LOCKS = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket']);
const fail = reason => Object.assign(new Error(`config-upgrade-backup-${reason}`), { code: `config-upgrade-backup-${reason}` });
const same = (a, b) => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
function scan(root, io) {
  const entries = [], omitted = [];
  let size = 0;
  function visit(relative, depth) {
    if (depth > 32 || entries.length >= LIMIT_MEMBERS) throw fail('capacity');
    const target = path.join(root, relative), stat = io.lstatSync(target, { bigint: true });
    if (!stat.isDirectory() && !stat.isFile()) throw fail('member-invalid');
    if (!relative && !stat.isDirectory()) throw fail('member-invalid');
    const entry = { relative, stat, directory: stat.isDirectory() }; entries.push(entry);
    if (entry.directory) {
      for (const name of io.readdirSync(target).sort()) {
        if (!relative && LOCKS.has(name)) { omitted.push(name); continue; }
        visit(path.join(relative, name), depth + 1);
      }
    } else if (Number(stat.size) > 64 * 1024 * 1024 || (size += Number(stat.size)) > LIMIT_BYTES) throw fail('capacity');
  }
  visit('', 0);
  return { entries, omitted, size };
}
function readFile(io, filePath, expected, consume = () => {}) {
  const fd = io.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    if (!same(expected, io.fstatSync(fd, { bigint: true }))) throw fail('source-drift');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(expected.size)) {
      const count = io.readSync(fd, buffer, 0, Math.min(buffer.length, Number(expected.size) - offset), offset);
      if (count <= 0) throw fail('source-drift');
      const bytes = buffer.subarray(0, count); consume(bytes); hash.update(bytes); offset += count;
    }
    if (!same(expected, io.fstatSync(fd, { bigint: true })) || !same(expected, io.lstatSync(filePath, { bigint: true }))) throw fail('source-drift');
    return hash.digest('hex');
  } finally { io.closeSync(fd); }
}
function captureProfile(sourcePath, io = fs) {
  const source = scan(sourcePath, io);
  function capture(entry) {
    const parts = [];
    entry.hash = readFile(io, path.join(sourcePath, entry.relative), entry.stat, bytes => parts.push(Buffer.from(bytes)));
    return Buffer.concat(parts);
  }
  function verifySource() {
    const current = scan(sourcePath, io);
    if (current.entries.length !== source.entries.length || JSON.stringify(current.omitted) !== JSON.stringify(source.omitted)) throw fail('source-drift');
    source.entries.forEach((entry, index) => {
      const other = current.entries[index];
      if (entry.relative !== other.relative || entry.directory !== other.directory || !same(entry.stat, other.stat)
        || !entry.directory && readFile(io, path.join(sourcePath, entry.relative), entry.stat) !== entry.hash) throw fail('source-drift');
    });
  }
  return { ...source, capture, verifySource };
}
function allocatePrivateBackup(backupPath, io = fs, verifyPermissions = verifyProbePermissions) {
  io.mkdirSync(backupPath, { mode: 0o700 });
  verifyPermissions(backupPath, [], { io });
  const filePath = path.join(backupPath, 'profile-backup.sqlite');
  const fd = io.openSync(filePath, 'wx', 0o600);
  try { verifyPermissions(backupPath, [filePath], { io }); io.fsyncSync(fd); }
  finally { io.closeSync(fd); }
  const directory = io.lstatSync(backupPath, { bigint: true });
  function verifyPrivate() {
    const current = io.lstatSync(backupPath, { bigint: true });
    if (!current.isDirectory() || current.dev !== directory.dev || current.ino !== directory.ino) throw fail('destination-drift');
    const files = ['', '-wal', '-shm'].map(suffix => filePath + suffix).filter(target => io.existsSync(target));
    verifyPermissions(backupPath, files, { io });
  }
  return { filePath, verifyPrivate };
}
module.exports = { captureProfile, allocatePrivateBackup, LIMIT_BYTES, LIMIT_MEMBERS };
