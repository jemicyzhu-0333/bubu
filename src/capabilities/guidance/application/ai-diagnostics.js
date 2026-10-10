'use strict';

// ARCHITECTURE「AI 与 LLM」: explicit test-session inspection, never a logger
// or a second canonical store. All clocks, timers and source checks are ports.
const SESSION_MS = 30 * 60 * 1000;
const LIMITS = Object.freeze({ runs: 50, bytes: 1024 * 1024, runBytes: 64 * 1024, blockBytes: 16 * 1024, events: 50 });
const TASKS = new Set(['capture-triage', 'impulse-energy', 'breakdown', 'enrich', 'unstick']);
const PHASES = new Set(['attempt', 'output', 'repaired', 'validated', 'rejected', 'transport', 'gate', 'application', 'energy']);
const META = new Set(['protocol', 'mode', 'attempt', 'repairAttempts', 'code', 'field', 'statusCode', 'confidence', 'minimum', 'accepted', 'changed', 'recordedDelta', 'effectiveContribution', 'sampledAt']);
const SECRET = /api.?key|authorization|password|credential|secret|access.?token|refresh.?token/i;
const PHASE_FIELDS = {
  attempt: ['protocol', 'mode', 'attempt', 'repairAttempts'], output: ['text'], repaired: ['value'], validated: ['value'],
  rejected: ['code', 'field'], transport: ['code', 'statusCode'], gate: ['confidence', 'minimum', 'accepted', 'code'],
  application: ['code', 'changed'], energy: ['recordedDelta', 'effectiveContribution', 'sampledAt', 'code']
};
function safeText(text) {
  return text.replace(/\b(?:Bearer|Basic)\s+[^\s"']+/gi, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|password|access[_-]?token|refresh[_-]?token|secret)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .replace(/((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|key|api_key|access_token|secret)=)[^&#\s"']+/gi, '$1[redacted]');
}
function own(object, key) { try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch (_) { return undefined; } }
function copy(value, depth = 0, budget = { nodes: 0, truncated: false, redacted: false }) {
  if (++budget.nodes > 1000 || depth > 8) { budget.truncated = true; return '[bounded]'; }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value.length > LIMITS.blockBytes) budget.truncated = true;
    const original = value.slice(0, LIMITS.blockBytes), cleaned = safeText(original);
    if (original !== cleaned) budget.redacted = true;
    return cleaned;
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    if (value.length > 40) budget.truncated = true;
    return Array.from({ length: Math.min(value.length, 40) }, (_, index) => copy(own(value, String(index)), depth + 1, budget));
  }
  const result = {}, keys = Object.keys(value);
  if (keys.length > 40) budget.truncated = true;
  for (const key of keys.slice(0, 40)) {
    if (SECRET.test(key)) { budget.redacted = true; continue; }
    if (!['__proto__', 'constructor', 'prototype'].includes(key)) result[key] = copy(own(value, key), depth + 1, budget);
  }
  return result;
}
function bounded(data, phase) {
  const fields = [...PHASE_FIELDS[phase], 'protocol', 'mode', 'attempt', 'repairAttempts'];
  const selected = Object.fromEntries(fields.flatMap(key => own(data, key) === undefined ? [] : [[key, own(data, key)]]));
  const budget = { nodes: 0, truncated: false, redacted: false };
  const value = copy(selected, 0, budget), text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') <= LIMITS.blockBytes) return { value, truncated: budget.truncated, redacted: budget.redacted };
  return { value: { excerpt: text.slice(0, LIMITS.blockBytes / 4), truncated: true }, truncated: true, redacted: budget.redacted };
}
function safeCode(value, fallback = 'unavailable') {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value) ? value : fallback;
}
function createAiDiagnostics({ available = false, now, schedule, cancelSchedule, isSourceCurrent = () => true } = {}) {
  if (![now, schedule, cancelSchedule, isSourceCurrent].every(port => typeof port === 'function')) throw new TypeError('diagnostics ports required');
  const records = new Map();
  let expiresAt = null, timer = null, epoch = 0, session = 0, sequence = 0, closed = false;
  function remove(id) {
    const record = records.get(id);
    if (record) { record.events.length = 0; record.bytes = 0; record.source = null; }
    records.delete(id);
  }
  function clearRecords() { epoch++; for (const id of records.keys()) remove(id); }
  function stop() {
    if (timer !== null) { try { cancelSchedule(timer); } catch (_) { /* epoch still closes late callbacks */ } }
    timer = null; expiresAt = null; session++; clearRecords();
    return status();
  }
  function reconcile() {
    if (expiresAt !== null && (!Number.isFinite(now()) || now() >= expiresAt)) { stop(); return; }
    for (const [id, record] of records) {
      let current = false;
      try { current = !record.source || isSourceCurrent(record.source) === true; } catch (_) { /* unavailable sources fail closed */ }
      if (!current) {
        // Privacy invalidation keeps only the non-content receipt. Later commit
        // evidence may still arrive, but provider content cannot return.
        record.events = record.events.filter(event => !['output', 'repaired', 'validated'].includes(event.phase));
        record.bytes = record.events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event), 'utf8'), 0);
        record.source = null; record.contentRemoved = true; epoch++;
      }
    }
  }
  function status() {
    reconcile();
    return { ok: true, available: available === true && !closed, active: expiresAt !== null && !closed,
      expiresAt, epoch, count: records.size };
  }
  const unavailable = () => ({ ok: false, reason: 'diagnostics-unavailable' });
  function start() {
    if (!available || closed) return unavailable();
    stop();
    const at = now();
    if (!Number.isFinite(at)) return unavailable();
    expiresAt = at + SESSION_MS;
    const identity = session;
    try { timer = schedule(() => { if (identity === session) stop(); }, SESSION_MS); timer?.unref?.(); }
    catch (_) { stop(); return unavailable(); }
    return status();
  }
  function trim() {
    const bytes = () => [...records.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (records.size > LIMITS.runs || bytes() > LIMITS.bytes) remove(records.keys().next().value);
  }
  function begin(task, source = null) {
    if (!status().active || !TASKS.has(task)) return null;
    const id = `run-${++sequence}`;
    const record = { id, task, source, startedAt: now(), endedAt: null, state: 'running',
      outcome: { code: 'running', changed: null }, events: [], truncated: false, redacted: false, contentRemoved: false, bytes: 0 };
    records.set(id, record); trim();
    function observe(phase, data) {
      try {
        reconcile();
        if (records.get(id) !== record || !expiresAt || !PHASES.has(phase)) return;
        if (record.contentRemoved && ['output', 'repaired', 'validated'].includes(phase)) return;
        if (record.events.length >= LIMITS.events) { record.truncated = true; return; }
        const result = bounded(data, phase), event = { phase, at: now(), data: result.value };
        const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
        if (record.bytes + size > LIMITS.runBytes) { record.truncated = true; return; }
        record.events.push(event); record.bytes += size; record.truncated ||= result.truncated; record.redacted ||= result.redacted; trim();
      } catch (_) { /* Observations never affect a provider call or commit. */ }
    }
    function finish(code, changed = null) {
      observe('application', { code: safeCode(code), changed: typeof changed === 'boolean' ? changed : null });
      if (records.get(id) !== record) return;
      record.state = 'finished'; record.endedAt = now(); record.outcome = { code: safeCode(code), changed: typeof changed === 'boolean' ? changed : null };
    }
    return Object.freeze({ observe, finish });
  }
  function summary(record) {
    return { id: record.id, task: record.task, startedAt: record.startedAt, endedAt: record.endedAt,
      state: record.state, outcome: { ...record.outcome } };
  }
  function list() { return { ...status(), records: [...records.values()].reverse().map(summary) }; }
  function detail({ id } = {}) {
    const current = status();
    if (!current.available) return unavailable();
    const record = records.get(id);
    return record ? { ...current, record: { ...summary(record), events: JSON.parse(JSON.stringify(record.events)), truncated: record.truncated, redacted: record.redacted, contentRemoved: record.contentRemoved } }
      : { ok: false, reason: 'diagnostic-run-missing' };
  }
  function exportMetadata() {
    if (!status().available) return unavailable();
    const runs = [...records.values()].map(record => ({ ...summary(record), events: record.events.map(event => ({
      phase: event.phase, at: event.at, data: Object.fromEntries(Object.entries(event.data || {}).filter(([key, value]) =>
        META.has(key) && (value === null || typeof value === 'number' || typeof value === 'boolean'
          || (typeof value === 'string' && /^[a-z0-9_.[\]-]{1,80}$/.test(value)))))
    })) }));
    return { ok: true, text: JSON.stringify({ format: 'bubu-ai-diagnostics-metadata-v1', runs }, null, 2) };
  }
  return Object.freeze({ status, start, stop, clear() { clearRecords(); return status(); }, list, detail, exportMetadata,
    begin, reconcile, dispose() { stop(); closed = true; } });
}
module.exports = { createAiDiagnostics, LIMITS, SESSION_MS };
