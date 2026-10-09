'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { syncAuthoritativeDirectory } = require('./authoritative-directory-sync');

// Every config replacement is old-or-new atomic; only explicitly authoritative
// groups require a verified directory flush before acknowledgement. Same-directory rename is
// mandatory: EXDEV/SNAP never falls back to truncating the canonical file.
function createAuthoritativeConfigWriter({ filePath, io = fs, platform = process.platform, idFactory = randomUUID } = {}) {
  const directory = path.dirname(filePath);
  let uncertain = false;
  function status() {
    try { syncAuthoritativeDirectory({ directory, io, platform }); return { available: true }; }
    catch (_) { return { available: false, reason: 'authoritative-config-unavailable' }; }
  }
  function verify() {
    try {
      const fd = io.openSync(filePath, 'r+');
      try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
      syncAuthoritativeDirectory({ directory, io, platform });
      uncertain = false; return { ok: true };
    } catch (_) { return { ok: false, reason: uncertain ? 'change-durability-uncertain' : 'authoritative-config-unavailable', uncertain }; }
  }
  function write(value, { requireDurable = true, expectedSourceHash } = {}) {
    if (requireDurable && !status().available) throw Object.assign(new Error('authoritative-config-unavailable'), { code: 'AUTHORITATIVE_CONFIG_UNAVAILABLE' });
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    const temporary = `${filePath}.authoritative-${idFactory()}.tmp`;
    let renamed = false;
    function verifySource() {
      if (expectedSourceHash === undefined) return;
      const actual = io.existsSync(filePath) ? createHash('sha256').update(io.readFileSync(filePath)).digest('hex') : null;
      if (actual !== expectedSourceHash) throw Object.assign(new Error('config-mirror-conflict'), { code: 'CONFIG_MIRROR_CONFLICT' });
    }
    try {
      verifySource();
      const fd = io.openSync(temporary, 'wx', 0o600);
      try { io.writeFileSync(fd, bytes); io.fsyncSync(fd); } finally { io.closeSync(fd); }
      if (!io.readFileSync(temporary).equals(bytes)) throw new Error('authoritative-config-verification-failed');
      verifySource();
      io.renameSync(temporary, filePath); renamed = true; uncertain = true;
      const verified = verify();
      return { committed: true, durable: verified.ok, uncertain: !verified.ok };
    } catch (error) {
      if (renamed) { uncertain = true; return { committed: true, durable: false, uncertain: true }; }
      throw error;
    } finally {
      if (!renamed) { try { io.unlinkSync(temporary); } catch (_) {} }
    }
  }
  return Object.freeze({ status, verify, write });
}
module.exports = { createAuthoritativeConfigWriter };
