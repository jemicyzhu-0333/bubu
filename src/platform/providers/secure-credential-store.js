'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createSecureCredentialStore({
  safeStorage = require('electron').safeStorage,
  userDataPath,
  fileName = 'ai-credential.bin'
}) {
  if (!safeStorage || typeof safeStorage.encryptString !== 'function'
      || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('Electron safeStorage is required');
  }
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('an absolute userDataPath is required');
  }
  const filePath = path.join(userDataPath, fileName);

  function available() {
    return typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  }

  function set(secret) {
    if (!available()) throw new Error('secure-storage-unavailable');
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096) {
      throw new TypeError('credential is invalid');
    }
    const encrypted = safeStorage.encryptString(secret.trim());
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
    return true;
  }

  function get() {
    if (!available() || !fs.existsSync(filePath)) return null;
    try {
      const encrypted = fs.readFileSync(filePath);
      const value = safeStorage.decryptString(encrypted);
      return typeof value === 'string' && value ? value : null;
    } catch (_) {
      return null;
    }
  }

  function clear() {
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  function status() {
    return { available: available(), configured: Boolean(get()) };
  }

  return Object.freeze({ filePath, available, set, get, clear, status });
}

module.exports = { createSecureCredentialStore };
