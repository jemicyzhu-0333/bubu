'use strict';

const { createRunExecution } = require('./run-execution');

const TASKS = new Set(['breakdown', 'enrich', 'unstick', 'impulse-energy', 'capture-triage']);
const STAGES = new Set(['ports', 'freshness', 'budget', 'listener', 'clock', 'schedule', 'unknown']);
const STATES = new Set(['not-acquired', 'released', 'unconfirmed']);
const REASONS = new Set([
  'provider-timeout', 'provider-request-aborted', 'provider-credential-missing',
  'provider-model-missing', 'invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
  'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed',
  'provider-endpoint-resolves-private', 'provider-response-invalid-json',
  'provider-response-missing-output', 'provider-response-too-large', 'provider-http-error',
  'provider-network-error', 'proposal-rejected', 'provider-budget', 'provider-output-budget',
  'provider-attempt-contract-invalid'
]);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH']);

// External exceptions are data, never diagnostic text or executable getters.
function own(value, key) {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch (_) { return undefined; }
}
function cleanupReport(value, missing = 'unconfirmed') {
  const timer = own(value, 'timer');
  const listener = own(value, 'listener');
  const boundedTimer = STATES.has(timer) ? timer : missing;
  const boundedListener = STATES.has(listener) ? listener : missing;
  return Object.freeze({ ok: boundedTimer !== 'unconfirmed' && boundedListener !== 'unconfirmed',
    timer: boundedTimer, listener: boundedListener });
}
function remoteReason(error) {
  if (own(error, 'stage') === 'validate') return 'proposal-rejected';
  const code = own(error, 'code');
  if (REASONS.has(code)) return code;
  const message = own(error, 'message');
  if (REASONS.has(message)) return message;
  if (typeof message === 'string' && /^provider-http-[1-5]\d{2}(?:\||$)/.test(message)) return 'provider-http-error';
  if (message === 'provider model is required') return 'provider-model-missing';
  if (NETWORK_CODES.has(code) || NETWORK_CODES.has(message)) return 'provider-network-error';
  return 'provider-failed';
}
function observe(operation) {
  try {
    const result = operation();
    if (result && typeof result.then === 'function') Promise.resolve(result).then(() => {}, () => {});
  } catch (_) { /* Observations cannot retry an accepted provider result. */ }
}

