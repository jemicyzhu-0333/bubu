'use strict';

// The helper protocol is one JSON object per line: {"v":1,"front":…,"audio":[…]}.
// Anything else is dropped; identifiers are bounded before they reach the classifier.
const MAX_LINE = 16 * 1024;
const MAX_IDENTIFIER = 200;
const MAX_AUDIO = 32;

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER ? value : null;
}

function parseProbeLine(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LINE) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) return null;
  const rawAudio = Array.isArray(value.audio) ? value.audio : typeof value.audio === 'string' ? [value.audio] : [];
  const audio = [...new Set(rawAudio.map(identifier).filter(Boolean))].slice(0, MAX_AUDIO);
  return Object.freeze({ front: identifier(value.front), audio: Object.freeze(audio) });
}

// `lsappinfo info -only <key>` prints `"<Key>"="<value>"`.
function parseLsappinfoValue(stdout) {
  const match = /"[^"]+"\s*=\s*"([^"]{1,200})"/.exec(String(stdout || ''));
  return match ? match[1] : null;
}

module.exports = { parseProbeLine, parseLsappinfoValue, MAX_LINE };
