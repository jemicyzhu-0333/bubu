'use strict';
// A single closed cursor contract for model envelopes and local authorization.
const MAX_CURSOR_OFFSET = 1000000;
const CURSOR_PATTERN = '^offset:[0-9]{1,7}$';
function cursorOffset(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'string' || !/^offset:\d{1,7}$/.test(value)) return null;
  const offset = Number(value.slice(7));
  return offset <= MAX_CURSOR_OFFSET ? offset : null;
}
module.exports = { MAX_CURSOR_OFFSET, CURSOR_PATTERN, cursorOffset };