// ARCHITECTURE「AI 与 LLM」: execution only. No lease, store, grant or workflow
// ownership. Each actual POST is charged by the native beforeRequest hook.
function createOneShotProviderRun({ now, schedule, cancelSchedule } = {}) {
  return async function runWithFallback(client, fallbackClient, name, payload, options = {}) {
    const untouched = cleanupReport(null, 'not-acquired');
    const refused = (reason, cleanup = untouched) => ({ ok: false, reason, cleanup });
    const setupFailed = (stage, cleanup = untouched) => ({ ok: false, reason: 'run-setup-failed',
      setupStage: STAGES.has(stage) ? stage : 'unknown', cleanup });
    let signal;
    let assertCurrent;
    let trace;
    let onUsage;
    let maxRepairAttempts;
    let maxOutputChars;
    let deadlineMs;
    try {
      ({ signal, assertCurrent, trace, onUsage, maxRepairAttempts = 1, maxOutputChars } = options);
      if (!TASKS.has(name) || !client || typeof client.run !== 'function'
          || !fallbackClient || typeof fallbackClient.run !== 'function'
          || (maxRepairAttempts !== 0 && maxRepairAttempts !== 1)
          || (maxOutputChars !== undefined && (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 1))) {
        return refused('run-options-invalid');
      }
      const timeout = client.timeoutMs;
      if (timeout !== undefined && timeout !== null && typeof timeout !== 'number' && typeof timeout !== 'string') {
        return refused('run-options-invalid');
      }
      const numeric = timeout === undefined ? 0 : Number(timeout);
      if (!Number.isSafeInteger(numeric)) return refused('run-options-invalid');
      deadlineMs = Math.min(180000, Math.max(1, numeric || 180000));
    } catch (_) { return refused('run-options-invalid'); }
    if (typeof assertCurrent !== 'function') return setupFailed('freshness');
    if (typeof now !== 'function' || typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
      return setupFailed('ports');
    }
    if (signal === undefined) signal = new AbortController().signal;
    try {
      if (!signal || typeof signal.aborted !== 'boolean'
          || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function') {
        return setupFailed('ports');
      }
    } catch (_) { return setupFailed('ports'); }
    let ownerRefused = false;
    function assertOwner() {
      try {
        if (signal.aborted) throw new Error('provider-request-aborted');
        const result = assertCurrent();
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).then(() => {}, () => {});
          throw new Error('run-freshness-async');
        }
        if (signal.aborted) throw new Error('provider-request-aborted');
      } catch (_) {
        ownerRefused = true;
        throw new Error('provider-request-aborted');
      }
    }
    try { assertOwner(); } catch (_) { return refused('provider-request-aborted'); }
    let execution;
    try {
      execution = createRunExecution({ now, schedule, cancelSchedule, signal,
        limits: { maxReadCalls: 0, maxProviderCalls: 5, maxRepairAttempts, deadlineMs },
        assertCurrent() { assertOwner(); execution.check(); } });
    } catch (error) {
      return setupFailed(own(error, 'setupStage'), cleanupReport(own(error, 'cleanup')));
    }
    let outcome;
    try {
      try {
        const proposal = await execution.wait(controls => {
          const nativeOptions = { signal: controls.signal,
            beforeRequest() {
              controls.beforeProviderAttempt();
              // The budget clock is an injected port. Recheck owner identity
              // after charging, without charging a second time or sampling it again.
              controls.assertOpen();
              assertOwner();
              controls.assertOpen();
            }, maxRepairAttempts };
          if (maxOutputChars !== undefined) nativeOptions.maxOutputChars = maxOutputChars;
          if (typeof onUsage === 'function') nativeOptions.onUsage = usage => {
            if (controls.isOpen()) observe(() => onUsage(usage));
          };
          return client.run(name, payload, nativeOptions);
        });
        assertOwner();
        execution.check();
        if (execution.counts().providerCalls === 0) throw new Error('provider-attempt-contract-invalid');
        outcome = { ok: true, proposal, provider: client.id, fallback: false, reason: null };
      } catch (error) {
        // Capture before dispose changes the execution signal to run-closed.
        const deadline = execution.signal.reason === 'turn-deadline';
        const reason = deadline ? 'provider-request-aborted' : remoteReason(error);
        try { assertOwner(); } catch (_) { /* Caller invalidation wins over remote failure. */ }
        observe(() => trace?.fallback({ task: name, from: client.id, to: fallbackClient.id,
          reason: ownerRefused ? 'provider-request-aborted' : reason, deadlineMs,
          abortedBy: ownerRefused ? 'caller' : deadline ? 'deadline' : undefined }));
        if (ownerRefused) outcome = { ok: false, reason: 'provider-request-aborted' };
        else {
          try {
            assertOwner();
            // A local fallback is outside the expired remote execution, but
            // remains subject to its original caller and owner freshness.
            const proposal = await fallbackClient.run(name, payload, { signal });
            assertOwner();
            outcome = { ok: true, proposal, provider: fallbackClient.id, fallback: true, reason };
          } catch (fallbackError) {
            try { assertOwner(); } catch (_) { /* Preserve cancellation priority. */ }
            outcome = { ok: false, reason: ownerRefused ? 'provider-request-aborted'
              : own(fallbackError, 'message') === 'no-local-fallback' ? 'no-local-fallback' : 'local-fallback-failed' };
          }
        }
      }
    } finally {
      let cleanup;
      try { cleanup = cleanupReport(execution.dispose()); }
      catch (_) { cleanup = cleanupReport(null); }
      if (outcome) outcome = { ...outcome, cleanup };
    }
    return outcome;
  };
}

module.exports = { createOneShotProviderRun };
