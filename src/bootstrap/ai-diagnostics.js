'use strict';
const { guidance } = require('../capabilities');
const { entityFingerprint } = require('../application/ai/entity-fingerprint');
const buildMetadata = require('../../package.json');

function hasDiagnosticsCapability(metadata) {
  const capability = metadata?.bubuCapabilities;
  return capability?.schemaVersion === 1 && capability?.aiDiagnostics === true;
}
function sourceIdentity(kind, entity) {
  if (!entity) return null;
  return Object.freeze({ kind, id: entity.id, fingerprint: entityFingerprint(entity) });
}
function createAiDiagnosticsRuntime({ readSnapshot, now = Date.now, schedule = setTimeout, cancelSchedule = clearTimeout,
  metadata = buildMetadata } = {}) {
  const inspector = guidance.aiDiagnostics.createAiDiagnostics({ available: hasDiagnosticsCapability(metadata), now, schedule, cancelSchedule,
    isSourceCurrent(source) {
      const snapshot = readSnapshot();
      if (source.kind === 'tags') return source.fingerprint === entityFingerprint((snapshot.tasks || []).map(task => task.tags || []));
      const entity = (source.kind === 'impulse' ? snapshot.impulses : snapshot.tasks)?.find(item => item.id === source.id);
      if (!entity) return false;
      // Classification is allowed to change; only captured text identity grants retention.
      const value = source.kind === 'impulse' ? { id: entity.id, text: entity.text, createdAt: entity.createdAt } : entity;
      return entityFingerprint(value) === source.fingerprint
        && (!source.tagsFingerprint || source.tagsFingerprint === entityFingerprint((snapshot.tasks || []).map(task => task.tags || [])));
    }
  });
  function begin(task, reference) {
    try {
      if (!inspector.status().active) return null;
      let source = null;
      if (reference?.impulseId) {
        const entity = readSnapshot().impulses.find(item => item.id === reference.impulseId);
        if (!entity) return null;
        source = sourceIdentity('impulse', { id: entity.id, text: entity.text, createdAt: entity.createdAt });
      } else if (reference?.taskId) {
        const entity = readSnapshot().tasks.find(item => item.id === reference.taskId);
        if (!entity) return null;
        source = sourceIdentity('task', entity);
        if (task === 'enrich') source = Object.freeze({ ...source,
          tagsFingerprint: entityFingerprint(readSnapshot().tasks.map(item => item.tags || [])) });
      }
      if (task === 'enrich' && !source) source = Object.freeze({ kind: 'tags',
        fingerprint: entityFingerprint((readSnapshot().tasks || []).map(item => item.tags || [])) });
      return inspector.begin(task, source);
    } catch (_) { return null; }
  }
  const proposalRuns = new Map();
  function bindProposal(id, run) {
    if (!run) return;
    proposalRuns.set(id, run);
    while (proposalRuns.size > 50) proposalRuns.delete(proposalRuns.keys().next().value);
  }
  function proposalResult(id, result) {
    try {
      proposalRuns.get(id)?.finish(result?.ok === true ? 'proposal-command-succeeded' : result?.reason || 'application-outcome-unknown',
        result?.ok === false ? false : null);
    } catch (_) { /* Accepted work cannot be retried because observation failed. */ }
  }
  function register(registerIpc, lifecycle) {
    const respond = (method, payload) => {
      if (method !== 'status' && !inspector.status().available) return { ok: false, reason: 'diagnostics-unavailable' };
      return inspector[method](payload);
    };
    registerIpc('ai:diagnostics-status', () => respond('status'));
    registerIpc('ai:diagnostics-start', () => respond('start'));
    registerIpc('ai:diagnostics-stop', () => respond('stop'));
    registerIpc('ai:diagnostics-list', () => respond('list'));
    registerIpc('ai:diagnostics-clear', () => respond('clear'));
    registerIpc('ai:diagnostics-export', () => respond('exportMetadata'));
    registerIpc('ai:diagnostics-detail', (_event, payload) => respond('detail', payload));
    lifecycle?.register('ai:diagnostics', inspector.dispose);
  }
  return Object.freeze({ ...inspector, begin, register, bindProposal, proposalResult, close: inspector.dispose });
}
module.exports = { createAiDiagnosticsRuntime, hasDiagnosticsCapability };
