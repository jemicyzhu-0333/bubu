/** Pure theme eligibility ledger. No renderer/business mutation dependencies. */
import { types } from 'node:util';
export class ContractError extends Error {
  constructor(code, detail = '') { super(`${code}${detail ? `: ${detail}` : ''}`); this.name = 'ContractError'; this.code = code; }
}
const fail = (code, detail) => { throw new ContractError(code, detail); };
const need = (ok, code, detail) => { if (!ok) fail(code, detail); };
export const LIMITS = Object.freeze({maxRecords:4096,maxNamespaces:32,maxMappings:256,maxCapabilities:256,maxRequiredCapabilities:64,maxIdChars:128,maxDataNodes:1000000});
const MAX_STRING = LIMITS.maxIdChars;

// Inspect descriptors before reading. No user getters, coercion, toJSON or iterators run.
function data(value, depth = 0, budget = { n: 0 }) {
  need(++budget.n <= 1000000 && depth <= 24, 'DATA_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { need(value.length <= 65536, 'STRING_LIMIT'); return value; }
  if (typeof value === 'number') { need(Number.isSafeInteger(value), 'INTEGER_REQUIRED'); return value; }
  need(typeof value === 'object', 'PLAIN_DATA_REQUIRED');
  need(!types.isProxy(value), 'PROXY_REJECTED');
  const array = Array.isArray(value);
  need(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), 'PLAIN_DATA_REQUIRED');
  const keys = Reflect.ownKeys(value);
  const out = array ? [] : {};
  if (array) need(value.length <= 200000, 'ARRAY_LIMIT');
  for (const key of keys) {
    need(typeof key === 'string', 'SYMBOL_KEY');
    const d = Object.getOwnPropertyDescriptor(value, key);
    need(d && Object.hasOwn(d, 'value'), 'ACCESSOR_REJECTED');
    if (array && key === 'length') continue;
    need(d.enumerable, 'NONENUMERABLE_KEY');
    if (array) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, 'ARRAY_EXTRA_KEY');
    else need(key !== '__proto__' && key !== 'constructor' && key !== 'prototype', 'UNSAFE_KEY');
    Object.defineProperty(out, key, {value: data(d.value, depth + 1, budget), enumerable:true, configurable:true, writable:true});
  }
  if (array) need(keys.length === value.length + 1, 'ARRAY_HOLE');
  return out;
}
function shape(o, required, optional = []) {
  need(o !== null && typeof o === 'object' && !Array.isArray(o), 'OBJECT_REQUIRED');
  for (const k of required) need(Object.hasOwn(o, k), 'MISSING_FIELD', k);
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(o)) need(allowed.has(k), 'UNKNOWN_FIELD', k);
}
const id = x => need(typeof x === 'string' && x.trim().length > 0 && x.length <= MAX_STRING, 'ID_REQUIRED');
const uint = x => need(Number.isSafeInteger(x) && x >= 0, 'UNSIGNED_INTEGER_REQUIRED');
const positive = x => { uint(x); need(x > 0, 'POSITIVE_INTEGER_REQUIRED'); };
const oneOf = (x, values) => need(values.includes(x), 'ENUM_INVALID', String(x));
const bool = x => need(typeof x === 'boolean', 'BOOLEAN_REQUIRED');
const list = (a, limit) => need(Array.isArray(a) && a.length <= limit, 'LIST_INVALID');
const key = parts => JSON.stringify(parts);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const copy = x => JSON.parse(JSON.stringify(x));
function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
}
const kinds = ['routine', 'feed'];
const origins = ['live_completion', 'historical_backfill', 'history_edit', 'recovery_sync'];
const mappingKey = m => key([m.sourceKind, m.definitionId, m.mappingVersion]);
const identity = e => key([e.namespace, e.sourceKind, e.entityId, e.completionGeneration]);
const ordinalKey = e => key([e.namespace, e.completionOrdinal]);
const semantic = e => { const { eventId, receivedAt, ...rest } = e; return canonical(rest); };
function configInput(raw) {
  const c = data(raw);
  shape(c, ['schemaVersion', 'namespaces', 'maxRecords', 'mappings', 'capabilities']);
  need(c.schemaVersion === 1, 'SCHEMA_VERSION');
  list(c.namespaces, LIMITS.maxNamespaces); need(c.namespaces.length > 0, 'NAMESPACE_REQUIRED');
  c.namespaces.forEach(id); need(new Set(c.namespaces).size === c.namespaces.length, 'DUPLICATE_NAMESPACE');
  positive(c.maxRecords); need(c.maxRecords <= LIMITS.maxRecords, 'CAPACITY_LIMIT');
  list(c.capabilities, LIMITS.maxCapabilities); list(c.mappings, LIMITS.maxMappings);
  const caps = new Map();
  for (const a of c.capabilities) {
    shape(a, ['id', 'approved', 'runtimeReady', 'channel']); id(a.id); bool(a.approved); bool(a.runtimeReady);
    oneOf(a.channel, ['environment.overlay', 'body.action', 'face.semantic', 'prop']);
    need(!caps.has(a.id), 'DUPLICATE_CAPABILITY'); caps.set(a.id, a);
  }
  const maps = new Map();
  for (const m of c.mappings) {
    shape(m, ['sourceKind', 'definitionId', 'mappingVersion', 'themeId', 'recipeVersion', 'approved', 'presentationMode', 'overlayPolicyId', 'actionPolicyId', 'requiredCapabilities', 'assetPolicyDigest'], ['durationSec']);
    oneOf(m.sourceKind, kinds); ['definitionId','mappingVersion','themeId','recipeVersion','overlayPolicyId','assetPolicyDigest'].forEach(k => id(m[k]));
    bool(m.approved); oneOf(m.presentationMode, ['overlay_only', 'overlay_and_actions']);
    if (m.presentationMode === 'overlay_only') need(m.actionPolicyId === null, 'UNEXPECTED_ACTION_POLICY'); else id(m.actionPolicyId);
    list(m.requiredCapabilities, LIMITS.maxRequiredCapabilities); need(m.requiredCapabilities.length > 0, 'CAPABILITIES_REQUIRED'); m.requiredCapabilities.forEach(id);
    need(new Set(m.requiredCapabilities).size === m.requiredCapabilities.length, 'DUPLICATE_CAPABILITY_REFERENCE');
    if (Object.hasOwn(m, 'durationSec')) {
      positive(m.durationSec);
      need(m.sourceKind === 'routine' ? m.durationSec >= 600 && m.durationSec <= 900 : m.durationSec === 30, 'DURATION_POLICY');
    }
    const present = m.requiredCapabilities.map(x => caps.get(x));
    if (present.every(Boolean)) {
      need(present.some(x => x.channel === 'environment.overlay'), 'OVERLAY_CAPABILITY_REQUIRED');
      if (m.presentationMode === 'overlay_only') need(present.every(x => x.channel === 'environment.overlay'), 'MODE_CHANNEL_MISMATCH');
      else need(present.some(x => x.channel === 'body.action'), 'ACTION_CAPABILITY_REQUIRED');
    }
    need(!maps.has(mappingKey(m)), 'DUPLICATE_MAPPING'); maps.set(mappingKey(m), m);
  }
  return {c, caps, maps};
}
function eventInput(e, now, namespaces) {
  shape(e, ['schemaVersion','namespace','eventId','transactionId','sourceKind','entityId','completionGeneration','completionOrdinal','revision','operation','completionState','origin','postCommit','replayed','occurredAt','committedAt','receivedAt','timeDomain','original','deadlineOccurredAt','revokeReason']);
  need(e.schemaVersion === 1, 'SCHEMA_VERSION');
  ['namespace','eventId','transactionId','entityId','completionGeneration'].forEach(k => id(e[k]));
  need(namespaces.includes(e.namespace), 'UNKNOWN_NAMESPACE');
  oneOf(e.sourceKind, kinds); positive(e.completionOrdinal); positive(e.revision);
  oneOf(e.operation, ['complete','correct','edit','revoke']); oneOf(e.completionState, ['completed','revoked']); oneOf(e.origin, origins);
  need(e.postCommit === true, 'NOT_POSTCOMMIT'); need(e.replayed === false, 'REPLAY_RECEIPT_NOT_EVENT');
  need(e.timeDomain === 'trusted_utc_ms', 'UNTRUSTED_TIME');
  ['occurredAt','committedAt','receivedAt','deadlineOccurredAt'].forEach(k => uint(e[k]));
  need(e.occurredAt <= e.committedAt && e.committedAt <= e.receivedAt && e.receivedAt <= now, 'TIME_ORDER');
  shape(e.original, ['occurredAt','committedAt','origin','definitionId','mappingVersion']);
  uint(e.original.occurredAt); uint(e.original.committedAt); oneOf(e.original.origin, origins); id(e.original.definitionId); id(e.original.mappingVersion);
  need(e.original.occurredAt <= e.original.committedAt && e.original.committedAt <= e.committedAt, 'ORIGINAL_TIME_ORDER');
  need(e.deadlineOccurredAt <= e.original.occurredAt && e.deadlineOccurredAt <= e.occurredAt, 'DEADLINE_WATERMARK');
  if (e.operation === 'complete') need(e.completionState === 'completed', 'OPERATION_STATE');
  if (e.operation === 'revoke') need(e.completionState === 'revoked', 'OPERATION_STATE');
  if (e.completionState === 'revoked') id(e.revokeReason); else need(e.revokeReason === null, 'UNEXPECTED_REVOKE_REASON');
  need(e.original.occurredAt <= Number.MAX_SAFE_INTEGER - 900000, 'TIME_OVERFLOW');
}
function admission(e, maps, caps) {
  if (e.original.origin !== 'live_completion' || ['historical_backfill','recovery_sync'].includes(e.origin)) return {reason:'nonlive_or_noncompletion',mapping:null};
  if (e.operation !== 'complete') return {reason:'needs_reconciliation',mapping:null};
  if (e.origin !== 'live_completion') return {reason:'nonlive_or_noncompletion',mapping:null};
  const m = maps.get(key([e.sourceKind, e.original.definitionId, e.original.mappingVersion]));
  if (!m) return {reason: 'unknown_mapping', mapping: null};
  if (!m.approved) return {reason: 'mapping_not_approved', mapping: m};
  if (!m.requiredCapabilities.every(k => caps.get(k)?.approved && caps.get(k)?.runtimeReady)) return {reason: 'capability_not_ready', mapping: m};
  return {reason: 'eligible', mapping: m};
}
function duration(record) { return record.mapping?.durationSec ?? (record.first.sourceKind === 'routine' ? 600 : 30); }
function deadline(record) { return record.latest.deadlineOccurredAt + duration(record) * 1000; }
function originalDeadline(record) { return record.first.original.occurredAt + duration(record) * 1000; }

