'use strict';

const { postJson, parseEndpoint, ProviderHttpError } = require('./transport');
const { protocolEndpoint, PROTOCOLS } = require('./endpoint');
const { extractText, isProtocolMissing } = require('./openai');

function extractProbeText(protocol, response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || response.error
    || (response.status !== undefined && response.status !== 'completed' && response.status !== 'incomplete')) {
    throw new Error('provider-response-invalid-envelope');
  }
  if (protocol === 'chat-completions') {
    const message = response.choices?.[0]?.message;
    if (!message || message.role !== 'assistant' || message.refusal) throw new Error('provider-response-invalid-envelope');
    return extractText(protocol, response);
  } else {
    if (Array.isArray(response.output)) {
      const textMessage = response.output.find(item => item?.type === 'message' && item.role === 'assistant'
        && Array.isArray(item.content) && item.content.some(part => part?.type === 'output_text' && typeof part.text === 'string'));
      if (!textMessage) throw new Error('provider-response-invalid-envelope');
      return extractText(protocol, { output: [textMessage] });
    } else if (typeof response.output_text !== 'string') throw new Error('provider-response-invalid-envelope');
    return response.output_text;
  }
}

// A manual, fixed-content probe. It deliberately has no trace, conversation,
// usage-ledger, negotiation-cache or repair callback. A response proves model
// access, not compatibility with every structured task the app may run later.
async function probeConnection({ model, baseUrl, apiKey, signal, timeoutMs = 20_000,
  assertCurrent = () => {}, post = postJson } = {}) {
  let requests = 0;
  for (const protocol of PROTOCOLS) {
    const endpoint = protocolEndpoint(baseUrl, protocol);
    parseEndpoint(endpoint);
    let completionTokens = false;
    for (;;) {
      assertCurrent();
      if (signal?.aborted) throw new Error('provider-request-aborted');
      const message = { role: 'user', content: 'Connection test. Reply with one short word.' };
      const body = protocol === 'responses'
        ? { model, stream: false, input: [message], max_output_tokens: 32 }
        : { model, stream: false, messages: [message],
          [completionTokens ? 'max_completion_tokens' : 'max_tokens']: 32 };
      try {
        requests++;
        const response = await post(endpoint, body, { apiKey, signal, timeoutMs });
        assertCurrent();
        if (signal?.aborted) throw new Error('provider-request-aborted');
        const text = extractProbeText(protocol, response);
        if (typeof text !== 'string' || !text.trim()) throw new Error('provider-response-empty');
        if (text.length > 4096) throw new Error('provider-response-too-large');
        return { protocol, requests };
      } catch (error) {
        assertCurrent();
        if (signal?.aborted) throw new Error('provider-request-aborted');
        // A finite compatibility fallback, only when the provider explicitly
        // rejects this output-limit parameter. Never retry auth, quota or 5xx.
        if (protocol === 'chat-completions' && !completionTokens && error instanceof ProviderHttpError
          && [400, 422].includes(error.statusCode) && /\bmax_tokens\b/i.test(error.detail)) {
          completionTokens = true;
          continue;
        }
        if (protocol === PROTOCOLS[0] && isProtocolMissing(error)) break;
        throw error;
      }
    }
  }
  throw new Error('provider-response-missing-output');
}

// Only fixed codes and a numeric HTTP status cross the main/renderer boundary.
// Provider messages can echo credentials (including transformed fragments), so
// neither arbitrary messages nor raw response bodies are redacted-and-forwarded.
function connectionFailure(error) {
  try { return classifyFailure(error); } catch (_) { return { reason: 'request-failed' }; }
}
function ownValue(error, key) {
  return error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;
}
function classifyFailure(error) {
  const status = error instanceof ProviderHttpError ? ownValue(error, 'statusCode') : null;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return {
    reason: status === 401 ? 'authentication' : status === 403 ? 'permission'
      : status === 404 ? 'model-or-route' : status === 429 ? 'rate-limit'
        : status >= 500 ? 'provider-unavailable' : 'http-error', httpStatus: status
  };
  const value = ownValue(error, 'message');
  const message = typeof value === 'string' ? value : '';
  const code = ownValue(error, 'code');
  if (message === 'provider-credential-missing') return { reason: 'credential-missing' };
  if (message === 'provider-timeout') return { reason: 'timeout' };
  if (message === 'provider-request-aborted') return { reason: 'cancelled' };
  if (/^(invalid-provider-endpoint|provider-endpoint-)/.test(message)) return { reason: 'endpoint-blocked' };
  if (/^provider-response-/.test(message)) return { reason: 'invalid-response' };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return { reason: 'dns' };
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(code)) return { reason: 'tls' };
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(code)) return { reason: 'network' };
  return { reason: 'request-failed' };
}

module.exports = { probeConnection, connectionFailure };
