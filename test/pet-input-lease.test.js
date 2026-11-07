'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { INPUT_LEASE_SCOPE, readInputLeaseCapability, readInputLeaseRequest } = require('../src/core/pet-input-lease.mjs');
const { createPetInputLease } = require('../src/platform/electron/windows/pet-input-lease');
const epoch = '1dd436f1-3f49-4aeb-91bc-4fe9f766fbcc';
const capability = () => ({ schemaVersion: 1, epoch, viewRevision: 1, available: true, ttlMs: 300, renewMs: 100, scope: INPUT_LEASE_SCOPE });
const request = () => ({ schemaVersion: 1, epoch, viewRevision: 1, contactGeneration: 1, sequence: 1, phase: 'begin' });
test('input lease contracts return closed immutable copies without mutating source values', () => {
  for (const [read, source] of [[readInputLeaseCapability, capability()], [readInputLeaseRequest, request()]]) {
    const copy = read(source);
    assert.deepEqual(copy, source); assert.notEqual(copy, source); assert(Object.isFrozen(copy));
    source.epoch = 'changed'; assert.equal(copy.epoch, epoch);
  }
  assert(readInputLeaseCapability({ ...capability(), available: false, viewRevision: 0 }));
});
test('input lease capability rejects forged availability, TTL, scope and non-v4 identity', () => {
  for (const patch of [{ schemaVersion: 2 }, { epoch: '1dd436f1-3f49-1aeb-91bc-4fe9f766fbcc' },
    { epoch: epoch + 'x' }, { viewRevision: 0 }, { viewRevision: -1 }, { viewRevision: Infinity },
    { available: 1 }, { ttlMs: 301 }, { renewMs: 101 }, { scope: 'OS-capture' }, { extra: true }]) {
    assert.equal(readInputLeaseCapability({ ...capability(), ...patch }), null);
  }
});
test('input lease request rejects unknown fields, accessors, exotic objects and unsafe counters', () => {
  for (const key of ['viewRevision', 'contactGeneration', 'sequence']) {
    for (const value of [0, -1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1']) {
      assert.equal(readInputLeaseRequest({ ...request(), [key]: value }), null);
    }
  }
  for (const source of [null, [], Object.assign(Object.create(null), request()), { ...request(), phase: 'capture' },
    { ...request(), [Symbol('extra')]: 1 }, { ...request(), extra: 1 }, { ...request(), epoch: 'bad' }]) {
    assert.equal(readInputLeaseRequest(source), null);
  }
  const source = request(); let ran = false;
  Object.defineProperty(source, 'epoch', { get() { ran = true; throw Error('not data'); } });
  assert.equal(readInputLeaseRequest(source), null); assert.equal(ran, false);
  assert.equal(readInputLeaseRequest(new Proxy({}, { getPrototypeOf() { throw Error('proxy'); } })), null);
});
test('clock regression revokes rather than extending an active lease', () => {
  let at = 100, id = 0;
  const lease = createPetInputLease({ now: () => at, newEpoch: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` });
  lease.observe({ revision: 1, available: true }, { revision: 1 }, true);
  const begin = { ...request(), epoch: lease.capability().epoch };
  assert.equal(lease.apply(begin).ok, true);
  at = 99;
  assert.equal(lease.apply({ ...begin, phase: 'renew', sequence: 2 }).ok, false);
  assert.equal(lease.capability().available, false); assert.equal(lease.isActive(), false);
});
