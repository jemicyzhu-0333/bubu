'use strict';

// ARCHITECTURE「AI 与 LLM」: one budget constrains the entire turn, including
// tool reads and provider retries. A budget boundary never grants persistence.
const COLLABORATION_BUDGET = Object.freeze({
  maxMessageChars: 8000,
  maxSegmentTurns: 100,
  maxSegmentBytes: 512 * 1024,
  maxContextBytes: 64 * 1024,
  maxOutputChars: 8000,
  maxReadCalls: 6,
  maxProviderCalls: 5,
  maxRepairAttempts: 1,
  deadlineMs: 180000,
  softTurnNotice: 30,
  maxPendingChangeSets: 1
});

function unicodeLength(value) { return [...value].length; }
function serializedBytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function normalizeRunBudget(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('run-budget-invalid');
  }
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(COLLABORATION_BUDGET, key)) throw new TypeError('run-budget-field-invalid');
  }
  const result = { ...COLLABORATION_BUDGET, ...overrides };
  for (const [key, maximum] of Object.entries(COLLABORATION_BUDGET)) {
    const minimum = key === 'maxReadCalls' || key === 'maxRepairAttempts' ? 0 : 1;
    if (!Number.isSafeInteger(result[key]) || result[key] < minimum || result[key] > maximum) {
      throw new RangeError('run-budget-limit-invalid');
    }
  }
  return Object.freeze(result);
}

function createTurnBudget({ now, limits = COLLABORATION_BUDGET } = {}) {
  if (typeof now !== 'function') throw new TypeError('run-budget-clock-required');
  const budget = normalizeRunBudget(limits);
  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new TypeError('run-budget-clock-invalid');
  let reads = 0;
  let providerCalls = 0;
  function check() {
    const at = now();
    return Number.isFinite(at) && at >= startedAt && at - startedAt < budget.deadlineMs
      ? { ok: true } : { ok: false, reason: 'turn-deadline' };
  }
  function consume(kind) {
    const active = check();
    if (!active.ok) return active;
    if (kind === 'read') {
      if (reads >= budget.maxReadCalls) return { ok: false, reason: 'read-budget' };
      reads += 1;
    } else if (kind === 'provider') {
      if (providerCalls >= budget.maxProviderCalls) return { ok: false, reason: 'provider-budget' };
      providerCalls += 1;
    } else return { ok: false, reason: 'budget-kind-invalid' };
    return { ok: true };
  }
  return Object.freeze({
    check, consume,
    remainingMs: () => Math.max(0, budget.deadlineMs - (now() - startedAt)),
    // Consumed allowances, not proof of reads or HTTP transport completing.
    // This snapshot stays observable without sampling a possibly failed clock.
    counts: () => Object.freeze({ reads, providerCalls }),
    usage: () => Object.freeze({ reads, providerCalls, elapsedMs: Math.max(0, now() - startedAt), tokens: null }),
    limits: budget
  });
}

// Keep the newest user message whole. Earlier messages remain in canonical
// history, even when this request cannot include them. Summary is derived data.
function buildBoundedContext({ messages, summary = null, data = [], limits = COLLABORATION_BUDGET } = {}) {
  const budget = normalizeRunBudget(limits);
  if (!Array.isArray(messages) || !Array.isArray(data)) throw new TypeError('context-invalid');
  const eligible = messages.filter(message => message && message.contextAllowed !== false);
  const latest = eligible.at(-1);
  const chosen = latest ? [latest] : [];
  const envelope = () => ({ summary, messages: chosen, data });
  if (serializedBytes(envelope()) > budget.maxContextBytes) {
    return { ok: false, reason: 'context-budget', latestPreserved: true };
  }
  for (let i = eligible.length - 2; i >= 0; i -= 1) {
    chosen.unshift(eligible[i]);
    if (serializedBytes(envelope()) > budget.maxContextBytes) { chosen.shift(); break; }
  }
  return {
    ok: true,
    context: Object.freeze(envelope()),
    coverage: Object.freeze({ included: chosen.length, total: messages.length,
      omitted: messages.length - chosen.length, throughMessageId: summary?.throughMessageId || null }),
    // Tokenizers vary across compatible providers; bytes are a real hard limit,
    // while token use remains unknown until a provider reports it.
    bytes: serializedBytes(envelope()), tokens: null
  };
}

module.exports = { COLLABORATION_BUDGET, unicodeLength, serializedBytes, normalizeRunBudget,
  createTurnBudget, buildBoundedContext };
