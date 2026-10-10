'use strict';

// Local State is runtime metadata, not a business snapshot. Bound decoding and
// reject ambiguous duplicate keys before its closed runtime shape is checked.
function parseRuntimeJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 65536) throw new Error('runtime-json-size');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  const pattern = /\s*(?:"(?:[^"\\]|\\[\s\S])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,])/y;
  let offset = 0, nodes = 0;
  function token() {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match) throw new Error('runtime-json-token');
    offset = pattern.lastIndex;
    return match[0].trim();
  }
  function visit(first, depth) {
    if (++nodes > 512 || depth > 12) throw new Error('runtime-json-complexity');
    if (/^[\d-]/.test(first) && !Number.isFinite(Number(first))) throw new Error('runtime-json-number');
    if (first !== '{' && first !== '[') return;
    const object = first === '{', end = object ? '}' : ']';
    const keys = new Set();
    let next = token();
    if (next === end) return;
    while (true) {
      if (object) {
        const key = JSON.parse(next);
        if (keys.has(key)) throw new Error('runtime-json-duplicate');
        keys.add(key);
        if (token() !== ':') throw new Error('runtime-json-token');
        next = token();
      }
      visit(next, depth + 1);
      next = token();
      if (next === end) return;
      if (next !== ',') throw new Error('runtime-json-token');
      next = token();
    }
  }
  visit(token(), 0);
  if (text.slice(offset).trim()) throw new Error('runtime-json-trailing');
  return value;
}

module.exports = { parseRuntimeJson };
