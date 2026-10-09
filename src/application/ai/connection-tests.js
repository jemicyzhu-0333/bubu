'use strict';

const { probeConnection, connectionFailure, DEFAULT_AI_BASE_URL } = require('../../core/llm');
const { AI_MODEL_PATTERN, isHttpsEndpoint, baseUrlFromEndpoint } = require('../../capabilities/preferences');

function canonicalEndpoint(value) {
  if (value !== null && value !== undefined && value !== '' && !isHttpsEndpoint(value)) {
    throw new Error('invalid-provider-endpoint');
  }
  return baseUrlFromEndpoint(value || DEFAULT_AI_BASE_URL);
}

// Runtime-only, owned by the AI application. No settings, credential, memory,
// task, receipt or ledger writers are supplied to this one-shot use case.
function createConnectionTests({ getSettings, getCredential, requestScope,
  probe = probeConnection, now = () => performance.now(), timeoutMs = 20_000 } = {}) {
  const active = new Map();
  let closed = false;
  function cancel(owner, requestId) {
    const run = active.get(owner);
    if (!run || run.requestId !== requestId) return { ok: true, cancelled: false };
    run.controller.abort();
    return { ok: true, cancelled: true };
  }
  function cancelOwner(owner) { active.get(owner)?.controller.abort(); }
  async function run(owner, draft) {
    if (closed) return { ok: false, reason: 'cancelled' };
    if (active.has(owner)) return { ok: false, reason: 'busy' };
    let apiKey, baseUrl, scope;
    try {
      if (typeof draft?.model !== 'string' || !AI_MODEL_PATTERN.test(draft.model.trim())) {
        return { ok: false, reason: 'invalid-model' };
      }
      if (draft.secret !== undefined && (typeof draft.secret !== 'string' || !draft.secret.trim()
        || draft.secret.length > 4096 || /\s/.test(draft.secret.trim()))) {
        return { ok: false, reason: 'invalid-credential' };
      }
      baseUrl = canonicalEndpoint(draft.baseUrl);
      if (draft.secret) apiKey = draft.secret.trim();
      else {
        if (baseUrl !== canonicalEndpoint(getSettings().aiBaseUrl)) {
          return { ok: false, reason: 'draft-credential-required' };
        }
        apiKey = getCredential();
      }
      if (!apiKey) return { ok: false, reason: 'credential-missing' };
      scope = requestScope.begin();
    } catch (error) { return { ok: false, ...connectionFailure(error) }; }
    const controller = new AbortController();
    const identity = { requestId: draft.requestId, controller };
    active.set(owner, identity);
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    if (scope.signal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const started = now();
    const assertCurrent = () => {
      scope.assertCurrent();
      if (controller.signal.aborted || active.get(owner) !== identity) throw new Error('provider-request-aborted');
    };
    try {
      assertCurrent();
      const result = await probe({ model: draft.model.trim(), baseUrl, apiKey,
        signal: controller.signal, timeoutMs, assertCurrent });
      assertCurrent();
      return { ok: true, protocol: result.protocol, durationMs: Math.max(0, Math.round(now() - started)) };
    } catch (error) {
      return { ok: false, ...(timedOut ? { reason: 'timeout' }
        : controller.signal.aborted ? { reason: 'cancelled' } : connectionFailure(error)) };
    } finally {
      apiKey = null;
      clearTimeout(timer);
      scope.signal.removeEventListener('abort', abort);
      scope.release();
      if (active.get(owner) === identity) active.delete(owner);
    }
  }
  function dispose() {
    closed = true;
    for (const run of active.values()) run.controller.abort();
  }
  return Object.freeze({ run, cancel, cancelOwner, dispose });
}
module.exports = { createConnectionTests };
