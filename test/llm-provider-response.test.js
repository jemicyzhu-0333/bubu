'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { parseProviderResponse, responseContentKind } = require('../src/core/llm/provider-response');
const { postJson, ProviderHttpError } = require('../src/core/llm/transport');
const { createLlmTrace } = require('../src/core/llm/trace');

test('HTTP envelope decoding permits BOM and honest JSON without repairing content', () => {
  for (const type of [undefined, 'application/json; charset=utf-8', 'text/plain']) {
    assert.deepEqual(parseProviderResponse('\uFEFF {"choices":[]}', type), { choices: [] });
  }
  for (const [body, type, code] of [
    ['<!doctype html><html>PRIVATE_PAGE</html>', undefined, 'html'],
    ['<body>PRIVATE_PAGE</body>', 'text/html', 'html'],
    ['data: {"choices":[]}\n\n', undefined, 'event-stream'],
    ['event: response.completed\ndata: {}', 'text/event-stream', 'event-stream'],
    ['\uFEFF  ', 'application/json', 'empty'],
    ['```json\n{}\n```', 'application/json', 'invalid-json'],
    ['PRIVATE_BROKEN_JSON', 'application/json', 'invalid-json']
  ]) assert.throws(() => parseProviderResponse(body, type), error => error.message === `provider-response-${code}`);
});

test('content type is reduced to a fixed enum without private parameters or coercion', () => {
  assert.equal(responseContentKind('APPLICATION/JSON; token=PRIVATE_HEADER'), 'json');
  assert.equal(responseContentKind('application/problem+json'), 'json');
  assert.equal(responseContentKind('text/html; private=secret'), 'html');
  assert.equal(responseContentKind('PRIVATE_HEADER'), 'other');
  assert.equal(responseContentKind({ toString() { throw Error('must not coerce'); } }), 'unknown');
});

function mockResponse(t, { body, type = 'application/json', status = 200 }) {
  let requests = 0, headers;
  t.mock.method(https, 'request', (_url, options, callback) => {
    requests++; headers = options.headers;
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => request;
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = { 'content-type': type };
      response.destroy = () => {};
      callback(response);
      // Split inside the multibyte BOM, as real HTTP chunks can do.
      const bytes = Buffer.from(body);
      response.emit('data', bytes.subarray(0, 1));
      response.emit('data', bytes.subarray(1));
      response.emit('end');
    });
    return request;
  });
  return { get requests() { return requests; }, get headers() { return headers; } };
}
const lookup = async () => [{ address: '8.8.8.8', family: 4 }];

for (const [body, type, expected] of [
  ['\uFEFF {"choices":[]}', 'application/json', null],
  ['<html>PRIVATE_RESPONSE</html>', 'text/html; private=PRIVATE_HEADER', 'html'],
  ['data: PRIVATE_RESPONSE\n\n', 'text/event-stream', 'event-stream'],
  ['', 'application/json', 'empty'],
  ['PRIVATE_RESPONSE', 'application/json', 'invalid-json']
]) test(`real transport classifies mocked HTTP 200 ${expected || 'BOM JSON'} without retry or private logging`, async t => {
  const mock = mockResponse(t, { body, type });
  const lines = [];
  const span = createLlmTrace({ enabled: true, sink: line => lines.push(line) }).begin();
  const call = postJson('https://provider.example/v1/chat/completions?private=PRIVATE_QUERY',
    { private: 'PRIVATE_PROMPT' }, { lookup, span, apiKey: 'PRIVATE_KEY' });
  if (expected) await assert.rejects(call, error => error.message === `provider-response-${expected}`);
  else assert.deepEqual(await call, { choices: [] });
  assert.equal(mock.requests, 1);
  assert.equal(mock.headers.accept, 'application/json');
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_|provider\.example|Bearer/);
  assert.match(lines.join('\n'), /contentKind=(json|html|event-stream)/);
});

test('non-2xx provider errors retain protocol negotiation rather than becoming HTML-success errors', async t => {
  mockResponse(t, { body: '<html>route absent</html>', type: 'text/html', status: 404 });
  await assert.rejects(postJson('https://provider.example/v1/chat/completions', {}, { lookup }),
    error => error instanceof ProviderHttpError && error.statusCode === 404);
});
