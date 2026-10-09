'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_BASE_URL,
  PROTOCOLS,
  MAX_AI_CANONICAL_URL_LENGTH,
  MAX_AI_REQUEST_URL_LENGTH,
  chatCompletionsEndpoint,
  protocolEndpoint
} = require('../src/core/llm/endpoint');

// 设置里存的是 base URL，请求路径在一处附加。早先两种协议各拼一次，于是把
// `/responses` 接到 `…/v1/chat/completions` 后面能造出一个不存在的地址，而失败时
// 界面上没有一句话解释为什么。
test('settings hold a base URL and the request path is appended in exactly one place', () => {
  assert.equal(chatCompletionsEndpoint('https://api.example.test/v1'), 'https://api.example.test/v1/chat/completions');
  assert.equal(chatCompletionsEndpoint('https://api.example.test/v1/'), 'https://api.example.test/v1/chat/completions');
  // 用户从文档里粘来的完整 endpoint 也要能用：把请求路径剥掉再拼，而不是叠上去。
  for (const pasted of [
    'https://api.example.test/v1/chat/completions',
    'https://api.example.test/v1/responses',
    'https://api.example.test/v1/completions'
  ]) {
    assert.equal(chatCompletionsEndpoint(pasted), 'https://api.example.test/v1/chat/completions', pasted);
  }
  assert.equal(chatCompletionsEndpoint(''), `${DEFAULT_BASE_URL}/chat/completions`);
  assert.equal(chatCompletionsEndpoint(null), `${DEFAULT_BASE_URL}/chat/completions`);
});

// 两种线上形状都是 OpenAI 自己的协议。留两种不是为了迁就某一家网关，而是因为
// 真实存在只实现其中一种的服务：把 Chat Completions 当成公共分母、删掉 Responses
// 之后，一个只认 Responses 的网关对 chat/completions 直接 404，用户那条本来能用
// 的通道就整条没了。
test('both wire shapes hang off the same base URL, and the path is appended in one place', () => {
  assert.deepEqual([...PROTOCOLS], ['chat-completions', 'responses']);
  assert.equal(
    protocolEndpoint('https://api.example.test/v1', 'chat-completions'),
    'https://api.example.test/v1/chat/completions'
  );
  assert.equal(
    protocolEndpoint('https://api.example.test/v1', 'responses'),
    'https://api.example.test/v1/responses'
  );
  // 不带协议时用偏好那一档，而不是静默拼一个空路径。
  assert.equal(protocolEndpoint('https://api.example.test/v1'), 'https://api.example.test/v1/chat/completions');
  // 粘贴来的完整地址在两种协议下都要先被剥干净，否则会造出 `…/responses/responses`。
  assert.equal(
    protocolEndpoint('https://api.example.test/v1/responses', 'chat-completions'),
    'https://api.example.test/v1/chat/completions'
  );
  assert.equal(
    protocolEndpoint('https://api.example.test/v1/chat/completions', 'responses'),
    'https://api.example.test/v1/responses'
  );
  assert.equal(
    protocolEndpoint('https://responses', 'responses'),
    'https://responses/responses',
    'a protocol-looking hostname is not a removable path'
  );
  assert.equal(
    protocolEndpoint('https://completions/responses', 'chat-completions'),
    'https://completions/chat/completions',
    'only the pathname suffix is replaced'
  );
  assert.equal(
    protocolEndpoint('https://api.example.test/v1/responses?api-version=2026-01-01', 'chat-completions'),
    'https://api.example.test/v1/chat/completions?api-version=2026-01-01',
    'a base query remains after the appended request path'
  );
  assert.equal(
    protocolEndpoint('https:////responses/responses', 'chat-completions'),
    'https://responses/chat/completions',
    'URL parsing and request construction must agree on the authority'
  );
  assert.equal(
    protocolEndpoint('https://api.example.test/responses/responses', 'responses'),
    'https://api.example.test/responses',
    'repeated request suffixes normalize to a stable base before appending'
  );
  assert.throws(() => protocolEndpoint('https://api.example.test/v1', 'grpc'), /unknown protocol/);
});

// 加一种协议要动两处判断：能拼出哪些路径，以及还原时认得哪些形状。这两份清单先前
// 分家——一份是协议层的路由表，一份是设置契约里的手写正则——只改一份不会报错：用户
// 粘来新形状的完整 endpoint 时它整段被当作 base URL，路径再叠一层，拼出的地址不可能
// 存在。所以这里按协议取全组合：任一协议的完整地址，在任一协议下都要还原到同一个 base。
test('every protocol path is also a shape the parser strips back off', () => {
  const base = 'https://api.example.test/v1';
  for (const pasted of PROTOCOLS) {
    for (const wanted of PROTOCOLS) {
      assert.equal(
        protocolEndpoint(protocolEndpoint(base, pasted), wanted),
        protocolEndpoint(base, wanted),
        `${pasted} -> ${wanted}`
      );
    }
  }
});

// 出网那条上限只比存得下的上限多出我们自己要附加的那段路径。先前它写成“存得下的
// 上限 + 32”：32 与真正会附加的路径没有关系，于是换一种更长的协议路径时它不会跟着
// 变，一个刚好顶到上限的合法设置会在出网前被判成非法，而设置面板已经收下了它。
test('the out-of-network URL bound leaves room for the path we append', () => {
  const origin = 'https://api.example.test/';
  const base = `${origin}${'a'.repeat(MAX_AI_CANONICAL_URL_LENGTH - origin.length)}`;
  assert.equal(base.length, MAX_AI_CANONICAL_URL_LENGTH, '基准地址正好顶到存得下的上限');
  for (const protocol of PROTOCOLS) {
    assert.ok(
      protocolEndpoint(base, protocol).length <= MAX_AI_REQUEST_URL_LENGTH,
      `${protocol}：一个刚好合法的设置不能在出网前被判成非法`
    );
  }
});
