'use strict';
const { createHash } = require('node:crypto');

// A content version survives process restarts and detects same-millisecond
// manual edits. It is not a user-facing entity id or a privacy tombstone.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function entityFingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
module.exports = { canonicalJson, entityFingerprint };
