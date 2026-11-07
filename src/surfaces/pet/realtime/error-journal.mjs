// Presentation failures are occurrence records, not a set of message strings.
// The collector sanitizes text before packaging; this owner retains no Error,
// stack, scene, payload or callback references.
export const ERROR_OPERATIONS = Object.freeze([
  'initialization', 'late-initialization', 'hydration', 'frame', 'suspend', 'cancel', 'resize',
  'runtime-publication', 'cue-ack', 'panel-open', 'terminal-diagnostics',
  'terminal-runtime-publication', 'cleanup-lifecycle', 'cleanup-sync',
  'cleanup-viewport', 'cleanup-stage', 'late-stage-cleanup'
]);
const operations = new Set(ERROR_OPERATIONS);

export function errorMessage(error) {
  try { return String(error instanceof Error ? error.message : error).slice(0, 2048); }
  catch { return '[unprintable error]'; }
}

export function createErrorJournal({ capacity = 8 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8)
    throw new RangeError('Error journal capacity must be an integer in 1..8');
  const rows = new Array(capacity);
  let total = 0, count = 0, cursor = 0;
  const retained = () => Array.from({ length: count }, (_, index) =>
    ({ ...rows[(cursor - count + capacity + index) % capacity] }));
  return Object.freeze({
    record(operation, error, atMs = null) {
      if (!operations.has(operation)) throw new TypeError('Unknown presentation error operation');
      if (total === Number.MAX_SAFE_INTEGER) throw new RangeError('Error journal sequence exhausted');
      const message = errorMessage(error);
      rows[cursor] = Object.freeze({ sequence: ++total,
        atMs: Number.isFinite(atMs) && atMs >= 0 ? atMs : null, operation, message });
      cursor = (cursor + 1) % capacity; count = Math.min(capacity, count + 1);
      return message;
    },
    messages: () => retained().map(row => row.message),
    snapshot: () => ({ schemaVersion: 1, total, overwritten: total - count, rows: retained() })
  });
}
