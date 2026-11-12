// Presentation failures are occurrence records, not a set of message strings.
// Each message fragment is sanitized before aggregation; the collector also
// sanitizes text before packaging. This owner retains no Error,
// stack, scene, payload or callback references.
export const ERROR_OPERATIONS = Object.freeze([
  'initialization', 'late-initialization', 'hydration', 'frame', 'suspend', 'cancel', 'resize',
  'runtime-publication', 'cue-ack', 'panel-open', 'terminal-diagnostics',
  'terminal-runtime-publication', 'cleanup-lifecycle', 'cleanup-sync',
  'cleanup-viewport', 'cleanup-stage', 'late-stage-cleanup'
]);
const operations = new Set(ERROR_OPERATIONS);

function scalarMessage(error, limit) {
  try {
    // Redact each bounded fragment before joining: a truncated quoted secret
    // must not consume another child's opening quote and expose its value.
    return String(error instanceof Error ? error.message : error).slice(0, limit)
      .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)\S+/gi, '$1[redacted]')
      .replace(/((?:api[_-]?key|(?:access[_-]?)?token|password|secret)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s"']+)/gi, '$1[redacted]')
      .replace(/(\b[a-z][a-z\d+.-]{0,31}:\/\/)[^\s/:]+:[^\s@]+@/gi, '$1[redacted]@')
      .replace(/(?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^\r\n"']+/g, '[path]')
      .replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/gi, '[redacted]').slice(0, limit);
  }
  catch { return '[unprintable error]'; }
}

export function errorMessage(error) {
  // Keep one occurrence and only text, including existing stage aggregates.
  // Bound traversal as well as output; never invoke errors/array accessors,
  // retain raw children, or inspect stack, cause, payload and other properties.
  const ancestors = new Set();
  let remaining = 16;
  function summarize(value, depth) {
    if (remaining-- <= 0) return '[error detail limit]';
    let aggregate;
    try { aggregate = value instanceof AggregateError; } catch { return '[unprintable error]'; }
    if (!aggregate) return scalarMessage(value, depth === 0 ? 2048 : 256);
    if (ancestors.has(value)) return '[circular aggregate]';
    const message = scalarMessage(value, 256);
    if (depth >= 3) return `${message} [aggregate depth limit]`;
    ancestors.add(value);
    try {
      const children = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
      if (!Array.isArray(children)) return `${message} [unreadable aggregate errors]`;
      const count = Object.getOwnPropertyDescriptor(children, 'length')?.value;
      if (!Number.isSafeInteger(count) || count < 0) return `${message} [unreadable aggregate errors]`;
      const details = [];
      for (let i = 0; i < Math.min(count, 8); i++) {
        if (remaining <= 0) { details.push('[error detail limit]'); break; }
        const item = Object.getOwnPropertyDescriptor(children, String(i));
        details.push(`${i + 1}: ${item && Object.hasOwn(item, 'value')
          ? summarize(item.value, depth + 1) : '[unreadable error item]'}`);
      }
      if (count > 8) details.push(`[${count - 8} more errors omitted]`);
      return `${message} (${count} errors): ${details.join('; ')}`.slice(0, 2048);
    } catch { return `${message} [unreadable aggregate errors]`; }
    finally { ancestors.delete(value); }
  }
  return summarize(error, 0).slice(0, 2048);
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