export function createLedger(rawConfig) {
  const {c, caps, maps} = configInput(rawConfig);
  let records = new Map(), ordinals = new Map(), lastNow = 0;
  let seals = new Map(c.namespaces.map(n => [n, {throughOrdinal: 0, checkpointId: null}]));
  function checkNow(now) { uint(now); need(now >= lastNow, 'CLOCK_ROLLBACK'); }
  function insert(target, indexes, e) {
    need(e.completionOrdinal > seals.get(e.namespace).throughOrdinal, 'SEALED_HISTORY');
    const k = identity(e), ok = ordinalKey(e), old = target.get(k);
    need(!indexes.has(ok) || indexes.get(ok) === k, 'ORDINAL_IDENTITY_CONFLICT');
    if (old) {
      need(old.first.completionOrdinal === e.completionOrdinal, 'IDENTITY_ORDINAL_CONFLICT');
      need(canonical(old.first.original) === canonical(e.original), 'ORIGINAL_CHANGED');
      if (e.revision < old.latest.revision) return 'stale';
      if (e.revision === old.latest.revision) { need(semantic(e) === semantic(old.latest), 'REVISION_CONFLICT'); return 'duplicate'; }
      need(e.committedAt >= old.latest.committedAt, 'COMMIT_ROLLBACK');
      need(e.deadlineOccurredAt <= old.latest.deadlineOccurredAt, 'DEADLINE_EXTENSION');
      target.set(k, {...old, latest:e}); return 'updated';
    }
    need(target.size < c.maxRecords, 'CAPACITY_REQUIRES_SEAL');
    const admitted = admission(e, maps, caps);
    target.set(k, {first:e, latest:e, ...admitted}); indexes.set(ok, k); return 'recorded';
  }
  const api = {
    applyBatch(rawEvents, now) {
      checkNow(now); const events = data(rawEvents); list(events, 100000);
      events.forEach(e => eventInput(e, now, c.namespaces));
      // Caller order is meaningful only for first admission. Sort each identity's
      // events by revision so a batch is equivalent to ordered authoritative updates.
      const ordered = events.map((e,index) => ({e,index})).sort((a,b) => compare(identity(a.e),identity(b.e)) || a.e.revision - b.e.revision || a.index-b.index);
      const next = new Map(records), idx = new Map(ordinals), results = new Array(events.length);
      for (const {e,index} of ordered) results[index] = insert(next, idx, e);
      records = next; ordinals = idx; lastNow = now;
      return {results, recordCount: records.size};
    },
    project(now) {
      checkNow(now); lastNow = now;
      const sources = [], themes = new Map();
      for (const [sourceId,r] of records) {
        const expiresAt = deadline(r);
        const active = r.reason === 'eligible' && r.latest.completionState === 'completed' && now < expiresAt;
        const status = r.latest.completionState === 'revoked' ? 'revoked' : r.reason !== 'eligible' ? r.reason : now >= expiresAt ? 'expired' : 'eligible';
        sources.push({sourceId, namespace:r.latest.namespace, completionOrdinal:r.latest.completionOrdinal, revision:r.latest.revision, themeId:r.mapping?.themeId ?? null, expiresAt: r.mapping ? expiresAt : null, originalDeadline: r.mapping ? originalDeadline(r) : null, active, status, admissionReason:r.reason, needsReconciliation:r.reason === 'needs_reconciliation', selected:false, visible:false, performing:false});
        if (active) {
          const t = themes.get(r.mapping.themeId) ?? {themeId:r.mapping.themeId, expiresAt:0, sourceIds:[], factActive:true, selected:false, visible:false, performing:false};
          t.expiresAt = Math.max(t.expiresAt, expiresAt); t.sourceIds.push(sourceId); themes.set(t.themeId,t);
        }
      }
      sources.sort((a,b) => compare(a.sourceId,b.sourceId));
      const activeThemes = [...themes.values()].sort((a,b) => compare(a.themeId,b.themeId));
      activeThemes.forEach(t => t.sourceIds.sort());
      return {now, sources, themes:activeThemes};
    },
    seal(namespace, throughOrdinal, checkpointId, now) {
      checkNow(now); id(namespace); need(seals.has(namespace), 'UNKNOWN_NAMESPACE'); uint(throughOrdinal); id(checkpointId);
      const old = seals.get(namespace); need(throughOrdinal > old.throughOrdinal, 'SEAL_NOT_ADVANCING');
      const next = new Map(records), idx = new Map(ordinals);
      let removed = 0;
      for (const [k,r] of records) {
        if (r.first.namespace !== namespace || r.first.completionOrdinal > throughOrdinal) continue;
        need(r.reason !== 'eligible' || now >= originalDeadline(r), 'SEAL_LIVE_RANGE');
        next.delete(k); idx.delete(ordinalKey(r.first)); removed++;
      }
      records = next; ordinals = idx; seals = new Map(seals); seals.set(namespace,{throughOrdinal,checkpointId}); lastNow = now;
      return {removed, throughOrdinal};
    },
    snapshot() {
      return copy({schemaVersion:1, config:c, lastNow, seals:[...seals.entries()].map(([namespace,v]) => ({namespace,...v})), records:[...records.values()].map(r => ({first:r.first,latest:r.latest}))});
    }
  };
  return Object.freeze(api);
}

