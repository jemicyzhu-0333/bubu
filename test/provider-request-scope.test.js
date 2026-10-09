'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderRequestScope } = require('../src/application/ai/provider-request-scope');

test('leases release independently; invalidation aborts every remaining epoch and permits fresh work', () => {
  const scope = createProviderRequestScope();
  const first = scope.begin(), second = scope.begin();
  first.assertCurrent(); second.assertCurrent(); first.release(); first.release();
  assert.throws(first.assertCurrent, /provider-request-aborted/);
  second.assertCurrent(); scope.invalidate();
  assert.equal(second.signal.aborted, true); assert.throws(second.assertCurrent, /provider-request-aborted/);
  const fresh = scope.begin(); fresh.assertCurrent(); second.release(); fresh.assertCurrent(); fresh.release();
});
test('dynamic checks fail closed and old work never revives when settings are restored', () => {
  const scope = createProviderRequestScope(); let enabled = true;
  const lease = scope.begin({ checkCurrent: () => enabled });
  enabled = false; assert.throws(lease.assertCurrent, /provider-request-aborted/);
  enabled = true; assert.throws(lease.assertCurrent, /provider-request-aborted/); lease.release();
  const changedBack = scope.begin(); scope.invalidate(); scope.invalidate();
  assert.throws(changedBack.assertCurrent, /provider-request-aborted/); changedBack.release();
});
test('close is permanent, aborts active work, and checks never leak failed leases', () => {
  const scope = createProviderRequestScope();
  assert.throws(() => scope.begin({ checkCurrent: () => false }), /provider-request-aborted/);
  const active = scope.begin(); scope.close(); scope.close(); scope.invalidate();
  assert.equal(active.signal.aborted, true); assert.throws(active.assertCurrent, /provider-request-aborted/);
  assert.throws(() => scope.begin(), /provider-request-aborted/); active.release();
});

test('invalidation snapshots old leases so an abort observer can safely start a fresh generation', () => {
  const scope = createProviderRequestScope(); const old = scope.begin(); let fresh;
  old.signal.addEventListener('abort', () => { fresh = scope.begin(); }, { once: true });
  scope.invalidate(); assert.equal(old.signal.aborted, true); fresh.assertCurrent();
  assert.equal(fresh.signal.aborted, false); old.release(); fresh.release(); scope.close();
});
