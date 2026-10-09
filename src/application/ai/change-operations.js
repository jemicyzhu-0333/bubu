'use strict';
const { isDeepStrictEqual } = require('node:util');
const { work, routines, guidance, execution } = require('../../capabilities');
const { ROUTINE_EFFECT_PROFILES } = require('../../content/energy-effects.mjs');
const { entityFingerprint } = require('./entity-fingerprint');

const BUSINESS_WRITES = Object.freeze(['tasks', 'recurrenceSeries', 'impulses', 'routines', 'energySignals']);
const FIELDS = Object.freeze({ task: ['title', 'description', 'steps', 'tags', 'estimateMinutes', 'plannedFor',
  'energy', 'energyAuto', 'suggestedMin', 'estimateSource', 'nextAction'],
recurrenceSeries: ['title', 'description', 'tags', 'energy', 'energyAuto', 'estimateMinutes', 'stepTitles'],
inbox: ['classification', 'resolution', 'energySignalIds'], routine: ['schedule'] });
function entity(state, ref) {
  if (ref.kind === 'task') return state.tasks.find(item => item.id === ref.id) || null;
  if (ref.kind === 'recurrenceSeries') return state.recurrenceSeries.find(item => item.id === ref.id) || null;
  if (ref.kind === 'routine') return state.routines.find(item => item.id === ref.id) || null;
  const record = state.impulses.find(item => item.id === ref.id);
  return record ? { ...record, energySignals: state.energySignals.filter(signal =>
    signal.source === 'impulse-ai' && signal.referenceId === ref.id) } : null;
}
function version(state, ref) { const value = entity(state, ref); return { ...ref, fingerprint: value ? entityFingerprint(value) : null }; }
function targetRefs(state, operation) {
  if (operation.type === 'task.create') return [];
  const kind = operation.type.startsWith('task.') ? 'task' : operation.type.startsWith('inbox.') ? 'inbox' : 'routine';
  const refs = [{ kind, id: operation.entityId }];
  const task = kind === 'task' ? entity(state, refs[0]) : null;
  if (task?.seriesId && operation.scope === 'current-and-future') refs.push({ kind: 'recurrenceSeries', id: task.seriesId });
  return refs;
}
function presentation(value, kind) {
  if (!value) return null;
  if (kind === 'recurrenceSeries') return value.template;
  if (kind === 'inbox') return { classification: value.classification, resolution: value.resolution
    ? { action: value.resolution.action, category: value.resolution.category, targetId: value.resolution.targetId } : null,
    energySignalIds: value.energySignals.map(signal => signal.id).sort() };
  return value;
}
function reversibility(operation, changed = true) {
  const reason = !changed ? 'no-change' : ['task.restore', 'routine.restore-schedule'].includes(operation.type) ? 'compensation-not-reversible' : operation.type === 'task.create' ? 'creation-not-reversible'
    : operation.type.startsWith('inbox.') ? 'inbox-consumption-not-reversible' : null;
  return { status: reason ? 'unavailable' : 'available', reason };
}
function diffFor(before, after, refs, operation) {
  const requested = new Set(operation.type === 'task.update' ? Object.keys(operation.patch)
    : operation.type === 'task.steps' ? ['steps'] : FIELDS[refs[0]?.kind] || []);
  return refs.map(ref => {
    const left = presentation(entity(before, ref), ref.kind), right = presentation(entity(after, ref), ref.kind);
    const fields = [], derivedChanges = [];
    for (const field of FIELDS[ref.kind]) {
      const prior = left?.[field] ?? null, next = right?.[field] ?? null;
      if (isDeepStrictEqual(prior, next)) continue;
      (requested.has(field) || operation.type === 'task.create' ? fields : derivedChanges)
        .push({ field, before: structuredClone(prior), after: structuredClone(next) });
    }
    return { opId: operation.opId, type: operation.type, entityRef: ref, fields, derivedChanges,
      reversibility: reversibility(operation, fields.length + derivedChanges.length > 0) };
  });
}
function options(ports, createId) { return { ...ports.taskPolicies, createId, focusPolicy: execution.focusSession }; }
function applyOne(state, op, at, ports) {
  let cursor = 0;
  const createId = kind => {
    const allocated = op.allocatedIds[cursor++];
    if (!allocated || allocated.kind !== kind) throw new Error('change-id-conflict');
    return allocated.id;
  };
  if (op.type === 'task.create' || op.type === 'inbox.convert-task') {
    const created = work.taskCreation.createTask(state, { ...op.input, energy: 'auto' }, { ...options(ports, createId), now: at });
    if (!created.ok || op.type === 'task.create') return created;
    const classified = work.inboxRecords.classifyImpulse(state, { id: op.entityId, category: 'task' });
    if (!classified.ok) return classified;
    guidance.energySignals.removeImpulseEnergySignal(state, op.entityId);
    return work.inboxRecords.resolveRecord(state, op.entityId,
      { action: 'promote', category: 'task', at, targetId: created.task.id });
  }
  if (op.type === 'task.update' || op.type === 'task.steps') return work.taskEditing.updateTaskGuarded(state,
    { taskId: op.entityId, scope: op.scope, now: at, patch: op.type === 'task.steps' ? { steps: op.steps } : op.patch }, options(ports, createId));
  if (op.type === 'task.restore') return work.taskEditing.restoreTask(state, { ...op, now: at }, options(ports, createId));
  if (op.type === 'inbox.keep') {
    const classified = work.inboxRecords.classifyImpulse(state, { id: op.entityId, ...op.classification });
    if (!classified.ok) return classified;
    guidance.energySignals.removeImpulseEnergySignal(state, op.entityId);
    return work.inboxRecords.resolveRecord(state, op.entityId,
      { action: 'keep', category: op.classification.category, at, targetId: null });
  }
  return routines.scheduleEditing.updateSchedule(state, { routineId: op.entityId, schedule: op.schedule,
    timezone: op.timezone, currentTimezone: ports.getTimezone(), now: at }, { profiles: ROUTINE_EFFECT_PROFILES });
}
function inverseFor(before, after, op, refs) {
  if (reversibility(op).status !== 'available') return null;
  if (op.type === 'routine.schedule') return { type: 'routine.restore-schedule', entityId: op.entityId,
    timezone: op.timezone, schedule: structuredClone(entity(before, refs[0]).schedule) };
  if (!['task.update', 'task.steps'].includes(op.type)) return null;
  const prior = entity(before, refs[0]), next = entity(after, refs[0]);
  const fields = work.taskEditing.RESTORABLE_FIELDS.filter(field => !isDeepStrictEqual(prior[field], next[field]))
    .map(field => ({ field, value: structuredClone(prior[field]) }));
  const steps = next.steps.flatMap(step => {
    const old = prior.steps.find(item => item.id === step.id);
    return !old ? [{ op: 'remove', stepId: step.id }] : old.title !== step.title ? [{ op: 'rename', stepId: step.id, title: old.title }] : [];
  });
  const seriesRef = refs.find(ref => ref.kind === 'recurrenceSeries');
  const priorSeries = seriesRef ? entity(before, seriesRef).template : null;
  const nextSeries = seriesRef ? entity(after, seriesRef).template : null;
  const seriesFields = priorSeries ? work.taskEditing.RESTORABLE_SERIES_FIELDS
    .filter(field => !isDeepStrictEqual(priorSeries[field], nextSeries[field]))
    .map(field => ({ field, value: structuredClone(priorSeries[field]) })) : [];
  return { type: 'task.restore', entityId: op.entityId, scope: op.scope || 'current', fields, steps, seriesFields };
}
function simulateChanges(snapshot, operations, at, ports) {
  const state = structuredClone(snapshot), diff = [], results = [], inverses = [];
  try {
    for (const op of operations) {
      const before = structuredClone(state), refs = targetRefs(state, op);
      const outcome = applyOne(state, op, at, ports);
      if (!outcome.ok) return outcome;
      if (op.type === 'task.create' || op.type === 'inbox.convert-task') refs.push({ kind: 'task', id: op.allocatedIds[0].id });
      const normalized = ports.normalizeState(state, { now: at });
      if (!isDeepStrictEqual(state, normalized)) return { ok: false, reason: 'change-normalization-drift' };
      const changes = diffFor(before, state, refs, op);
      diff.push(...changes);
      const changed = changes.some(change => change.fields.length + change.derivedChanges.length > 0);
      if (!changed) for (const field of BUSINESS_WRITES) state[field] = before[field];
      results.push({ opId: op.opId, type: op.type, entityRefs: refs,
        beforeVersions: refs.filter(ref => entity(before, ref)).map(ref => version(before, ref)),
        afterVersions: refs.map(ref => version(state, ref)), changed });
      if (changed) {
        const inverse = inverseFor(before, state, op, refs);
        if (inverse) inverses.unshift(inverse);
      }
    }
    const undeclared = Object.keys(state).filter(key => !BUSINESS_WRITES.includes(key) && !isDeepStrictEqual(state[key], snapshot[key]));
    if (undeclared.length) return { ok: false, reason: 'change-write-set-invalid' };
    return { ok: true, state, diff, results, inverses };
  } catch (_) { return { ok: false, reason: 'change-transition-failed' }; }
}
module.exports = { BUSINESS_WRITES, FIELDS, entity, version, targetRefs, simulateChanges };
