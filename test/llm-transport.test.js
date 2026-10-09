'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPublicIpAddress,
  isForbiddenHostname,
  parseEndpoint,
  resolvePublicAddress,
  pinnedLookup,
  resolveTimeout,
  ProviderHttpError,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS
} = require('../src/core/llm/transport');
const { protocolEndpoint, MAX_AI_REQUEST_URL_LENGTH } = require('../src/core/llm/endpoint');

// L1 只有一份职责，也只有一类测试：端点来自一个能粘贴任意字串的输入框，
// 所以“不许去哪儿”这件事必须在打开 socket 之前就成立。

test('SSRF boundary rejects local and private targets before a request is opened', async () => {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2',
    '192.0.2.1', '198.51.100.2', '203.0.113.3', '::1', 'fd00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1'
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);

  assert.throws(() => parseEndpoint('http://api.openai.com/v1/chat/completions'), /invalid/);
  assert.throws(() => parseEndpoint('https://localhost/v1/chat/completions'), /not-allowed/);
  assert.throws(() => parseEndpoint('https://127.0.0.1/v1/chat/completions'), /not-allowed/);
  assert.throws(() => parseEndpoint('https://[::1]/v1/chat/completions'), /not-allowed/);
  assert.throws(() => parseEndpoint('https://api.example.test:11434/v1'), /port-not-allowed/);
  // 凭据写进 URL 就会进日志和进设置文件；密钥只走 OS 加密存储。
  assert.throws(() => parseEndpoint('https://user:pass@api.example.test/v1'), /invalid/);
  assert.doesNotThrow(() => parseEndpoint('https://api.example.test/v1/chat/completions'));
  const expandedEndpoint = protocolEndpoint(
    `https://api.example.test/${'界'.repeat(50)}/responses`,
    'chat-completions'
  );
  assert.ok(expandedEndpoint.length > 200, 'the fixture must expand under WHATWG serialization');
  assert.doesNotThrow(
    () => parseEndpoint(expandedEndpoint),
    'a valid 200-character setting may have a longer canonical request URL'
  );
  assert.throws(
    () => parseEndpoint(`https://api.example.test/${'a'.repeat(MAX_AI_REQUEST_URL_LENGTH)}`),
    /invalid/,
    'canonical request URLs remain bounded'
  );

  // 只剩一种网络策略，所以 loopback 不再有豁免口。旧实现的第二档
  // （networkPolicy: 'loopback'）连同它那条从未真正可用的“本机模型”一起删掉了。
  assert.equal(parseEndpoint.length, 1, 'parseEndpoint 不该再有第二个策略参数');

  for (const hostname of ['localhost', 'x.localhost', 'db.local', 'svc.internal', 'metadata.google.internal']) {
    assert.equal(isForbiddenHostname(hostname), true, hostname);
  }
  assert.equal(isForbiddenHostname('api.openai.com'), false);
});

test('a DNS answer is vetted before it is used, and one private record poisons the set', async () => {
  await assert.rejects(
    resolvePublicAddress('example.test', async () => [{ address: '169.254.169.254', family: 4 }]),
    /resolves-private/
  );
  await assert.rejects(
    resolvePublicAddress('example.test', async () => [{ address: '::ffff:7f00:1', family: 6 }]),
    /resolves-private/
  );
  // 留一条能走通的路，攻击者只需要让那一条被选中，所以是 some 而不是 every。
  await assert.rejects(
    resolvePublicAddress('example.test', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]),
    /resolves-private/
  );
  assert.deepEqual(
    await resolvePublicAddress('example.test', async () => [{ address: '93.184.216.34', family: 4 }]),
    { address: '93.184.216.34', family: 4 }
  );
});

// 钉住一个真实发生过的故障：钉死地址的 lookup 只回了裸字符串，而 Node 20 起
// autoSelectFamily 默认开启，连接路径会带 all:true 来问并把返回值当数组遍历。
// 遇到字符串时它去取第一个字符的 .address，得到 undefined，于是连 socket 都没开
// 就抛 Invalid IP address: undefined —— 整个 AI 链路静默回退，看不出真因。
test('the pinned lookup answers in the shape the connect path actually reads', () => {
  const resolved = { address: '93.184.216.34', family: 4 };
  const lookup = pinnedLookup(resolved);

  let seen;
  lookup('example.test', { all: true, family: 0, hints: 0 }, (error, value) => { seen = { error, value }; });
  assert.equal(seen.error, null);
  assert.ok(Array.isArray(seen.value), '要求 all 时必须回数组，否则 Node 会去遍历字符串');
  const [first] = seen.value;
  assert.equal(first.address, resolved.address);
  assert.equal(first.family, resolved.family);

  // 旧的单地址形式（autoSelectFamily 关掉时）仍然要能用。
  let legacy;
  lookup('example.test', { family: 4 }, (error, address, family) => { legacy = { error, address, family }; });
  assert.deepEqual(legacy, { error: null, address: '93.184.216.34', family: 4 });
});

// 云端模型读完一整段提示词再按严格 schema 吐 JSON，正常就是十几到几十秒。早先
// 这里写的 8 秒意味着远程 provider 几乎每次都输给本地模板——那不是失败关闭，
// 那是把功能关掉了。但截止线本身不能取消：面板在等这一个回答。
test('the request deadline fits a real model and no caller can raise it past the ceiling', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 180_000);
  assert.equal(resolveTimeout(undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeout(0), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeout('nonsense'), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeout(30_000), 30_000);
  assert.equal(resolveTimeout(10), 1_000, '下限存在，否则一个 1ms 的值等于永久关闭功能');
  assert.equal(resolveTimeout(MAX_TIMEOUT_MS * 10), MAX_TIMEOUT_MS);
});

// 非 2xx 要带着状态码和对面那句话一起往上走：上层要靠这两样区分
// “换个 response_format 再试”和“这条路彻底不通”。
test('an HTTP failure keeps the status and the provider message it needs to be classified by', () => {
  const error = new ProviderHttpError(400, 'Unsupported parameter: response_format');
  assert.equal(error.statusCode, 400);
  assert.equal(error.detail, 'Unsupported parameter: response_format');
  assert.equal(error.message, 'provider-http-400|Unsupported parameter: response_format');
  assert.ok(error instanceof Error);
  assert.equal(new ProviderHttpError(500, '').message, 'provider-http-500');
});
