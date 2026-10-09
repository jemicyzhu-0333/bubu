'use strict';

function createImpulseEnergyClassifier({
  getSettings,
  requestScope,
  credentialStore,
  createApiClient,
  defaultBaseUrl,
  failureReason = error => error && error.message ? error.message : 'provider-failed',
  timeoutMs,
  negotiation,
  runWithFallback,
  trace = undefined
} = {}) {
  if (typeof getSettings !== 'function' || !credentialStore
      || typeof credentialStore.status !== 'function' || typeof credentialStore.get !== 'function') {
    throw new TypeError('impulse energy classifier requires settings and credential ports');
  }
  if (typeof createApiClient !== 'function' || typeof defaultBaseUrl !== 'string') {
    throw new TypeError('impulse energy classifier requires an API provider');
  }
  if (typeof runWithFallback !== 'function') {
    throw new TypeError('impulse energy classifier requires a bounded provider runner');
  }

  // 两个闪念调用和拆解 / 补全走同一条截止线、同一份 trace（runWithFallback）。它们刻意没有本地兜底：
  // “兜底客户端”直接失败，模型不可用就什么都不改。
  const NO_FALLBACK = Object.freeze({
    id: 'none',
    run: async () => { throw new Error('no-local-fallback'); }
  });
  async function classify(name, feature, resultKey, impulseText) {
    const settings = getSettings();
    if (settings.aiBreakdownEnabled !== true || settings[feature] !== true) {
      return { ok: false, reason: `${name}-disabled` };
    }
    if (!credentialStore.status().configured) return { ok: false, reason: 'provider-credential-missing' };
    const checkCurrent = () => {
      const current = getSettings();
      return current.aiBreakdownEnabled === true && current[feature] === true
        && current.aiModel === settings.aiModel && current.aiBaseUrl === settings.aiBaseUrl
        && credentialStore.status().configured === true;
    };
    let lease;
    const assertCurrent = () => {
      lease?.assertCurrent();
      if (!checkCurrent()) throw new Error('provider-request-aborted');
    };
    try {
      lease = requestScope?.begin({ checkCurrent });
      const client = createApiClient({ baseUrl: settings.aiBaseUrl || defaultBaseUrl,
        model: settings.aiModel, timeoutMs, negotiation, getCredential: () => credentialStore.get() });
      assertCurrent();
      const options = { trace, signal: lease?.signal, assertCurrent };
      const payload = { impulseText };
      const generated = await runWithFallback(client, NO_FALLBACK, name, payload, options);
      if (generated.ok === false) return generated;
      try { assertCurrent(); }
      catch (_) {
        return { ok: false, reason: 'provider-request-aborted', cleanup: generated.cleanup };
      }
      return { ok: true, [resultKey]: generated.proposal, provider: generated.provider, cleanup: generated.cleanup };
    } catch (error) {
      // No local energy/category guess, including a revoked late result.
      return { ok: false, reason: failureReason(error) };
    } finally { lease?.release(); }
  }
  function analyze({ impulseText } = {}) {
    return classify('impulse-energy', 'aiImpulseEnergyEnabled', 'classification', impulseText);
  }
  function triage({ impulseText } = {}) {
    return classify('capture-triage', 'aiCaptureTriageEnabled', 'triage', impulseText);
  }

  return Object.freeze({ analyze, triage });
}

module.exports = { createImpulseEnergyClassifier };
