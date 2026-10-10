'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseRuntimeJson } = require('./config-runtime-json');
const { inspectWindowsRuntimeTree, validateRuntimeTree } = require('./config-runtime-file-types');

// Electron 44.4.5, native Windows minimal/default-path fixture, run 38077986741.
// This is an exact runtime layout exception, not a generic cache-name whitelist.
// Local Storage, Network, Preferences, unknown files and business/credential
// stores are deliberately absent. Existing branded profiles never use this gate.
const TOP = ['GPUPersistentCache', 'GrShaderCache', 'Local State', 'ShaderCache'];
const same = (left, right) => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function validRuntimeState(value) {
  if (!exactKeys(value, ['os_crypt', 'uninstall_metrics'])
    || !exactKeys(value.os_crypt, ['audit_enabled', 'encrypted_key'])
    || typeof value.os_crypt.audit_enabled !== 'boolean'
    || !exactKeys(value.uninstall_metrics, ['installation_date2'])
    || typeof value.uninstall_metrics.installation_date2 !== 'string'
    || !/^\d{1,20}$/.test(value.uninstall_metrics.installation_date2)) return false;
  const key = value.os_crypt.encrypted_key;
  // Only bounded encoding shape. This does not authenticate DPAPI ownership or
  // decryptability, and is never BUBU identity evidence. Electron retains its
  // existing Local State/OSCrypt path; no key is copied, logged, or migrated.
  return typeof key === 'string' && key.length >= 16 && key.length <= 8192
    && /^[A-Za-z0-9+/]+={0,2}$/.test(key) && Buffer.from(key, 'base64').toString('base64') === key;
}
function expectedKind(relative) {
  if (relative === '') return 'directory';
  if (relative === 'Local State' || relative === 'lockfile') return 'file';
  if (['GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'GPUPersistentCache/DawnGraphiteCache'].includes(relative)) return 'directory';
  if (/^GPUPersistentCache\/DawnGraphiteCache\/[A-Z2-7]{32}$/.test(relative)) return 'directory';
  if (/^GPUPersistentCache\/DawnGraphiteCache\/[A-Z2-7]{32}\/(cache\.db|cache\.db-wal|cache\.journal)$/.test(relative)) return 'file';
  if (/^(GrShaderCache|ShaderCache)\/(index|data_[0-3])$/.test(relative)) return 'file';
  return null;
}
function readState(io, record) {
  if (record.stat.size === 0n || record.stat.size > 65536n) return null;
  const fd = io.openSync(record.target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    if (!same(record.stat, io.fstatSync(fd, { bigint: true }))) return null;
    const bytes = Buffer.alloc(Number(record.stat.size)); let offset = 0;
    while (offset < bytes.length) {
      const count = io.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) return null;
      offset += count;
    }
    if (!same(record.stat, io.fstatSync(fd, { bigint: true }))) return null;
    return parseRuntimeJson(bytes);
  } finally { io.closeSync(fd); }
}

function runtimeTopNames(names) {
  return names.filter(name => name !== 'lockfile').sort().join(',') === TOP.join(',');
}
function admitsWindowsRuntimeCache(directory, { io = fs, platform = process.platform, inspectRuntimeTree = inspectWindowsRuntimeTree } = {}) {
  if (platform !== 'win32') return false;
  // Native enumeration checks reparse attributes before descending. Its output
  // is only metadata; independently verify all Node identities and membership.
  const entries = validateRuntimeTree({ entries: inspectRuntimeTree(directory) });
  try {
    const records = [], children = new Map(); let totalBytes = 0n;
    for (const entry of entries) {
      if (expectedKind(entry.relativePath) !== entry.kind) return false;
      const target = path.resolve(directory, ...entry.relativePath.split('/'));
      const stat = io.lstatSync(target, { bigint: true });
      if (stat.isSymbolicLink() || (entry.kind === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) return false;
      if (entry.kind === 'file') totalBytes += stat.size;
      if (totalBytes > 64n * 1024n * 1024n || (entry.relativePath === 'lockfile' && stat.size !== 0n)) return false;
      records.push({ ...entry, target, stat });
      if (entry.kind === 'directory') children.set(entry.relativePath, []);
      if (entry.relativePath) {
        const parent = path.posix.dirname(entry.relativePath);
        children.get(parent === '.' ? '' : parent).push(path.posix.basename(entry.relativePath));
      }
    }
    const top = children.get('').filter(name => name !== 'lockfile').sort();
    if (!runtimeTopNames(top)) return false;
    function unchanged() {
      return records.every(record => {
        const after = io.lstatSync(record.target, { bigint: true });
        if (!same(record.stat, after)) return false;
        return record.kind !== 'directory'
          || io.readdirSync(record.target).sort().join('\0') === children.get(record.relativePath).sort().join('\0');
      });
    }
    if (!unchanged()) return false;
    const state = readState(io, records.find(record => record.relativePath === 'Local State'));
    return validRuntimeState(state) && unchanged();
  } catch (_) { return false; }
}

module.exports = { admitsWindowsRuntimeCache, validRuntimeState, expectedKind, runtimeTopNames };
