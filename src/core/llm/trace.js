'use strict';

// ARCHITECTURE「AI 与 LLM」: diagnostic logging is metadata-only, including when
// explicitly enabled. A field whitelist protects private content; key masking or
// truncating a prompt, response, tool payload or exception cannot do that.
const OPERATIONS = Object.freeze(['breakdown', 'enrich', 'unstick', 'clarify', 'collaborate', 'impulse-energy', 'capture-triage']);
const PROVIDERS = Object.freeze(['api', 'deterministic', 'none']);
const ENUM_FIELDS = Object.freeze({
  kind: OPERATIONS,
  task: OPERATIONS,
  provider: PROVIDERS,
  from: PROVIDERS,
  to: PROVIDERS,
  status: Object.freeze(['need-more', 'ready', 'ok', 'failed', 'canceled']),
  abortedBy: Object.freeze(['caller', 'deadline'])
});
const COUNT_FIELDS = Object.freeze([
  'requestId', 'repairAttempts', 'turnIndex', 'inputChars', 'outputChars', 'responseChars',
  'messageCount', 'toolCount', 'count', 'timeoutMs', 'deadlineMs', 'elapsedMs'
]);
const ERROR_CODES = Object.freeze([
  'provider-failed', 'provider-timeout', 'provider-request-aborted', 'provider-credential-missing',
  'provider-model-missing', 'invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
  'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed',
  'provider-endpoint-resolves-private', 'provider-response-invalid-json',
  'provider-response-missing-output', 'provider-response-too-large', 'provider-http-error',
  'provider-network-error', 'proposal-rejected', 'forced-local', 'turn-limit-forced-local'
]);
const NETWORK_CODES = Object.freeze(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']);

// Do not enumerate caller fields, stringify objects or invoke payload accessors.
function fieldValue(fields, key) {
  if (!fields || typeof fields !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
}

function mappedErrorCode(error) {
  if (fieldValue(error, 'stage') === 'validate') return 'proposal-rejected';
  const code = fieldValue(error, 'code');
  if (NETWORK_CODES.includes(code)) return 'provider-network-error';
  const message = typeof error === 'string' ? error : fieldValue(error, 'message');
  if (ERROR_CODES.includes(code)) return code;
  if (ERROR_CODES.includes(message)) return message;
  if (typeof message === 'string') {
    if (/^provider-http-[1-5]\d\d(?:\||$)/.test(message)) return 'provider-http-error';
    if (message.startsWith('proposal-rejected|')) return 'proposal-rejected';
    if (message === 'provider model is required') return 'provider-model-missing';
  }
  return 'provider-failed';
}

function metadataFields(fields) {
  const metadata = {};
  for (const [key, allowed] of Object.entries(ENUM_FIELDS)) {
    const value = fieldValue(fields, key);
    if (allowed.includes(value)) metadata[key] = value;
  }
  for (const key of COUNT_FIELDS) {
    const value = fieldValue(fields, key);
    if (Number.isSafeInteger(value) && value >= 0) metadata[key] = value;
  }
  const statusCode = fieldValue(fields, 'statusCode');
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) metadata.statusCode = statusCode;
  const reason = fieldValue(fields, 'errorCode') ?? fieldValue(fields, 'reason');
  if (reason !== undefined && reason !== null && reason !== '') metadata.errorCode = mappedErrorCode(reason);
  return metadata;
}

function formatFields(fields = {}) {
  return Object.entries(metadataFields(fields)).map(([key, value]) => `${key}=${value}`).join(' ');
}

const noop = () => {};
const NO_LLM_SPAN = Object.freeze({
  id: 0, request: noop, resolved: noop, status: noop, body: noop,
  output: noop, done: noop, failed: noop, note: noop
});
const NO_LLM_TRACE = Object.freeze({
  enabled: false, begin: () => NO_LLM_SPAN,
  selection: noop, skipped: noop, fallback: noop, result: noop
});

function createLlmTrace(options = {}) {
  if (options.enabled !== true) return NO_LLM_TRACE;
  const sink = typeof options.sink === 'function'
    ? options.sink
    : line => process.stdout.write(`${line}\n`);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  let calls = 0;
  const emit = (event, fields) => {
    try {
      const metadata = formatFields(fields);
      const result = sink(`[llm] ${event}${metadata ? ` ${metadata}` : ''}`);
      if (result && typeof result.then === 'function') Promise.resolve(result).then(() => {}, () => {});
    } catch (_) { /* Logging must not change protocol, validation or fallback. */ }
  };
  const sample = () => {
    try { const value = now(); return Number.isFinite(value) ? value : undefined; }
    catch (_) { return undefined; }
  };

  function begin(fields = {}) {
    const id = ++calls;
    const startedAt = sample();
    const elapsedMs = () => {
      const at = sample();
      if (at === undefined || startedAt === undefined) return undefined;
      const elapsed = Math.max(0, Math.round(at - startedAt));
      return Number.isSafeInteger(elapsed) ? elapsed : undefined;
    };
    const emitSpan = (event, details) => emit(event, { ...metadataFields(details), requestId: id });
    emitSpan('begin', fields);
    return Object.freeze({
      id,
      request(details = {}) {
        emitSpan('request', details);
      },
      resolved() {
        emitSpan('resolved');
      },
      status(statusCode) {
        emitSpan('response', { statusCode, elapsedMs: elapsedMs() });
      },
      body(text) {
        emitSpan('response-size', { responseChars: typeof text === 'string' ? text.length : undefined });
      },
      output(text) {
        emitSpan('output-size', { outputChars: typeof text === 'string' ? text.length : undefined });
      },
      done(details = {}) {
        emitSpan('ok', { ...metadataFields(details), elapsedMs: elapsedMs() });
      },
      failed(error, details = {}) {
        emitSpan('failed', {
          ...metadataFields(details), elapsedMs: elapsedMs(), errorCode: mappedErrorCode(error),
          statusCode: fieldValue(error, 'statusCode')
        });
      },
      // Existing callers pass free-form provider/validator prose here. Never
      // inspect or emit it, even with an explicit diagnostic opt-in.
      note: noop
    });
  }

  return Object.freeze({
    enabled: true,
    begin,
    selection: fields => emit('selection', fields),
    skipped: fields => emit('skipped', fields),
    fallback: fields => emit('fallback', fields),
    result: fields => emit('result', fields)
  });
}

module.exports = { formatFields, createLlmTrace, NO_LLM_TRACE, NO_LLM_SPAN };
