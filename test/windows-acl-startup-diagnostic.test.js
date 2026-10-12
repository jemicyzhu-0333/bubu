'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, probe, CHILD_MS, TOTAL_MS } = require('../scripts/diagnose-windows-acl-startup.cjs');
test('ACL startup diagnostics contain only bounded fields, never native text', () => {
  const result = summarize({ elapsedMs: 12.4, status: null, signal: 'private-signal', errorCode: 'private-error',
    stdout: 'stage:input\nprivate-path-and-SID', stderr: 'private-account' });
  assert.deepEqual(result, { elapsedMs: 12, timeoutMs: 15000, status: null, signal: 'other', errorCode: 'other',
    stage: null, version: null, expectedOutput: false, stderrPresent: true });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test('ACL startup diagnostics recognize only fixed stage and numeric version protocols', () => {
  assert.equal(summarize({ elapsedMs: 1, stdout: 'stage:timeout' }).stage, 'timeout');
  assert.equal(summarize({ elapsedMs: 1, stdout: 'version:5.1.26100.1234' }).version, '5.1.26100.1234');
  for (const stdout of ['version:5.1.2\nprivate', 'version:5.1.1234567', 'stage:input\n']) {
    const result = summarize({ elapsedMs: 1, stdout });
    assert.equal(result.version, null); assert.equal(result.stage, null); assert.equal(result.expectedOutput, false);
  }
  assert.equal(CHILD_MS, 15000); assert.equal(TOTAL_MS, 150000);
});
test('diagnostic child output is sanitized without hiding failure status', async () => {
  const result = await probe(process.execPath, ['-e', "process.stdout.write('PRIVATE');process.stderr.write('PRIVATE');process.exitCode=7"], '', process.env, CHILD_MS);
  assert.equal(result.status, 7); assert.equal(result.expectedOutput, false); assert.equal(result.stderrPresent, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('diagnostic child respects the remaining budget and is terminated', async () => {
  const result = await probe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', process.env, 50);
  assert.equal(result.errorCode, 'ETIMEDOUT'); assert.notEqual(result.status, 0);
});
