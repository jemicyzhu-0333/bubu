'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inspectProfileUpgradeBackup } = require('./profile-upgrade-backup-container');
const { verifyWindowsProbePermissions } = require('./config-admission-permissions');
const { hashBytes } = require('./config-authority-schema');
const fail = reason => Object.assign(new Error(`config-upgrade-restore-${reason}`), { code: `config-upgrade-restore-${reason}` });
function rejectLinkedAncestors(target, io) {
  let current = path.resolve(target);
  while (true) {
    const stat = io.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('destination-invalid');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
// Explicit offline extraction creates a new profile only. It never overlays the
// live authority, chooses a replacement profile, deletes data, or decrypts keys.
function extractProfileUpgradeBackup({ backupFile, destination, io = fs, platform = process.platform,
  verifyWindows = verifyWindowsProbePermissions } = {}, { driver, makeHandle }) {
  if (typeof backupFile !== 'string' || typeof destination !== 'string' || !path.isAbsolute(destination)) throw fail('options-invalid');
  const target = path.resolve(destination), source = path.resolve(backupFile);
  if (io.existsSync(target) || target === path.dirname(source) || target.startsWith(path.dirname(source) + path.sep)) throw fail('destination-exists');
  rejectLinkedAncestors(path.dirname(target), io);
  for (const suffix of ['', '-wal', '-shm']) {
    const file = source + suffix;
    if (io.existsSync(file) && !io.lstatSync(file).isFile()) throw fail('backup-invalid');
  }
  const reader = makeHandle(driver.open(source, { readOnly: true }));
  try {
    const checked = inspectProfileUpgradeBackup(reader);
    if (checked.verificationCount < 1) throw fail('backup-unverified');
    const owned = new Map();
    function verify(directory, file) {
      const members = file ? [directory, file] : [directory];
      for (const member of members) {
        const stat = io.lstatSync(member, { bigint: true });
        if ((member === directory ? !stat.isDirectory() : !stat.isFile())
          || platform !== 'win32' && (stat.mode & 0o077n) !== 0n) throw fail('permissions');
      }
      if (platform === 'win32') verifyWindows(directory, file ? [file] : []);
    }
    function checkOwned() {
      for (const [directory, before] of owned) {
        const after = io.lstatSync(directory, { bigint: true });
        if (!after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) throw fail('destination-drift');
      }
    }
    for (const entry of checked.manifest.entries) {
      checkOwned();
      const output = path.join(target, ...entry.relative_path.split('/'));
      if (entry.kind === 'directory') {
        io.mkdirSync(output, { mode: 0o700 }); verify(output);
        owned.set(output, io.lstatSync(output, { bigint: true }));
      } else {
        const bytes = Buffer.from(reader.get('SELECT bytes FROM upgrade_files WHERE relative_path=?', [entry.relative_path]).bytes);
        if (hashBytes(bytes) !== entry.sha256) throw fail('backup-changed');
        const fd = io.openSync(output, 'wx', 0o600);
        try {
          verify(path.dirname(output), output);
          io.writeFileSync(fd, bytes); io.fsyncSync(fd);
          if (!io.readFileSync(output).equals(bytes)) throw fail('readback');
          verify(path.dirname(output), output);
        } finally { io.closeSync(fd); }
      }
      checkOwned();
    }
    return Object.freeze({ status: 'extracted', destination: target, sourceVersion: 18,
      requiresOfflineReview: true, omittedRuntimeLocks: [...checked.manifest.omittedRuntimeLocks] });
  } finally { reader.close(); }
}
module.exports = { extractProfileUpgradeBackup };
