'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateStructured,
  isValidationFailure,
  repairPrompt,
  schemaModeKey,
  DEFAULT_MAX_REPAIR_ATTEMPTS
} = require('../src/core/llm/generate');
const {
  createApiClient,
  createDeterministicClient,
  failureReason
} = require('../src/core/llm');
const { createOneShotProviderRun } = require('../src/application/ai/one-shot-provider-run');
const { CLARIFY_TASK, MAX_TURNS } = require('../src/core/llm/tasks');
const {
  deterministicBreakdownProposal,
  deterministicEnrichProposal,
  deterministicUnstickProposal,
  deterministicClarifyProposal
} = require('../src/capabilities/guidance/domain/local-proposal');
const { ProviderHttpError } = require('../src/core/llm/transport');
const { buildDeterministicProposal } = require('../src/core/breakdown-proposal');

function providerHarness() {
  const timers = new Set();
  const runWithFallback = createOneShotProviderRun({
    now: () => 0,
    schedule(callback) { const timer = { callback }; timers.add(timer); return timer; },
    cancelSchedule(timer) { timers.delete(timer); }
  });
  return { runWithFallback, timers };
}

// 编排层不出网，所以这里给它一个能完全控制的假 provider。stub 记录每一次请求，
// 断言因此可以看“第二轮到底问了什么”——那正是回灌重试唯一有意义的地方。
// 回答形状跟着请求形状走（`input` 是 Responses，`messages` 是 Chat Completions），
// 否则测的就不是真实的解包路径。
function stubTask(replies, options = {}) {
  const sent = [];
  const endpoints = [];
  return {
    sent,
    endpoints,
    task: {
      name: 'stub',
      schemaName: 'stub_schema',
      instruction: 'do the thing',
      fields: ['title'],
      buildSchema: () => ({ type: 'object' }),
      buildInput: payload => ({ title: payload.title }),
      repair: raw => JSON.parse(raw),
      validate: options.validate || (value => value)
    },
    async post(endpoint, body) {
      endpoints.push(endpoint);
      sent.push(body);
      const reply = replies[sent.length - 1];
      if (reply instanceof Error) throw reply;
      return body.input
        ? { output_text: reply }
        : { choices: [{ message: { content: reply } }] };
    }
  };
}

function run(stub, extra = {}) {
  return generateStructured({
    task: stub.task,
    payload: { title: '写周报' },
    model: 'm',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'k',
    post: stub.post,
    ...extra
  });
}

test('a first-try success sends exactly one request, in the strongest schema mode', async () => {
  const stub = stubTask(['{"ok":true}']);
  assert.deepEqual(await run(stub), { ok: true });
  assert.equal(stub.sent.length, 1);
  assert.equal(stub.sent[0].response_format.type, 'json_schema');
  // 偏好那一档是 Chat Completions，所以第一发就打在那个路由上。
  assert.equal(stub.endpoints[0], 'https://api.example.test/v1/chat/completions');
});

// 对面看不懂 response_format 时降一档重发，而且这一次不算重试次数：模型还没有
// 机会答错任何东西，把它计入重试预算等于因为网关的能力问题惩罚模型。
test('a provider that rejects json_schema is downgraded once, without spending the repair budget', async () => {
  const stub = stubTask([
    new ProviderHttpError(400, 'Unsupported parameter: response_format'),
    '{"ok":true}'
  ]);
  assert.deepEqual(await run(stub), { ok: true });
  assert.equal(stub.sent.length, 2);
  assert.equal(stub.sent[0].response_format.type, 'json_schema');
  assert.equal(stub.sent[1].response_format.type, 'json_object');
  // 降级后 schema 仍然到了模型面前，只是换了通道。
  assert.equal(stub.sent[1].messages[0].role, 'system');
  assert.ok(stub.sent[1].messages[0].content.includes('JSON Schema'));
});

