'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA_MODES,
  requiredModel,
  buildChatRequest,
  buildResponsesRequest,
  buildRequest,
  extractMessageText,
  extractResponsesText,
  extractText,
  isSchemaModeRejection,
  isProtocolMissing,
  nextSchemaMode,
  nextProtocol,
  strictSchema
} = require('../src/core/llm/openai');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { PROPOSAL_JSON_SCHEMA } = require('../src/core/breakdown-proposal');
const { normalizePersistedState } = require('../src/platform/persistence/persisted-schema');

const schema = PROPOSAL_JSON_SCHEMA;
const messages = [
  { role: 'system', content: 'instruction' },
  { role: 'user', content: '{"title":"写周报"}' }
];

// 计费用哪个模型是用户设置，它的默认值只在 DEFAULT_SETTINGS 里存在一次。协议层
// 再写一个默认，就等于让设置面板和真正发出去的请求对“现在跑的是什么”各说一套。
test('the default model is declared once, in the settings schema, and never in the protocol layer', () => {
  const settings = normalizePersistedState({ settings: {} }, { now: 1_000 }).settings;
  assert.ok(settings.aiModel, '设置里必须有一个默认模型');
  assert.throws(() => requiredModel(''), /model is required/);
  assert.throws(() => requiredModel(undefined), /model is required/);
  assert.equal(requiredModel('  qwen3-max '), 'qwen3-max');
  assert.throws(() => buildChatRequest({ model: '', messages, schema, schemaName: 'x', mode: 'json_schema' }));
});

// 与旧实现最大的区别在这一条：两个档位都真的把 schema 交给了模型。旧的
// json_object 分支把算好的 schema 直接丢掉，模型从头到尾没见过字段约束，
// 于是只能猜字段名和取值范围——猜错的代价是整份作废。
test('every schema mode actually puts the schema in front of the model', () => {
  assert.deepEqual([...SCHEMA_MODES], ['json_schema', 'json_object']);

  const strict = buildChatRequest({ model: 'm', messages, schema, schemaName: 'im_adhder_breakdown', mode: 'json_schema' });
  assert.deepEqual(strict.response_format, {
    type: 'json_schema',
    json_schema: { name: 'im_adhder_breakdown', strict: true, schema: strictSchema(schema) }
  });
  assert.equal(strict.stream, false);
  assert.deepEqual(strict.messages, messages, 'json_schema 档位不改动消息');

  const loose = buildChatRequest({ model: 'm', messages, schema, schemaName: 'im_adhder_breakdown', mode: 'json_object' });
  assert.deepEqual(loose.response_format, { type: 'json_object' });
  assert.equal(loose.messages.length, messages.length + 1);
  const inlined = loose.messages[0].content;
  assert.equal(loose.messages[0].role, 'system');
  assert.ok(inlined.includes(JSON.stringify(schema)), 'json_object 档位必须把 schema 贴进提示词');
  // 字段说明是这次事故的根因修复，降级后同样要在场。
  assert.ok(inlined.includes('Zero-based index'), '降级后 dependsOn 的编号约定不能丢');

  assert.throws(() => buildChatRequest({ model: 'm', messages, schema, schemaName: 'x', mode: 'text' }), /unknown schema mode/);
  assert.throws(() => buildChatRequest({ model: 'm', messages: [], schema, schemaName: 'x', mode: 'json_schema' }), /messages are required/);
});

test('response unwrapping accepts both content shapes and refuses to invent an answer', () => {
  assert.equal(extractMessageText({ choices: [{ message: { content: '{"steps":[]}' } }] }), '{"steps":[]}');
  // 有些网关把内容拆成分片。取第一个带 text 的分片，而不是拼接全部：后面的
  // 分片通常是思维链或引用，混进 JSON 里会直接解析失败。
  assert.equal(
    extractMessageText({ choices: [{ message: { content: [{ text: '{}' }, { text: 'reasoning' }] } }] }),
    '{}'
  );
  assert.throws(() => extractMessageText({ choices: [] }), /missing-output/);
  assert.throws(() => extractMessageText({}), /missing-output/);
  assert.throws(() => extractMessageText({ choices: [{ message: {} }] }), /missing-output/);
});

// 降级只在“对面看不懂这个参数”时才是对的。401/403 是凭据问题，429 是限流，
// 5xx 是对面自己的故障——这些换 response_format 一次也不会变好，只会多烧一次
// 额度和一段用户在转圈里等的时间。
//
// 这一条同时替掉了旧实现按主机名嗅探协议的做法：能力是运行时探出来的，
// 不是硬编码 `hostname === 'idealab.alibaba-inc.com'` 猜出来的。
test('schema mode is negotiated from what the provider says, never from its hostname', () => {
  for (const detail of [
    'Unsupported parameter: response_format',
    'Invalid value for json_schema',
    'Unrecognized request argument supplied: response_format',
    'structured outputs are not supported for this model'
  ]) {
    assert.equal(isSchemaModeRejection(new ProviderHttpError(400, detail)), true, detail);
  }
  for (const error of [
    new ProviderHttpError(401, 'Incorrect API key provided'),
    new ProviderHttpError(403, 'response_format forbidden for this key'),
    new ProviderHttpError(429, 'Rate limit reached'),
    new ProviderHttpError(500, 'internal error: response_format'),
    new ProviderHttpError(400, 'model not found'),
    new Error('provider-timeout')
  ]) {
    assert.equal(isSchemaModeRejection(error), false, error.message);
  }

  assert.equal(nextSchemaMode('json_schema'), 'json_object');
  assert.equal(nextSchemaMode('json_object'), null, '最后一档之后没有可降的，必须失败关闭');
  assert.equal(nextSchemaMode('nonsense'), null);
});

