'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLlmTrace, formatFields } = require('../src/core/llm/trace');

function exercise(trace, fields = {}) {
  trace.selection(fields);
  trace.skipped(fields);
  trace.fallback(fields);
  trace.result(fields);
  const span = trace.begin(fields);
  span.request(fields);
  span.resolved('PRIVATE_ADDRESS');
  span.status(200);
  span.body('PRIVATE_BODY');
  span.output('PRIVATE_OUTPUT');
  span.note('PRIVATE_NOTE');
  span.done(fields);
  span.failed(fields, fields);
  return span;
}

test('all observations tolerate a throwing sink without leaking exception text', () => {
  let calls = 0;
  const trace = createLlmTrace({ enabled: true, now: () => 1,
    sink: () => { calls++; throw new Error('PRIVATE_SINK'); } });
  assert.doesNotThrow(() => exercise(trace));
  assert.equal(calls, 12);
});

test('asynchronously rejected observation sinks are consumed', async () => {
  let calls = 0;
  const trace = createLlmTrace({ enabled: true, now: () => 1,
    sink: () => { calls++; return Promise.reject(new Error('PRIVATE_SINK')); } });
  exercise(trace);
  await Promise.resolve();
  assert.equal(calls, 12);
});

for (const sample of [() => { throw new Error('PRIVATE_CLOCK'); }, () => NaN, () => Infinity]) {
  test('unavailable trace clocks omit elapsed time and preserve safe event metadata', () => {
    const lines = [];
    exercise(createLlmTrace({ enabled: true, now: sample, sink: line => lines.push(line) }),
      { kind: 'breakdown', provider: 'api', repairAttempts: 0 });
    assert.equal(lines.length, 12);
    assert.ok(lines.includes('[llm] ok kind=breakdown provider=api requestId=1 repairAttempts=0'));
    assert.ok(lines.every(line => !line.includes('elapsedMs=') && !line.includes('PRIVATE')));
  });
}

test('failure only at the completion clock cannot fabricate zero elapsed time', () => {
  const lines = [];
  let reads = 0;
  const trace = createLlmTrace({ enabled: true, sink: line => lines.push(line),
    now: () => { if (++reads > 1) throw new Error('PRIVATE_CLOCK'); return 10; } });
  trace.begin({ kind: 'enrich' }).done({ repairAttempts: 0 });
  assert.equal(lines.at(-1), '[llm] ok requestId=1 repairAttempts=0');
});

test('throwing and revoked proxy metadata is omitted without invoking getters or serialization', () => {
  const lines = [];
  const fields = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE_PROXY'); } });
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  for (const value of [fields, revocable.proxy]) {
    assert.equal(formatFields(value), '');
    assert.doesNotThrow(() => exercise(createLlmTrace({ enabled: true, now: () => 0,
      sink: line => lines.push(line) }), value));
  }
  assert.ok(lines.every(line => !line.includes('PRIVATE')));
});

test('metadata whitelist and healthy elapsed values remain unchanged', () => {
  const lines = [];
  let time = 10;
  const trace = createLlmTrace({ enabled: true, now: () => time, sink: line => lines.push(line) });
  const span = trace.begin({ kind: 'breakdown', provider: 'api', model: 'PRIVATE_MODEL' });
  time = 25;
  span.done({ repairAttempts: 1, body: 'PRIVATE_BODY', elapsedMs: 999 });
  assert.deepEqual(lines, ['[llm] begin kind=breakdown provider=api requestId=1',
    '[llm] ok requestId=1 repairAttempts=1 elapsedMs=15']);
});