// 这一条是整次重构的核心：一次校验失败不再等于整份作废。校验器那句原文被原样
// 回灌，模型据此自我修正——Instructor 的 reask 和 PydanticAI 的 ModelRetry 都是
// 这个形状，也是唯一一类模型真能照着改的失败。
test('a validation failure is fed back verbatim and the model gets exactly one chance to fix it', async () => {
  let calls = 0;
  const stub = stubTask(['{"attempt":1}', '{"attempt":2}'], {
    validate: value => {
      calls += 1;
      if (calls === 1) throw new RangeError('steps[1].dependsOn must reference an earlier step');
      return value;
    }
  });
  assert.deepEqual(await run(stub), { attempt: 2 });
  assert.equal(stub.sent.length, 2);

  const retry = stub.sent[1].messages;
  assert.equal(retry.length, 4, '原来的两条 + 模型上一轮答案 + 回灌的错误');
  assert.equal(retry[2].role, 'assistant');
  assert.equal(retry[2].content, '{"attempt":1}', '模型必须看到自己上一轮说了什么');
  assert.equal(retry[3].role, 'user');
  assert.ok(
    retry[3].content.includes('steps[1].dependsOn must reference an earlier step'),
    '校验器那句原文就是修复指令，不要改写它'
  );
});

test('the repair budget is one, and exhausting it fails closed with the validation error', async () => {
  assert.equal(DEFAULT_MAX_REPAIR_ATTEMPTS, 1);
  const stub = stubTask(['{"a":1}', '{"a":2}', '{"a":3}'], {
    validate: () => { throw new RangeError('still wrong'); }
  });
  const error = await run(stub).then(() => null, thrown => thrown);
  assert.match(error.message, /still wrong/);
  assert.equal(stub.sent.length, 2, '一次重试，不是三次：面板上有个按钮在转圈');
  assert.equal(isValidationFailure(error), true);
  assert.equal(error.modelText, '{"a":2}', '错误上带着模型最后一次的原文');

  // 预算为 0 时一次都不重试。
  const once = stubTask(['{"a":1}'], { validate: () => { throw new RangeError('nope'); } });
  await assert.rejects(run(once, { maxRepairAttempts: 0 }), /nope/);
  assert.equal(once.sent.length, 1);
});

// 401/429/超时重发一次也不会变好，只会让用户在转圈里多等一轮。
test('transport failures are never retried, only classified', async () => {
  for (const failure of [
    new ProviderHttpError(401, 'Incorrect API key provided'),
    new ProviderHttpError(429, 'Rate limit reached'),
    new ProviderHttpError(500, 'bad gateway'),
    new Error('provider-timeout'),
    new Error('provider-request-aborted')
  ]) {
    const stub = stubTask([failure, '{"ok":true}']);
    const error = await run(stub).then(() => null, thrown => thrown);
    assert.equal(error.message, failure.message);
    assert.equal(stub.sent.length, 1, `${failure.message} 不该触发第二次请求`);
    assert.equal(isValidationFailure(error), false);
  }
});

// 截止线由 runWithFallback 统一持有，所以取消必须压住降级和重试两条路径，
// 否则一次重试就把用户的等待时间翻倍。
test('an aborted request stops the ladder instead of restarting it', async () => {
  const controller = new AbortController();
  controller.abort();
  const stub = stubTask([
    new ProviderHttpError(400, 'Unsupported parameter: response_format'),
    '{"ok":true}'
  ]);
  await assert.rejects(run(stub, { signal: controller.signal }), /provider-request-aborted/);
  assert.equal(stub.sent.length, 0, '预取消不发送');

  const validating = stubTask(['{"a":1}'], { validate: () => { throw new RangeError('wrong'); } });
  await assert.rejects(run(validating, { signal: controller.signal }), /provider-request-aborted/);
  assert.equal(validating.sent.length, 0, '预取消不发送');
});

test('the repair prompt names the error and asks for nothing but corrected JSON', () => {
  const prompt = repairPrompt('tags may only reuse existing tags');
  assert.ok(prompt.includes('tags may only reuse existing tags'));
  assert.match(prompt, /rejected by the schema validator/);
  assert.match(prompt, /nothing but the JSON/);
});

// 校验失败和网络失败都会回退，但一个说明“模型答得不合约定”，另一个说明
// “根本没连上”。不分开报，用户会按前者去查密钥和 Base URL，而那两样都是好的。
test('the fallback ladder tells a rejected answer apart from a connection that never happened', async () => {
  const { runWithFallback, timers } = providerHarness();
  const fallback = createDeterministicClient({
    breakdown: () => buildDeterministicProposal(['打开仓库', '写第一段', '保存'])
  });
  const rejected = Object.assign(new RangeError('steps[0].safeStopAfter must be boolean'), { stage: 'validate' });
  assert.equal(failureReason(rejected), 'proposal-rejected');
  assert.equal(failureReason(new Error('provider-timeout')), 'provider-timeout');
  assert.equal(failureReason(null), 'provider-failed');

  const broken = {
    id: 'api',
    timeoutMs: 20,
    run: async () => { throw rejected; }
  };
  const result = await runWithFallback(broken, fallback, 'breakdown', { title: '写报告' }, { assertCurrent() {} });
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.equal(result.provider, 'deterministic');
  assert.equal(result.proposal.steps.length, 3);
  assert.equal(result.reason, 'proposal-rejected');
  assert.deepEqual(result.cleanup, { ok: true, timer: 'released', listener: 'released' });
  assert.equal(Object.isFrozen(result.cleanup), true);
  assert.equal(timers.size, 0);
});

