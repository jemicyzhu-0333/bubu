'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRuntimeJson } = require('../src/platform/persistence/sqlite/config-runtime-json');
const parse = text => parseRuntimeJson(Buffer.from(text));

test('bounded runtime JSON handles escaped keys, strings, arrays and native scalar types', () => {
  const value = { 'escaped"key': { children: [true, false, null, -12.4e3, '中文\\\n'] } };
  assert.deepEqual(parse(' \n' + JSON.stringify(value) + '\t'), value);
});

for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}']) {
  test(`duplicate runtime keys are rejected: ${value}`, () => assert.throws(() => parse(value), /duplicate/));
}

test('runtime metadata decoding fails closed on malformed UTF-8, JSON, BOM, size and depth', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('\ufeff{}'), Buffer.from(''), Buffer.alloc(65537, 32), Buffer.from('{"broken":')]) {
    assert.throws(() => parseRuntimeJson(bytes));
  }
  assert.throws(() => parse('['.repeat(14) + ']'.repeat(14)), /complexity/);
  assert.throws(() => parse(JSON.stringify(Array(513).fill(1))), /complexity/);
  assert.throws(() => parse('{"x":1e999}'), /number/);
});
