'use strict';

// ARCHITECTURE「AI 与 LLM」: the explicitly enabled, per-run content observer is
// separate from trace.js. It receives only extracted output and local results,
// never prompts, credentials, the HTTP envelope or arbitrary exception text.
const PHASES = Object.freeze(['attempt', 'output', 'repaired', 'validated', 'rejected', 'transport']);
const MAX_OBSERVED_ATTEMPTS = 5;
const PROTOCOLS = Object.freeze(['chat-completions', 'responses']);
const MODES = Object.freeze(['json_schema', 'json_object']);
const TRANSPORT_CODES = new Set([
  'provider-failed', 'provider-timeout', 'provider-request-aborted', 'provider-credential-missing',
  'provider-model-missing', 'invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
  'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed',
  'provider-endpoint-resolves-private', 'provider-response-invalid-json',
  'provider-response-html', 'provider-response-event-stream', 'provider-response-empty',
  'provider-response-missing-output', 'provider-response-too-large', 'provider-output-budget',
  'provider-http-error', 'provider-network-error'
]);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']);
const VALIDATION_TASKS = new Set(['breakdown', 'enrich', 'capture-triage', 'impulse-energy']);
const COMMON_REJECTIONS = new Map([
  ['proposal is not valid JSON', { code: 'proposal-json-invalid' }],
  ['proposal exceeds 8 KB', { code: 'proposal-output-too-large' }]
]);
const TASK_REJECTIONS = {
  breakdown: new Map([
    ['proposal must be an object', { code: 'proposal-object-invalid' }],
    ['proposal contains unknown or missing fields', { code: 'proposal-fields-invalid' }],
    ['clarifyingQuestion is invalid', { code: 'proposal-field-invalid', field: 'clarifyingQuestion' }]
  ]),
  enrich: new Map([
    ['enrich proposal must be an object', { code: 'proposal-object-invalid' }],
    ['enrich proposal contains unknown or missing fields', { code: 'proposal-fields-invalid' }],
    ...['completionCriteria', 'energy', 'estimateMinutes'].map(field =>
      [`${field} is invalid`, { code: 'proposal-field-invalid', field }]),
    ['tags must contain at most 3 entries', { code: 'proposal-field-invalid', field: 'tags' }],
    ['tags may only reuse existing tags', { code: 'proposal-field-invalid', field: 'tags' }]
  ]),
  'capture-triage': new Map([
    ['capture triage result must be an object', { code: 'proposal-object-invalid' }],
    ['capture triage result contains unknown or missing fields', { code: 'proposal-fields-invalid' }],
    ...['category', 'confidence', 'reason'].map(field =>
      [`capture triage ${field} is invalid`, { code: 'proposal-field-invalid', field }]),
    ...['title', 'routineKind', 'level'].map(field =>
      [`capture triage ${field} is required`, { code: 'proposal-field-required', field }]),
    ['capture triage title is too long', { code: 'proposal-field-too-long', field: 'title' }]
  ]),
  'impulse-energy': new Map([
    ['impulse energy result must be an object', { code: 'proposal-object-invalid' }],
    ['impulse energy result contains unknown or missing fields', { code: 'proposal-fields-invalid' }],
    ...['direction', 'delta', 'confidence', 'reason'].map(field =>
      [`impulse energy ${field} is invalid`, { code: 'proposal-field-invalid', field }]),
    ['impulse energy direction and delta disagree', { code: 'proposal-direction-delta-disagree', field: 'delta' }]
  ])
};

function ownValue(object, key) {
  if (!object || typeof object !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(object, key)?.value; }
  catch (_) { return undefined; }
}

function diagnosticOption(options) {
  return ownValue(options, 'diagnostics');
}