test('the deterministic client dispatches all four task names only to their matching builders', async () => {
  const calls = [];
  const client = createDeterministicClient({
    breakdown: payload => { calls.push('breakdown'); return deterministicBreakdownProposal(payload); },
    enrich: payload => { calls.push('enrich'); return deterministicEnrichProposal(payload); },
    unstick: payload => { calls.push('unstick'); return deterministicUnstickProposal(payload); },
    clarify: payload => { calls.push('clarify'); return deterministicClarifyProposal(payload); }
  });
  await client.run('breakdown', { title: '写周报' });
  await client.run('enrich', { title: '写周报', existingTags: [] });
  const unstick = await client.run('unstick', {
    title: '写周报', steps: [{ title: '打开周报文档', done: false }], energy: 'low'
  });
  const clarify = await client.run('clarify', {
    transcript: [{ role: 'user', content: '写周报' }], turnIndex: 0
  });
  assert.deepEqual(calls, ['breakdown', 'enrich', 'unstick', 'clarify']);
  assert.ok(unstick.nextAction);
  assert.ok(unstick.why);
  assert.equal(clarify.status, 'ready');
  assert.equal(clarify.proposal.title, '写周报');
});

test('missing credentials and invalid remote results keep deterministic paths for supported one-shot tasks', async () => {
  const { runWithFallback, timers } = providerHarness();
  const fallback = createDeterministicClient({
    breakdown: deterministicBreakdownProposal,
    enrich: deterministicEnrichProposal,
    unstick: deterministicUnstickProposal,
    clarify: deterministicClarifyProposal
  });
  const noCredential = createApiClient({ model: 'm', getCredential: () => null });
  const unstick = await runWithFallback(noCredential, fallback, 'unstick', {
    title: '写周报', steps: [], energy: 'medium'
  }, { assertCurrent() {} });
  assert.equal(unstick.ok, true);
  assert.equal(unstick.fallback, true);
  assert.equal(unstick.reason, 'provider-credential-missing');
  assert.ok(unstick.proposal.nextAction);

  for (const error of [
    new SyntaxError('Unexpected token'),
    Object.assign(new RangeError('invalid-output'), { stage: 'validate' }),
    new Error('provider-timeout'),
    new Error('provider-request-aborted')
  ]) {
    const broken = { id: 'api', timeoutMs: 20, run: async () => { throw error; } };
    const result = await runWithFallback(broken, fallback, 'breakdown', {
      title: '整理发票'
    }, { assertCurrent() {} });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, true);
    assert.ok(result.proposal.steps.length > 0);
    assert.deepEqual(result.cleanup, { ok: true, timer: 'released', listener: 'released' });
    assert.equal(Object.isFrozen(result.cleanup), true);
  }
  assert.equal(timers.size, 0);
});

test('clarify rejects a final-turn need-more answer and its deterministic builder returns ready', async () => {
  const fallback = createDeterministicClient({
    breakdown: deterministicBreakdownProposal,
    enrich: deterministicEnrichProposal,
    unstick: deterministicUnstickProposal,
    clarify: deterministicClarifyProposal
  });
  const payload = {
    transcript: [{ role: 'user', content: '准备演示' }],
    turnIndex: MAX_TURNS - 1
  };
  assert.throws(() => CLARIFY_TASK.validate({
    status: 'need-more', question: '还要补充什么？', missing: ['细节']
  }, payload), /clarify must return ready at the turn limit/);
  const result = await fallback.run('clarify', payload);
  assert.equal(result.status, 'ready');
  assert.equal(result.proposal.title, '准备演示');
});

