'use strict';

const { entityFingerprint } = require('./entity-fingerprint');

const MAX_CAPTURE_TRIAGE_STATUSES = 256;
const UNKNOWN = Object.freeze({ state: 'unknown', reason: 'unavailable' });
const FAILURE_CODES = new Set([
  'capture-triage-apply-failed', 'capture-triage-unavailable', 'provider-credential-missing', 'provider-model-missing', 'provider-timeout',
  'provider-network-error', 'provider-http-error', 'proposal-rejected',
  'provider-response-invalid-json', 'provider-response-html', 'provider-response-event-stream',
  'provider-response-empty', 'provider-response-missing-output', 'provider-response-too-large',
  'invalid-provider-endpoint', 'provider-endpoint-port-not-allowed',
  'provider-endpoint-host-not-allowed', 'provider-endpoint-address-not-allowed',
  'provider-endpoint-resolves-private', 'provider-budget', 'provider-output-budget'
]);

function eligible(impulse) {
  return impulse && typeof impulse.id === 'string' && Number.isFinite(impulse.createdAt)
    && typeof impulse.text === 'string' && !impulse.resolution && !impulse.classification && !impulse.triage;
}
function identity(impulse) {
  return entityFingerprint({ id: impulse.id, at: impulse.createdAt, text: impulse.text });
}
function outcomeStatus(result, previous) {
  if (result?.reason === 'capture-triage-disabled') return previous.state === 'running'
    ? { state: 'interrupted', reason: 'cancelled' } : { state: 'skipped', reason: 'disabled' };
  if (result?.reason === 'capture-triage-unsure') return { state: 'uncertain', reason: 'uncertain' };
  if (result?.reason === 'provider-request-aborted') return { state: 'interrupted', reason: 'cancelled' };
  const code = result?.failureCode || result?.reason;
  return { state: 'failed', reason: FAILURE_CODES.has(code) ? code : 'provider-failed' };
}

// ARCHITECTURE「随手记分拣」: process observations, never canonical capture data.
// Tokens identify one run; fingerprints retain no note text. Reads cannot prune,
// start calls, infer a past failure, or mutate either the registry or a snapshot.
function createCaptureTriageStatus({ readSnapshot, publish = () => {} }) {
  const records = new Map();
  let closed = false;
  const notify = () => { try { publish(); } catch (_) { /* Observation cannot retry work. */ } };
  function sources() {
    try { const items = readSnapshot().impulses; return Array.isArray(items) ? items : []; }
    catch (_) { return []; }
  }
  function current(token) {
    if (closed || !token || records.get(token.id)?.token !== token) return false;
    const impulse = sources().find(item => item.id === token.id);
    return eligible(impulse) && identity(impulse) === token.source;
  }
  function suggestionCurrent(impulse, record) {
    return record?.suggestion && impulse && !impulse.resolution && !impulse.classification
      && identity(impulse) === record.token.source && impulse.triage?.category === 'log'
      && impulse.triage.at === record.suggestion.triageAt
      && impulse.triage.routineKind === record.suggestion.routineKind;
  }
  function prune(impulses) {
    const items = new Map(impulses.map(item => [item.id, item]));
    for (const [id, record] of records) {
      const item = items.get(id);
      if (!suggestionCurrent(item, record) && (!eligible(item) || identity(item) !== record.token.source)) records.delete(id);
    }
  }
  function begin(fact) {
    if (closed) return null;
    const impulses = sources();
    prune(impulses);
    const impulse = impulses.find(item => item.id === fact?.impulseId && item.createdAt === fact?.capturedAt);
    if (!eligible(impulse)) return null;
    const token = Object.freeze({ id: impulse.id, source: identity(impulse) });
    records.delete(impulse.id);
    records.set(impulse.id, { token, status: UNKNOWN });
    while (records.size > MAX_CAPTURE_TRIAGE_STATUSES) records.delete(records.keys().next().value);
    return token;
  }
  function running(token) {
    if (!current(token)) return;
    records.get(token.id).status = Object.freeze({ state: 'running', reason: 'running' });
    notify();
  }
  function finish(token, result) {
    if (closed || !token || records.get(token.id)?.token !== token) return;
    const record = records.get(token.id);
    const impulse = sources().find(item => item.id === token.id);
    if (result?.changed && Number.isSafeInteger(result.occurredAt) && result.occurredAt >= 0
        && impulse && identity(impulse) === token.source && !impulse.classification && !impulse.resolution
        && impulse.triage?.category === 'log' && impulse.triage.at === result.triageAt
        && impulse.triage.routineKind === result.routineKind) {
      record.suggestion = { triageAt: result.triageAt, routineKind: result.routineKind };
      record.status = Object.freeze({ state: 'suggested', reason: 'explicit-time', occurredAt: result.occurredAt });
    } else if (!current(token) || result?.changed || result?.reason === 'impulse-stale') {
      records.delete(token.id);
    } else records.get(token.id).status = Object.freeze(outcomeStatus(result, records.get(token.id).status));
    prune(sources());
    notify();
  }
  function read(impulse) {
    if (closed || !impulse) return null;
    const record = records.get(impulse.id);
    if (suggestionCurrent(impulse, record)) return record.status;
    if (!eligible(impulse)) return null;
    return record?.token.source === identity(impulse) ? record.status : UNKNOWN;
  }
  return Object.freeze({ begin, running, finish, read,
    dispose() { closed = true; records.clear(); } });
}

module.exports = { createCaptureTriageStatus, MAX_CAPTURE_TRIAGE_STATUSES };
