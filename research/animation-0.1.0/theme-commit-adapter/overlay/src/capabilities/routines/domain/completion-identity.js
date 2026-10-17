'use strict';
const id = x => typeof x === 'string' && x.length > 0 && x.length <= 128;
const time = x => Number.isSafeInteger(x) && x >= 0 && x <= 8.64e15;
function normalizeCompletion(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).sort().join(',') !== 'committedAt,deadlineOccurredAt,definitionId,generation,mappingVersion,occurredAt,origin'
      || !id(raw.generation) || !time(raw.occurredAt) || !time(raw.committedAt)
      || !time(raw.deadlineOccurredAt) || raw.deadlineOccurredAt > raw.occurredAt
      || raw.occurredAt > raw.committedAt
      || !['live_completion','historical_backfill'].includes(raw.origin)
      || !(raw.definitionId === null || id(raw.definitionId))
      || !(raw.mappingVersion === null || id(raw.mappingVersion))) throw new TypeError('invalid-routine-completion');
  return { ...raw };
}
function newCompletion({ generation, at, committedAt, origin, definitionId = null, mappingVersion = null }) {
  if (!generation) return null; // Legacy direct callers cannot invent a live completion.
  return normalizeCompletion({ generation, occurredAt:at, committedAt, origin, definitionId, mappingVersion, deadlineOccurredAt:at });
}
module.exports = { normalizeCompletion, newCompletion };