// ---- 协议协商 ----
// 这一组钉住的是一次真实事故：把 Chat Completions 当成“所有 OpenAI 兼容服务的
// 公共分母”并删掉 Responses 之后，一个只实现 Responses 的网关对 chat/completions
// 直接回 404，用户那条本来能用的通道就整条没了，界面上只剩“AI 未生效”。
test('a provider that only implements Responses is found at runtime, not guessed from its hostname', async () => {
  const stub = stubTask([
    new ProviderHttpError(404, 'Cannot POST /openai/plus/chat/completions'),
    '{"ok":true}'
  ]);
  assert.deepEqual(await run(stub), { ok: true });
  assert.equal(stub.sent.length, 2);

  // 第一发按偏好走 chat/completions，404 说的是“这个路由没有”，于是换 responses。
  assert.equal(stub.endpoints[0], 'https://api.example.test/v1/chat/completions');
  assert.equal(stub.endpoints[1], 'https://api.example.test/v1/responses');

  // 两种形状的字段名不同：Responses 用 input + text.format，不是 messages +
  // response_format。发错字段名会被对面当成缺参数，而不是当成协议不对。
  assert.ok(Array.isArray(stub.sent[1].input), 'Responses 的输入叫 input');
  assert.equal(stub.sent[1].messages, undefined);
  assert.equal(stub.sent[1].text.format.type, 'json_schema');
  assert.equal(stub.sent[1].text.format.strict, true);
  assert.equal(stub.sent[1].response_format, undefined);
});

test('405 also means the route is absent, while 4xx about credentials or limits never switches protocol', async () => {
  const methodNotAllowed = stubTask([new ProviderHttpError(405, 'Method Not Allowed'), '{"ok":true}']);
  assert.deepEqual(await run(methodNotAllowed), { ok: true });
  assert.equal(methodNotAllowed.endpoints[1], 'https://api.example.test/v1/responses');

  // 401/403/429/5xx 换一个路由一次也不会变好，只会多烧一次额度。
  for (const failure of [
    new ProviderHttpError(401, 'Incorrect API key provided'),
    new ProviderHttpError(403, 'Forbidden'),
    new ProviderHttpError(429, 'Rate limit reached'),
    new ProviderHttpError(503, 'upstream unavailable')
  ]) {
    const stub = stubTask([failure, '{"ok":true}']);
    await assert.rejects(run(stub), new RegExp(String(failure.statusCode)));
    assert.equal(stub.sent.length, 1, `${failure.statusCode} 不该换协议重发`);
  }
});

// 一个 404 既可能是“路由不存在”，也可能是网关拿 404 报“不支持 response_format”。
// 后者点名了参数，所以它先被认出来：在一个存在的路由上降档，而不是跳去另一个协议。
test('a 404 that names response_format downgrades the schema mode instead of switching protocol', async () => {
  const stub = stubTask([
    new ProviderHttpError(404, 'unsupported parameter: response_format'),
    '{"ok":true}'
  ]);
  assert.deepEqual(await run(stub), { ok: true });
  assert.equal(stub.endpoints[0], stub.endpoints[1], '仍然是同一个路由');
  assert.equal(stub.sent[0].response_format.type, 'json_schema');
  assert.equal(stub.sent[1].response_format.type, 'json_object');
});

// 上一种协议根本不存在，所以我们对它的 schema 能力一无所知：换协议后必须从最严
// 那一档重新开始，否则一次无关的降档会永久削弱一个完全支持 json_schema 的服务。
test('switching protocol resets the schema ladder to its strongest rung', async () => {
  const stub = stubTask([
    new ProviderHttpError(400, 'Unsupported parameter: response_format'),
    new ProviderHttpError(404, 'Cannot POST /v1/chat/completions'),
    '{"ok":true}'
  ]);
  assert.deepEqual(await run(stub), { ok: true });
  assert.equal(stub.sent.length, 3);
  assert.equal(stub.sent[0].response_format.type, 'json_schema');
  assert.equal(stub.sent[1].response_format.type, 'json_object', '先降档');
  assert.equal(stub.sent[2].text.format.type, 'json_schema', '换协议后回到最严一档');
});

