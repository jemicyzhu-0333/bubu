'use strict';
const { closed, id, time, KINDS } = require('./memory-protocol');
const { jsonValue } = require('./ai-change-protocol');
const FIELDS = Object.freeze(['kind', 'subject', 'body', 'scope', 'expiresAt']);
const exact = (value, keys) => jsonValue(value) && closed(value, keys) && Object.keys(value).length === keys.length;
const text = (value, limit) => typeof value === 'string' && value.trim() && [...value].length <= limit;
function validateMemoryInput(input) {
  if (!exact(input, FIELDS) || !KINDS.includes(input.kind) || !text(input.subject, 200) || !text(input.body, 500)
    || !['global', 'work', 'personal'].includes(input.scope) || input.expiresAt !== null && !time(input.expiresAt)) {
    throw new TypeError('collaboration-memory-candidate-invalid');
  }
  return { kind: input.kind, subject: input.subject.trim(), body: input.body.trim(), scope: input.scope, expiresAt: input.expiresAt };
}
function validateMemoryProposal(value) {
  if (exact(value, ['memoryCandidate'])) return { memoryCandidate: validateMemoryInput(value.memoryCandidate) };
  if (!exact(value, ['memoryChange'])) throw new TypeError('collaboration-memory-change-invalid');
  const change = value.memoryChange;
  const keys = change?.operation === 'update' ? ['operation', 'id', 'input'] : ['operation', 'id'];
  if (!exact(change, keys) || !['update', 'forget'].includes(change.operation) || !id(change.id)) {
    throw new TypeError('collaboration-memory-change-invalid');
  }
  return { memoryChange: { operation: change.operation, id: change.id,
    ...(change.operation === 'update' ? { input: validateMemoryInput(change.input) } : {}) } };
}
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const inputSchema = object({ kind: { type: 'string', enum: KINDS }, subject: string(200), body: string(500),
  scope: { type: 'string', enum: ['global', 'work', 'personal'] }, expiresAt: { anyOf: [{ type: 'null' },
    { type: 'integer', minimum: 0, maximum: 8640000000000000 }] } });
const identity = { ...string(200), pattern: '^[a-zA-Z0-9_.:-]{1,200}$' };
const memoryProposalSchemas = Object.freeze([object({ memoryCandidate: inputSchema }),
  object({ memoryChange: object({ operation: { type: 'string', enum: ['update'] }, id: identity, input: inputSchema }) }),
  object({ memoryChange: object({ operation: { type: 'string', enum: ['forget'] }, id: identity }) })]);
module.exports = { validateMemoryInput, validateMemoryProposal, memoryProposalSchemas };