// Invoked only at the existing local repair/validation failure site. Provider
// errors cannot mint validation provenance by setting their own stage property.
function diagnosticRejection(task, error) {
  const unknown = { code: 'proposal-rejected' };
  if (!VALIDATION_TASKS.has(task)) return unknown;
  const message = ownValue(error, 'message');
  if (typeof message !== 'string' || message.length > 200) return unknown;
  const known = COMMON_REJECTIONS.get(message) || TASK_REJECTIONS[task].get(message);
  if (known) return { ...known };
  if (task !== 'breakdown' && task !== 'enrich') return unknown;
  if (message === 'proposal must contain 3–7 steps') return { code: 'proposal-step-count-invalid', field: 'steps' };
  if (message === 'the final step must be a safe stop') return { code: 'proposal-final-stop-required', field: 'steps' };
  const step = /^(steps\[[0-6]\])(?:( must be an object)|( contains unknown or missing fields)|(\.title) is invalid|(\.dependsOn) must reference an earlier step|(\.safeStopAfter) must be boolean)$/.exec(message);
  if (!step) return unknown;
  return {
    code: step[2] ? 'proposal-object-invalid' : step[3] ? 'proposal-fields-invalid' : 'proposal-field-invalid',
    field: step[1] + (step[4] || step[5] || step[6] || '')
  };
}

function diagnosticTransport(error) {
  const rawCode = ownValue(error, 'code');
  const message = ownValue(error, 'message');
  let code = TRANSPORT_CODES.has(rawCode) ? rawCode : TRANSPORT_CODES.has(message) ? message : 'provider-failed';
  if (NETWORK_CODES.has(rawCode)) code = 'provider-network-error';
  if (typeof message === 'string' && /^provider-http-[1-5]\d\d(?:\||$)/.test(message)) code = 'provider-http-error';
  if (message === 'provider model is required') code = 'provider-model-missing';
  const statusCode = ownValue(error, 'statusCode');
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? { code, statusCode } : { code };
}

// Do not stringify the candidate: getters/toJSON could change the value the
// validator subsequently sees. Copy only plain own data, with finite traversal.
// Unsupported/cyclic candidates simply omit this optional observation.
function candidateCopy(value, state = { seen: new Set(), nodes: 0 }, depth = 0) {
  if (++state.nodes > 8192 || depth > 32) throw new RangeError('diagnostic-copy-budget');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object' || state.seen.has(value)) throw new TypeError('diagnostic-copy-invalid');
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('diagnostic-copy-invalid');
  state.seen.add(value);
  const result = array ? [] : {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && (!Number.isSafeInteger(descriptors.length?.value) || descriptors.length.value > 8192)) {
    throw new RangeError('diagnostic-copy-budget');
  }
  const keys = array ? Array.from({ length: descriptors.length.value }, (_, index) => String(index)) : Object.keys(descriptors);
  if (keys.length > 8192) throw new RangeError('diagnostic-copy-budget');
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!array && !descriptor.enumerable) continue;
    if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('diagnostic-copy-invalid');
    const child = descriptor?.value;
    if (!array && child === undefined) continue;
    Object.defineProperty(result, key, { value: child === undefined ? null : candidateCopy(child, state, depth + 1),
      enumerable: true, writable: true, configurable: true });
  }
  state.seen.delete(value);
  return Object.freeze(result);
}

const noop = () => {};

function createDiagnosticObservation(options, signal) {
  const diagnostics = diagnosticOption(options);
  const observe = ownValue(diagnostics, 'observe');
  if (typeof observe !== 'function') return noop;
  return (phase, data) => {
    try {
      if (signal?.aborted || !PHASES.includes(phase) || data.attempt < 1 || data.attempt > MAX_OBSERVED_ATTEMPTS) return;
      const event = { attempt: data.attempt, repairAttempts: data.repairAttempts };
      if (PROTOCOLS.includes(data.protocol)) event.protocol = data.protocol;
      if (MODES.includes(data.mode)) event.mode = data.mode;
      if (phase === 'output') event.text = data.text;
      if (phase === 'repaired' || phase === 'validated') event.value = candidateCopy(data.value);
      if (phase === 'rejected' || phase === 'transport') {
        event.code = data.code;
        if (data.field !== undefined) event.field = data.field;
        if (data.statusCode !== undefined) event.statusCode = data.statusCode;
      }
      if (signal?.aborted) return;
      // Promise.resolve also contains a hostile then getter in a rejection; no
      // observer rejection is allowed to enter generation's retry ladder.
      Promise.resolve(Reflect.apply(observe, diagnostics, [phase, Object.freeze(event)])).then(noop, noop);
    } catch (_) { /* Observation must never alter generation or trigger retry. */ }
  };
}

module.exports = { diagnosticOption, createDiagnosticObservation, diagnosticRejection, diagnosticTransport };
