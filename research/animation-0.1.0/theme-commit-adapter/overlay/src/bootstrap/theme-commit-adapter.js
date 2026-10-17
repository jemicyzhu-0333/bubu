'use strict';
// Converts canonical successful facts only. No animation callbacks, title heuristics,
// business-state writes, or recovery claims. The host owns ledger persistence/cursor.
function createThemeCommitAdapter({ ledger, namespace, clock, registry, reportError = () => {} }) {
  if (!ledger || typeof ledger.applyBatch !== 'function' || typeof clock?.now !== 'function'
      || typeof namespace !== 'string' || !namespace || namespace.length > 128) throw new TypeError('theme-adapter-ports');
  const mappings = registry?.mappings || [];
  const find = (kind, id, version) => mappings.find(m => m.sourceKind === kind && m.definitionId === id
    && (version === undefined || m.mappingVersion === version));
  function resolveMappingVersion(kind, id) { return find(kind, id)?.mappingVersion || null; }
  function toEvent(fact, receivedAt) {
    if (!fact || fact.postCommit !== true || fact.replayed === true || !Number.isSafeInteger(fact.revision)
        || fact.revision < 1 || typeof fact.commitEventId !== 'string') return null;
    const routine = fact.type === 'routine-logged' || fact.type === 'routine-log-undone';
    const feed = fact.type === 'companion-fed';
    if (!routine && !feed) return null;
    const c = routine ? fact.completion : { generation:fact.commandId, occurredAt:fact.fedAt,
      committedAt:fact.fedAt, origin:'live_completion', definitionId:fact.foodId,
      mappingVersion:fact.mappingVersion, deadlineOccurredAt:fact.fedAt };
    if (!c || !find(routine ? 'routine' : 'feed', c.definitionId, c.mappingVersion)) return null;
    const operation = fact.operation;
    if (!['complete','correct','edit','revoke'].includes(operation)) return null;
    if (routine && operation !== 'revoke' && fact.status !== 'done') return null;
    return {schemaVersion:2,namespace,eventId:fact.commitEventId,transactionId:`commit:${fact.revision}`,
      sourceKind:routine ? 'routine' : 'feed',entityId:routine ? fact.occurrenceId : fact.commandId,
      completionGeneration:c.generation,revision:fact.revision,operation,
      completionState:operation === 'revoke' ? 'revoked' : 'completed',origin:fact.origin,
      postCommit:true,replayed:false,occurredAt:routine ? fact.at : fact.fedAt,
      committedAt:fact.committedAt,receivedAt,timeDomain:'trusted_utc_ms',
      original:{occurredAt:c.occurredAt,committedAt:c.committedAt,origin:c.origin,
        definitionId:c.definitionId,mappingVersion:c.mappingVersion},deadlineOccurredAt:c.deadlineOccurredAt,
      revokeReason:operation === 'revoke' ? 'routine-completion-retracted' : null};
  }
  function publishCommitted(fact) {
    try {
      const now = clock.now();
      const event = toEvent(fact, now);
      if (!event) return { accepted:false, reason:'not-eligible-commit-fact' };
      ledger.applyBatch([event], now);
      return { accepted:true, event };
    } catch (error) {
      // Presentation failure never changes the successful business result.
      try { reportError(error); } catch {}
      return { accepted:false, reason:'theme-adapter-failed' };
    }
  }
  return Object.freeze({ publishCommitted, resolveMappingVersion, toEvent });
}
module.exports = { createThemeCommitAdapter };