export function restoreLedger(rawSnapshot, now) {
  const s = data(rawSnapshot);
  shape(s, ['schemaVersion','config','lastNow','seals','records']); need(s.schemaVersion === 1, 'SCHEMA_VERSION'); uint(s.lastNow); uint(now); need(now >= s.lastNow, 'CLOCK_ROLLBACK');
  const ledger = createLedger(s.config); list(s.seals,LIMITS.maxNamespaces); list(s.records,LIMITS.maxRecords);
  need(s.seals.length === s.config.namespaces.length, 'SEAL_NAMESPACE_SET');
  const ns = new Set();
  for (const seal of s.seals) {
    shape(seal,['namespace','throughOrdinal','checkpointId']); id(seal.namespace); uint(seal.throughOrdinal);
    need(s.config.namespaces.includes(seal.namespace) && !ns.has(seal.namespace), 'SEAL_NAMESPACE_SET'); ns.add(seal.namespace);
    if (seal.throughOrdinal === 0) need(seal.checkpointId === null, 'ZERO_SEAL_CHECKPOINT');
    else {id(seal.checkpointId); ledger.seal(seal.namespace,seal.throughOrdinal,seal.checkpointId,s.lastNow);}
  }
  const identities = new Set();
  for (const r of s.records) {
    shape(r,['first','latest']);
    eventInput(r.first,s.lastNow,s.config.namespaces); eventInput(r.latest,s.lastNow,s.config.namespaces);
    need(identity(r.first) === identity(r.latest), 'SNAPSHOT_IDENTITY_MISMATCH');
    need(!identities.has(identity(r.first)), 'DUPLICATE_SNAPSHOT_RECORD'); identities.add(identity(r.first));
    need(r.latest.revision >= r.first.revision, 'SNAPSHOT_REVISION_ORDER');
    ledger.applyBatch([r.first,r.latest],s.lastNow);
  }
  ledger.project(now); return ledger;
}
