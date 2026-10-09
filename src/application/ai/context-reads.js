'use strict';
const { authorizeRead, dayNumber, cursorOffset, MAX_CURSOR_OFFSET } = require('./context-grants');
const { contextRecords, memoryContextVersion } = require('./context-choices');
const { recallSelectedMemory } = require('../../core/memory-recall');
const { entityFingerprint } = require('./entity-fingerprint');
const { planningState } = require('../../capabilities/guidance');
const direct = operation => operation();

const TASK_FIELDS = Object.freeze(['id', 'version', 'title', 'done', 'steps', 'plannedFor', 'estimateMinutes', 'tags']);
const TIMELINE_KINDS = Object.freeze(['session.started', 'session.segment', 'session.completed',
  'task.completed', 'task.changed', 'inbox.captured', 'inbox.resolved', 'ai.change.applied', 'ai.change.reverted']);
function sourceRef(kind, item) { return { kind, id: item.id, revision: kind === 'memory' ? memoryContextVersion(item) : entityFingerprint(item) }; }
function activePlanningPreferences(snapshot, at) {
  if (!Number.isFinite(at) || !Array.isArray(snapshot?.planningPreferences?.items)) return null;
  return snapshot.planningPreferences.items.filter(item => planningState.preferenceValid(item)
    && item.updatedAt <= at && (item.expiresAt === null || item.expiresAt > at));
}
function page(items, args) {
  const offset = cursorOffset(args.cursor);
  const limit = args.limit || 20;
  return { items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length && offset + limit <= MAX_CURSOR_OFFSET ? `offset:${offset + limit}` : null,
    truncated: offset + limit < items.length };
}
function queryMatches(item, query, fields) {
  return !query || fields.some(field => String(item[field] || '').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}
function taskProjection(task, fields) {
  const result = {};
  for (const key of fields) {
    if (key === 'version') result.version = entityFingerprint(task);
    else if (key === 'steps') result.steps = (task.steps || []).map(step => ({ id: step.id, title: step.title, done: step.done === true }));
    else result[key] = structuredClone(task[key] === undefined ? null : task[key]);
  }
  return result;
}

function grantBinding(grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return null;
  const values = {};
  for (const key of ['id', 'ownerId', 'conversationId', 'purpose', 'providerId', 'authorizationGeneration']) {
    const descriptor = Object.getOwnPropertyDescriptor(grant, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    values[key] = descriptor.value;
  }
  for (const key of ['id', 'ownerId', 'conversationId', 'purpose', 'providerId']) {
    if (typeof values[key] !== 'string' || !values[key] || values[key].length > (key === 'providerId' ? 2048 : 200)) return null;
  }
  if (!Number.isSafeInteger(values.authorizationGeneration) || values.authorizationGeneration < 0) return null;
  return Object.freeze({ ...values, scopeGrantId: values.id });
}

function createContextReads({ grants, readSnapshot, timeline, memoryRecall, readEstimate = null, now = null } = {}) {
  if (typeof readSnapshot !== 'function') throw new TypeError('context-snapshot-required');
  if (!grants || typeof grants.resolve !== 'function') throw new TypeError('context-grant-authority-required');
  function authorityFor(grant) {
    const invalid = { ok: false, reason: 'scope-grant-invalid' };
    let binding;
    try { binding = grantBinding(grant); } catch (_) { return null; }
    if (!binding) return null;
    let canonical = null, refused = false;
    function current(invokeOwnedSource) {
      if (refused) return false;
      try {
        const resolve = invokeOwnedSource(() => grants.resolve);
        const result = invokeOwnedSource(() => resolve.call(grants, { scopeGrantId: binding.scopeGrantId, conversationId: binding.conversationId,
          providerId: binding.providerId, authorizationGeneration: binding.authorizationGeneration }));
        const value = result?.grant;
        if (result?.ok !== true || !value || !Object.isFrozen(value)
          || !value.selection || typeof value.selection !== 'object' || !Object.isFrozen(value.selection)
          || ['id', 'ownerId', 'conversationId', 'purpose', 'providerId', 'authorizationGeneration']
            .some(key => value[key] !== binding[key]) || (canonical && value !== canonical)) {
          refused = true; return false;
        }
        canonical = value;
        return true;
      } catch (_) { refused = true; return false; }
    }
    const authorityError = new Error('scope-grant-invalid');
    return Object.freeze({ run(operation, invokeOwnedSource = direct) {
      return invokeOwnedSource(() => {
        function invokeSource(source) {
          return invokeOwnedSource(() => {
            if (!current(invokeOwnedSource)) throw authorityError;
            try { return source(); }
            finally { if (!current(invokeOwnedSource)) throw authorityError; }
          });
        }
        if (!current(invokeOwnedSource)) return invalid;
        let result, failure, failed = false;
        try { result = operation(canonical, invokeSource); }
        catch (error) { failed = true; failure = error; }
        // Even unavailable/error returns must not carry data across revoked scope.
        if (!current(invokeOwnedSource)) return invalid;
        if (failed) throw failure;
        return result;
      });
    } });
  }
  function execute({ grant, request } = {}, invokeOwnedSource = direct) {
    const authority = invokeOwnedSource(() => authorityFor(grant));
    return authority ? authority.run((canonical, invokeSource) => executeAuthorized({ grant: canonical, request }, invokeSource), invokeOwnedSource)
      : { ok: false, reason: 'scope-grant-invalid' };
  }
  function selectedMemory(grant, invokeSource) {
    const ids = grant.selection.memoryIds || [];
    if (!ids.length) return { ok: true, items: [], authority: null };
    const snapshot = invokeSource(readSnapshot);
    if (snapshot?.settings?.aiMemoryEnabled !== true) return { ok: false, reason: 'memory-disabled' };
    const select = invokeSource(() => memoryRecall?.selected);
    return typeof select === 'function' ? invokeSource(() => select.call(memoryRecall, ids, invokeSource))
      : { ok: false, reason: 'memory-authority-unavailable' };
  }
  function memoryEvidence(result) {
    return { versions: result.items.map(item => [item.id, item.version]), authority: result.authority === null
      ? null : { ownerId: result.authority.ownerId, ledgerId: result.authority.ledgerId, sequence: result.authority.sequence } };
  }
  function fixedSelectionValidator(authority, expected) {
    // This closure retains only canonical identity and body-free primitive evidence.
    return (invokeOwnedSource = direct) => {
      try {
        return authority.run((grant, invokeSource) => {
          const current = selectedMemory(grant, invokeSource);
          if (!current.ok) return current;
          const evidence = memoryEvidence(current);
          return JSON.stringify(evidence) === JSON.stringify(expected) ? { ok: true }
            : { ok: false, reason: 'memory-context-invalid' };
        }, invokeOwnedSource);
      } catch (_) { return { ok: false, reason: 'memory-authority-unavailable' }; }
    };
  }
  function prepareMemorySelection({ grant } = {}, invokeOwnedSource = direct) {
    try {
      const authority = invokeOwnedSource(() => authorityFor(grant));
      if (!authority) return { ok: false, reason: 'scope-grant-invalid' };
      const selected = authority.run(selectedMemory, invokeOwnedSource);
      if (!selected.ok) return selected;
      return { ok: true, validate: fixedSelectionValidator(authority, memoryEvidence(selected)) };
    } catch (_) { return { ok: false, reason: 'memory-authority-unavailable' }; }
  }
  function executeAuthorized({ grant, request }, invokeSource) {
    const allowed = authorizeRead(grant, request);
    if (!allowed.ok) return allowed;
    const { name, args } = request;
    let snapshot;
    try { snapshot = invokeSource(readSnapshot); } catch (_) { snapshot = null; }
    const envelope = { ok: true, tool: name, trust: 'untrusted-data', items: [], nextCursor: null,
      asOfRevision: null, sourceRefs: [],
      coverage: { fromDay: grant.selection.fromDay, toDay: grant.selection.toDay,
        basis: 'selected-records', missingTime: 'unknown' }, truncated: false, availability: 'available',
      disclosure: { scopeGrantId: grant.id, fields: [], sourceIds: [] } };
    const unavailable = () => ({ ...envelope, availability: 'unavailable', coverage: { ...envelope.coverage,
      basis: 'unavailable' } });
    let raw = [], fields = [];
    if (name === 'task.read' || name === 'task.search') {
      fields = args.fields || TASK_FIELDS;
      if (!Array.isArray(fields) || !fields.length || fields.some(field => !TASK_FIELDS.includes(field))
          || new Set(fields).size !== fields.length) return { ok: false, reason: 'tool-fields-invalid' };
      if (!Array.isArray(snapshot?.tasks)) return unavailable();
      raw = snapshot.tasks.filter(item => grant.selection.taskIds.includes(item.id));
      raw = name === 'task.read' ? raw.filter(item => item.id === args.id)
        : raw.filter(item => queryMatches(item, args.query, ['title']));
      raw.sort((a, b) => a.id.localeCompare(b.id));
      const paged = page(raw, args);
      Object.assign(envelope, paged, { items: paged.items.map(item => taskProjection(item, fields)),
        sourceRefs: paged.items.map(item => sourceRef('task', item)) });
    } else if (name === 'inbox.search') {
      fields = ['id', 'version', 'createdAt', 'classification', 'text'];
      if (!Array.isArray(snapshot?.impulses)) return unavailable();
      raw = snapshot.impulses.filter(item => grant.selection.inboxIds.includes(item.id)
        && queryMatches(item, args.query, ['text']));
      raw.sort((a, b) => a.id.localeCompare(b.id));
      const paged = page(raw, args);
      Object.assign(envelope, paged, { items: paged.items.map(item => ({ id: item.id,
        version: entityFingerprint(item), createdAt: item.createdAt, classification: item.classification?.category || null,
        text: String(item.text || '') })), sourceRefs: paged.items.map(item => sourceRef('inbox', item)) });
    } else if (name === 'routine.search') {
      fields = ['id', 'version', 'title', 'kind', 'schedule'];
      const routines = contextRecords(snapshot, 'routine');
      if (routines === null) return unavailable();
      raw = routines.filter(item => (grant.selection.routineIds || []).includes(item.id)
        && queryMatches(item, args.query, ['title']));
      raw.sort((a, b) => a.id.localeCompare(b.id));
      const paged = page(raw, args);
      Object.assign(envelope, paged, { items: paged.items.map(item => ({ id: item.id,
        version: entityFingerprint(item), title: item.title, kind: item.kind,
        schedule: item.schedule ? { frequency: item.schedule.frequency, timesOfDay: [...item.schedule.timesOfDay],
          weekdays: [...item.schedule.weekdays], windowMinutes: item.schedule.windowMinutes } : null })),
        sourceRefs: paged.items.map(item => sourceRef('routine', item)) });
    } else if (name === 'memory.search') {
      if (snapshot?.settings?.aiMemoryEnabled !== true) return { ok: false, reason: 'memory-disabled' };
      const select = invokeSource(() => memoryRecall?.selected);
      const result = typeof select === 'function'
        ? invokeSource(() => select.call(memoryRecall, grant.selection.memoryIds || [], invokeSource))
        : { ok: false, reason: 'memory-authority-unavailable' };
      if (!result.ok) return result.reason === 'memory-authority-unavailable' ? unavailable() : result;
      fields = ['id', 'version', 'kind', 'subject', 'body', 'source', 'scope', 'expiresAt'];
      const paged = recallSelectedMemory(result.items, args);
      if (!paged.ok) return paged;
      Object.assign(envelope, { nextCursor: paged.nextCursor, truncated: paged.truncated,
        items: paged.items.map(item => ({ id: item.id, version: memoryContextVersion(item),
        kind: item.kind, subject: item.subject, body: item.body, source: item.source, scope: item.scope, expiresAt: item.expiresAt })),
        sourceRefs: paged.items.map(item => sourceRef('memory', item)) });
    } else if (name === 'planning.preferences.read') {
      raw = activePlanningPreferences(snapshot, typeof now === 'function' ? invokeSource(now) : NaN);
      if (raw === null) return unavailable();
      fields = ['id', 'version', 'startMinute', 'endMinute', 'demand', 'scope', 'expiresAt', 'source'];
      envelope.items = raw.map(item => Object.fromEntries(fields.map(field =>
        [field, field === 'version' ? entityFingerprint(item) : item[field]])));
      envelope.sourceRefs = raw.map(item => sourceRef('planning-preference', item));
      envelope.coverage.basis = 'user-confirmed-planning-preferences';
    } else if (name === 'energy.read') {
      if (typeof readEstimate !== 'function') return unavailable();
      const estimate = invokeSource(readEstimate);
      fields = ['taskEnergyDemand', 'userSelfReport', 'currentPlanningEstimate'];
      envelope.items = [{ taskEnergyDemand: null,
        userSelfReport: snapshot?.energyCheckIn ? { level: snapshot.energyCheckIn.level,
          occurredAt: snapshot.energyCheckIn.timestamp, source: 'user-self-report' } : null,
        currentPlanningEstimate: Number.isFinite(estimate?.level) ? { level: estimate.level,
          asOf: estimate.asOf || null, source: 'non-medical-estimate', confidence: estimate.confidence || 'unknown' } : null }];
      envelope.sourceRefs = [{ kind: 'energy', id: 'current', revision: entityFingerprint(envelope.items) }];
    } else {
      if (!timeline || timeline.available !== true || typeof timeline.readRange !== 'function') return unavailable();
      const result = invokeSource(() => timeline.readRange({ fromDay: args.fromDay, toDay: args.toDay }));
      if (!result || result.ok === false || !Array.isArray(result.items)) return unavailable();
      raw = result.items.filter(event => event.dayKey >= args.fromDay && event.dayKey <= args.toDay);
      if (name === 'activity.distribution') {
        fields = ['dayKey', 'focusMinutes', 'sessionCount'];
        const days = new Map();
        for (let day = dayNumber(args.fromDay); day <= dayNumber(args.toDay); day++) {
          days.set(new Date(day * 86400000).toISOString().slice(0, 10), { milliseconds: 0, sessions: new Set() });
        }
        for (const event of raw) {
          if (event.kind !== 'session.segment' || !days.has(event.dayKey)) continue;
          const day = days.get(event.dayKey);
          day.milliseconds += Math.max(0, Number(event.durationMs) || 0);
          if (event.sessionId) day.sessions.add(event.sessionId);
        }
        envelope.items = [...days].map(([dayKey, value]) => ({ dayKey,
          focusMinutes: Math.round(value.milliseconds / 60000 * 10) / 10, sessionCount: value.sessions.size }));
        envelope.coverage.basis = 'recorded-focus-only';
        const contributing = raw.filter(event => event.kind === 'session.segment');
        envelope.sourceRefs = contributing.slice(0, 50).map(item => sourceRef('activity', item));
        envelope.coverage.contributingRecordCount = contributing.length;
        envelope.coverage.provenanceTruncated = contributing.length > envelope.sourceRefs.length;
        envelope.coverage.sourceReferenceCount = envelope.sourceRefs.length;
        envelope.truncated = envelope.coverage.provenanceTruncated;
        envelope.disclosure.sourceCount = contributing.length;
      } else {
        fields = ['id', 'kind', 'occurredAt', 'taskId', 'sessionId', 'durationMs', 'commandId'];
        const kinds = args.kinds || TIMELINE_KINDS;
        if (!Array.isArray(kinds) || kinds.some(kind => !TIMELINE_KINDS.includes(kind))) {
          return { ok: false, reason: 'tool-kinds-invalid' };
        }
        raw = raw.filter(event => kinds.includes(event.kind));
        raw.sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
        const paged = page(raw, args);
        Object.assign(envelope, paged, { items: paged.items.map(item => Object.fromEntries(fields.map(key => [key, item[key] ?? null]))),
          sourceRefs: paged.items.map(item => sourceRef('timeline', item)) });
      }
    }
    const selectedKind = name.startsWith('task.') ? 'task' : name === 'inbox.search' ? 'inbox'
      : name === 'routine.search' ? 'routine' : null;
    if (selectedKind) {
      const requested = name === 'task.read' ? [args.id] : grant.selection[`${selectedKind}Ids`] || [];
      const existing = new Set((contextRecords(snapshot, selectedKind) || []).map(item => item.id));
      const missingSourceIds = requested.filter(id => !existing.has(id));
      envelope.coverage.requestedSourceCount = requested.length;
      envelope.coverage.missingSourceIds = missingSourceIds;
      if (missingSourceIds.length) envelope.availability = envelope.items.length ? 'partial' : 'unavailable';
      if (envelope.availability === 'unavailable') envelope.coverage.basis = 'unavailable';
    }
    envelope.asOfRevision = entityFingerprint({ tool: name, items: envelope.items, sourceRefs: envelope.sourceRefs });
    envelope.coverage.revisionScope = 'query-content';
    envelope.disclosure.fields = fields;
    envelope.disclosure.sourceIds = envelope.sourceRefs.map(ref => ref.id);
    return structuredClone(envelope);
  }
  function getContextTargetVersion({ kind, id } = {}, invokeSource = direct) {
    if (!['task', 'inbox', 'routine', 'memory', 'planning-preference'].includes(kind) || typeof id !== 'string') return null;
    try {
      const snapshot = invokeSource(readSnapshot);
      if (kind === 'memory') {
        if (snapshot?.settings?.aiMemoryEnabled !== true) return null;
        const getVersion = invokeSource(() => memoryRecall?.getVersion);
        if (typeof getVersion !== 'function') return null;
        const version = invokeSource(() => getVersion.call(memoryRecall, { id }, invokeSource));
        return version?.ok && version.contextAllowed === true
          && Number.isSafeInteger(version.version) && version.version > 0 ? memoryContextVersion(version) : null;
      }
      const records = kind === 'planning-preference' ? activePlanningPreferences(snapshot, typeof now === 'function' ? invokeSource(now) : NaN)
        : contextRecords(snapshot, kind);
      const item = records?.find(record => record.id === id);
      return item ? entityFingerprint(item) : null;
    } catch (_) { return null; }
  }
  function validateContextVersions(sourceRefs, invokeSource = direct) {
    if (!Array.isArray(sourceRefs)) return false;
    return sourceRefs.every(ref => !['task', 'inbox', 'routine', 'memory', 'planning-preference'].includes(ref?.kind)
      || (typeof ref.revision === 'string' && getContextTargetVersion(ref, invokeSource) === ref.revision));
  }
  return Object.freeze({ execute, prepareMemorySelection, getContextTargetVersion, validateContextVersions });
}
module.exports = { TASK_FIELDS, TIMELINE_KINDS, createContextReads };