// 每次请求都先撑一个 404 是一轮白跑的往返，加一条看起来像故障的日志。
test('the negotiated protocol is remembered, and only after an answer actually validated', async () => {
  const negotiation = new Map();
  const first = stubTask([
    new ProviderHttpError(404, 'Cannot POST /v1/chat/completions'),
    '{"ok":true}'
  ]);
  await run(first, { negotiation });
  assert.equal(negotiation.get('https://api.example.test/v1'), 'responses');

  // 第二次直奔谈成的那一档，不再重复那次 404。
  const second = stubTask(['{"ok":true}']);
  await run(second, { negotiation });
  assert.equal(second.sent.length, 1);
  assert.equal(second.endpoints[0], 'https://api.example.test/v1/responses');
  assert.ok(second.sent[0].input, '记住的是协议，所以请求体也是 Responses 形状');

  // 一个 200 就记下来会把“只会回空壳的路由”当成谈成了，所以只在校验通过后记。
  const rejected = new Map();
  const failing = stubTask(['{"a":1}', '{"a":2}'], {
    validate: () => { throw new RangeError('never valid'); }
  });
  await assert.rejects(run(failing, { negotiation: rejected }), /never valid/);
  assert.equal(rejected.size, 0, '没拿到能用的答案就不该记住任何协议');
});

test('a remembered protocol that is no longer recognized falls back to the preferred rung', async () => {
  const negotiation = new Map([['https://api.example.test/v1', 'grpc-something']]);
  const stub = stubTask(['{"ok":true}']);
  assert.deepEqual(await run(stub, { negotiation }), { ok: true });
  assert.equal(stub.endpoints[0], 'https://api.example.test/v1/chat/completions');
});

// 截止线由 runWithFallback 统一持有：取消必须同时压住换协议这条路，否则一次
// 404 就能在用户已经关掉面板之后又发一次请求。
test('an aborted request does not switch protocol either', async () => {
  const controller = new AbortController();
  controller.abort();
  const stub = stubTask([
    new ProviderHttpError(404, 'Cannot POST /v1/chat/completions'),
    '{"ok":true}'
  ]);
  await assert.rejects(run(stub, { signal: controller.signal }), /provider-request-aborted/);
  assert.equal(stub.sent.length, 0);
});

// 换协议是对面的能力问题，不是模型答错了。它不该占用那唯一一次修正机会。
test('switching protocol does not spend the repair budget', async () => {
  let calls = 0;
  const stub = stubTask([
    new ProviderHttpError(404, 'Cannot POST /v1/chat/completions'),
    '{"attempt":1}',
    '{"attempt":2}'
  ], {
    validate: value => {
      calls += 1;
      if (calls === 1) throw new RangeError('steps[1].dependsOn must reference an earlier step');
      return value;
    }
  });
  assert.deepEqual(await run(stub), { attempt: 2 });
  assert.equal(stub.sent.length, 3, '一次换协议 + 一次回灌重试');
  assert.ok(stub.sent[2].input, '重试仍在谈成的那一档上');
  const retry = stub.sent[2].input;
  assert.equal(retry[2].role, 'assistant');
  assert.equal(retry[3].role, 'user');
  assert.ok(retry[3].content.includes('dependsOn must reference an earlier step'));
});

// 只记协议不记档位时，一个不支持 json_schema 的网关每次请求都先吃一个 400。
test('the negotiated schema mode is remembered per protocol, so a weak gateway costs one 400 once', async () => {
  const negotiation = new Map();
  const first = stubTask([new ProviderHttpError(400, 'Unsupported parameter: response_format'), '{"ok":true}']);
  await run(first, { negotiation });
  assert.equal(negotiation.get(schemaModeKey('https://api.example.test/v1', 'chat-completions')), 'json_object');

  const second = stubTask(['{"ok":true}']);
  await run(second, { negotiation });
  assert.equal(second.sent.length, 1, '第二次直接用谈成的档位');
  assert.equal(second.sent[0].response_format.type, 'json_object');

  // 另一种协议没有谈过，仍从最严一档开始。
  const other = new Map([[schemaModeKey('https://api.example.test/v1', 'chat-completions'), 'json_object'],
    ['https://api.example.test/v1', 'responses']]);
  const third = stubTask(['{"ok":true}']);
  await run(third, { negotiation: other });
  assert.equal(third.sent[0].text.format.type, 'json_schema');

  // 一个认不出的档位值不会被照搬。
  const junk = new Map([[schemaModeKey('https://api.example.test/v1', 'chat-completions'), 'yaml']]);
  const fourth = stubTask(['{"ok":true}']);
  await run(fourth, { negotiation: junk });
  assert.equal(fourth.sent[0].response_format.type, 'json_schema');
});