// ---- 协议这一维 ----
// Responses 的字段名与 Chat Completions 完全不同：input 而不是 messages，
// text.format 而不是 response_format。发错字段名会被对面读成“缺参数”，
// 而那与“协议不对”在错误信息里长得一样。
test('the Responses shape carries the schema under text.format, and both rungs still hand it over', () => {
  const strict = buildResponsesRequest({ model: 'm', messages, schema, schemaName: 'im_adhder_breakdown', mode: 'json_schema' });
  assert.deepEqual(strict.text, {
    format: { type: 'json_schema', name: 'im_adhder_breakdown', strict: true, schema: strictSchema(schema) }
  });
  assert.deepEqual(strict.input, messages, 'json_schema 档位不改动输入');
  assert.equal(strict.messages, undefined);
  assert.equal(strict.response_format, undefined);
  assert.equal(strict.stream, false);

  const loose = buildResponsesRequest({ model: 'm', messages, schema, schemaName: 'x', mode: 'json_object' });
  assert.deepEqual(loose.text, { format: { type: 'json_object' } });
  assert.equal(loose.input.length, messages.length + 1);
  assert.ok(loose.input[0].content.includes(JSON.stringify(schema)), '降级后 schema 必须进提示词');
  assert.ok(loose.input[0].content.includes('Zero-based index'), '降级后编号约定不能丢');

  assert.throws(() => buildResponsesRequest({ model: 'm', messages, schema, schemaName: 'x', mode: 'text' }), /unknown schema mode/);
  assert.throws(() => buildResponsesRequest({ model: 'm', messages: [], schema, schemaName: 'x', mode: 'json_schema' }), /messages are required/);
});

test('buildRequest and extractText dispatch on protocol and refuse an unknown one', () => {
  const args = { model: 'm', messages, schema, schemaName: 'x', mode: 'json_schema' };
  assert.ok(buildRequest({ protocol: 'chat-completions', ...args }).messages);
  assert.ok(buildRequest({ protocol: 'responses', ...args }).input);
  assert.ok(buildRequest(args).messages, '默认走偏好那一档');
  assert.throws(() => buildRequest({ protocol: 'grpc', ...args }), /unknown protocol/);

  assert.equal(extractText('chat-completions', { choices: [{ message: { content: '{}' } }] }), '{}');
  assert.equal(extractText('responses', { output_text: '{"a":1}' }), '{"a":1}');
  assert.throws(() => extractText('grpc', { output_text: '{}' }), /unknown protocol/);
});

test('Responses unwrapping reads output_text or the nested output blocks, and never invents an answer', () => {
  assert.equal(extractResponsesText({ output_text: '{"steps":[]}' }), '{"steps":[]}');
  assert.equal(
    extractResponsesText({
      output: [
        { content: [{ type: 'reasoning', text: 'thinking' }] },
        { content: [{ type: 'output_text', text: '{"steps":[]}' }] }
      ]
    }),
    '{"steps":[]}',
    '只认 output_text 分片：推理分片混进 JSON 里会直接解析失败'
  );
  assert.throws(() => extractResponsesText({ output: [] }), /missing-output/);
  assert.throws(() => extractResponsesText({}), /missing-output/);
  assert.throws(() => extractResponsesText({ output: [{ content: [{ type: 'reasoning', text: 'x' }] }] }), /missing-output/);
});

// “这个路由没有”与“这个参数不支持”是两件事，混起来会在一个不存在的路由上
// 反复降档，而降多少次都还是 404。
test('a missing route is told apart from an unsupported parameter', () => {
  assert.equal(isProtocolMissing(new ProviderHttpError(404, 'Cannot POST /openai/plus/chat/completions')), true);
  assert.equal(isProtocolMissing(new ProviderHttpError(405, 'Method Not Allowed')), true);
  for (const error of [
    new ProviderHttpError(400, 'Unsupported parameter: response_format'),
    new ProviderHttpError(401, 'Incorrect API key provided'),
    new ProviderHttpError(429, 'Rate limit reached'),
    new ProviderHttpError(500, 'internal error'),
    new Error('provider-timeout')
  ]) {
    assert.equal(isProtocolMissing(error), false, error.message);
  }

  assert.equal(nextProtocol('chat-completions'), 'responses');
  assert.equal(nextProtocol('responses'), null, '最后一种之后没有可换的，必须失败关闭');
  assert.equal(nextProtocol('grpc'), null);
});

test('strict mode drops string length limits and rewrites const, without touching property names', () => {
  const input = {
    type: 'object',
    required: ['minLength', 'status'],
    properties: {
      minLength: { type: 'string', minLength: 1, maxLength: 5 },
      status: { const: 'ready' },
      nested: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'string', maxLength: 9 } }] }
    }
  };
  const strict = strictSchema(input);
  assert.deepEqual(strict.properties.minLength, { type: 'string' }, 'a property named minLength survives');
  assert.deepEqual(strict.properties.status, { enum: ['ready'] });
  assert.deepEqual(strict.properties.nested.anyOf[1].items, { type: 'string' });
  assert.deepEqual(input.properties.minLength.maxLength, 5, 'the source schema is not mutated');
  assert.ok(!JSON.stringify(strictSchema(PROPOSAL_JSON_SCHEMA)).includes('Length"'));
  // json_object 档位把原 schema 贴进提示词：长度约束在那里仍然可见。
  const loose = buildChatRequest({ model: 'm', messages, schema: input, schemaName: 'x', mode: 'json_object' });
  assert.ok(loose.messages[0].content.includes('"maxLength":5'));
});
