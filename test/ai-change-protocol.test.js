'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCandidateOperations: validate, changeProposalSchema, OPERATION_TYPES } = require('../src/core/ai-change-protocol');
const create = { type: 'task.create', input: { title: 'Start', steps: [{ title: 'Open file' }] } };
test('closed candidate accepts only six bounded proposal operations', () => {
  assert.equal(validate([create]).ok, true);
  for (const field of ['confirmed', 'ownerId', 'expectedVersion', 'hash', 'path', 'commandId', 'allocatedIds']) {
    assert.equal(validate([{ ...create, [field]: true }]).ok, false, field);
  }
  for (const type of ['commit', 'task.complete', 'memory.write', 'routine.log', 'settings.update', 'task.delete', 'task.restore']) {
    assert.equal(validate([{ type }]).ok, false, type);
  }
  assert.equal(validate(Array.from({ length: 21 }, () => create)).ok, false);
  assert.equal(validate([]).ok, false);
});
test('candidate validates dates, exact field values, unfinished step grammar and schedule without coercion', () => {
  for (const input of [{ title: '' }, { title: ' trimmed ' }, { title: 'A', estimateMinutes: '5' },
    { title: 'A', plannedFor: '2026-02-30' }, { title: 'A', tags: ['same', 'same'] },
    { title: 'A', steps: [{ title: 'Done', done: true }] }]) assert.equal(validate([{ type: 'task.create', input }]).ok, false);
  assert.equal(validate([{ type: 'task.steps', entityId: 'task', steps: [{ op: 'remove', stepId: 'step' }] }]).ok, false);
  assert.equal(validate([{ type: 'routine.schedule', entityId: 'routine', schedule: {
    frequency: 'weekly', timesOfDay: ['10:00'], weekdays: [9], windowMinutes: 60 } }]).ok, false);
});
test('malicious accessors, sparse arrays, symbols, prototypes and non-JSON values are rejected without evaluation', () => {
  let invoked = 0;
  const accessor = { input: create.input }; Object.defineProperty(accessor, 'type', { enumerable: true, get() { invoked++; return 'task.create'; } });
  assert.equal(validate([accessor]).ok, false); assert.equal(invoked, 0);
  assert.equal(validate(new Array(1)).ok, false);
  const symbol = { ...create, [Symbol('private')]: true }; assert.equal(validate([symbol]).ok, false);
  assert.equal(validate([{ ...create, input: Object.create({ title: 'inherited' }) }]).ok, false);
  assert.equal(validate([{ ...create, input: { title: 'A', estimateMinutes: NaN } }]).ok, false);
  assert.equal(validate([{ ...create, toJSON() { invoked++; return create; } }]).ok, false); assert.equal(invoked, 0);
});
test('model schema variants are fully closed and contain no commit or confirmation route', () => {
  const variants = changeProposalSchema.properties.operations.items.oneOf;
  assert.deepEqual(variants.map(item => item.properties.type.const), OPERATION_TYPES);
  assert.ok(variants.every(item => item.additionalProperties === false));
  assert.ok(variants.every(item => !('opId' in item.properties) && !('expectedVersion' in item.properties)));
});
