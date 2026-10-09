'use strict';

const { PROTOCOLS } = require('./endpoint');
const { ProviderHttpError } = require('./transport');

// L2：协议层。OpenAI 自己的两种线上形状：Chat Completions 与 Responses。
//
// 早先这里按主机名分流：`idealab.alibaba-inc.com` 走 chat/completions，其余一律走
// Responses。那是真正要拿掉的东西：换一个网关就要改一次源码，而用户看到的只是
// “配好了但不生效”。但“只留一种协议”同样错：测过的真实网关里有只实现
// Responses、对 `chat/completions` 直接 404 的（路由不存在，不是参数不支持），
// 把它当成公共分母等于把一条本来能用的通道删掉。
//
// 所以协议既不猜主机名、也不让用户选，而是运行时探出来的：先发覆盖面最广的
// Chat Completions，只有对面说“这个路由没有”（404/405）才换 Responses 再试。两个
// 维度因此是正交的：“走哪个路由”看 404/405，“认不认 json_schema”看对面是否
// 点名拒绝那个参数。两条阶梯都是公共能力，里面没有任何一家服务的名字。

// schema 下发能力从强到弱。降级只在对面明确拒绝上一档时发生，而且每一档都
// 真的把 schema 交给了模型——这是与旧实现最大的区别：旧的 json_object 分支
// 把算好的 schema 直接丢掉，模型从头到尾没见过字段约束。
const SCHEMA_MODES = Object.freeze(['json_schema', 'json_object']);

// 这里故意没有默认模型。计费用哪个模型是用户设置，它的默认值只在
// `DEFAULT_SETTINGS` 里存在一次；本文件再写一个默认，就等于让设置面板和真正
// 发出去的请求对“现在跑的是什么”各说一套。
function requiredModel(model) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('provider model is required');
  return model.trim();
}

// json_object 档位下，字段约束进不了协议层，就必须进提示词——否则模型只能靠
// 猜字段名和取值范围，而猜错的代价是整份作废。
function schemaAsPrompt(schema) {
  return [
    'Return a single JSON object that validates against this JSON Schema.',
    'Every constraint in it is binding: no extra properties, no missing required properties,',
    'and every description explains what the field actually means. Read them before answering.',
    JSON.stringify(schema)
  ].join('\n');
}

// 严格模式只认 JSON Schema 的一个子集。Azure OpenAI 的结构化输出文档把
// minLength / maxLength 列为不支持，`const` 也不在所有网关的支持列表里；发出去
// 的结果是 400 → 降到 json_object，模型从此看不到字段约束。所以严格档位发送前
// 去掉字符串长度限制、把 const 改写成单值 enum。这些限制并没有丢：本地校验器
// （tasks 的 validate）照样逐条强制，超长的输出会被回灌修正或截断。
const STRICT_UNSUPPORTED = Object.freeze(['minLength', 'maxLength']);

function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRICT_UNSUPPORTED.includes(key)) continue;
    if (key === 'const') { out.enum = [value]; continue; }
    // 属性名本身可以叫 minLength（properties 下），只在 schema 关键字位置删除。
    out[key] = key === 'properties' && value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, strictSchema(sub)]))
      : strictSchema(value);
  }
  return out;
}

function responseFormat(mode, schemaName, schema) {
  if (mode === 'json_schema') {
    return { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: strictSchema(schema) } };
  }
  return { type: 'json_object' };
}

// 一次生成的完整请求体。`messages` 由调用方给全（含重试时回灌的那两轮），
// 这一层不自己往里塞东西，所以日志里看到的就是模型看到的。
function buildChatRequest({ model, messages, schema, schemaName, mode }) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('messages are required');
  if (!SCHEMA_MODES.includes(mode)) throw new TypeError(`unknown schema mode: ${mode}`);
  const outbound = mode === 'json_object'
    ? [{ role: 'system', content: schemaAsPrompt(schema) }, ...messages]
    : messages;
  return {
    model: requiredModel(model),
    stream: false,
    messages: outbound,
    response_format: responseFormat(mode, schemaName, schema)
  };
}

function extractMessageText(response) {
  const choices = response && Array.isArray(response.choices) ? response.choices : [];
  const message = choices[0] && choices[0].message;
  if (message && typeof message.content === 'string') return message.content;
  // 有些网关把内容拆成分片数组返回。取第一个带 text 的分片，而不是拼接全部：
  // 后面的分片通常是思维链或引用，混进 JSON 里会直接解析失败。
  if (message && Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item && typeof item.text === 'string') return item.text;
    }
  }
  throw new TypeError('provider-response-missing-output');
}

// Responses 把结构化输出放在 `text.format` 而不是 `response_format`，输入叫 `input`
// 而不是 `messages`。字段名不同，但两档 schema 下发能力与 Chat Completions 一一
// 对应，所以上面那条降级阶梯在这里同样成立。
function responsesTextFormat(mode, schemaName, schema) {
  if (mode === 'json_schema') {
    return { format: { type: 'json_schema', name: schemaName, strict: true, schema: strictSchema(schema) } };
  }
  return { format: { type: 'json_object' } };
}

function buildResponsesRequest({ model, messages, schema, schemaName, mode }) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError('messages are required');
  if (!SCHEMA_MODES.includes(mode)) throw new TypeError(`unknown schema mode: ${mode}`);
  const outbound = mode === 'json_object'
    ? [{ role: 'system', content: schemaAsPrompt(schema) }, ...messages]
    : messages;
  return {
    model: requiredModel(model),
    stream: false,
    input: outbound,
    text: responsesTextFormat(mode, schemaName, schema)
  };
}

function extractResponsesText(response) {
  if (response && typeof response.output_text === 'string') return response.output_text;
  const output = response && Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    for (const content of Array.isArray(item && item.content) ? item.content : []) {
      if (content && content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new TypeError('provider-response-missing-output');
}

// 两种形状各自只知道自己的字段名；选哪一种是上一层的事，不在这里判。
function buildRequest({ protocol = PROTOCOLS[0], ...rest }) {
  if (!PROTOCOLS.includes(protocol)) throw new TypeError(`unknown protocol: ${protocol}`);
  return protocol === 'responses' ? buildResponsesRequest(rest) : buildChatRequest(rest);
}

function extractText(protocol, response) {
  if (!PROTOCOLS.includes(protocol)) throw new TypeError(`unknown protocol: ${protocol}`);
  return protocol === 'responses' ? extractResponsesText(response) : extractMessageText(response);
}

// 降级只在“对面看不懂这个参数”时才是对的。401/403 是凭据问题，429 是限流，
// 5xx 是对面自己的故障——这些换 response_format 一次也不会变好，只会多烧一次
// 额度和一段用户在转圈里等的时间。
const SCHEMA_REJECTION_PATTERN = /response_format|json_?schema|structured\s*output|unsupported\s+parameter|unrecognized\s+request\s+argument/i;

function isSchemaModeRejection(error) {
  if (!(error instanceof ProviderHttpError)) return false;
  if (error.statusCode !== 400 && error.statusCode !== 404 && error.statusCode !== 422) return false;
  return SCHEMA_REJECTION_PATTERN.test(error.detail);
}

function nextSchemaMode(mode) {
  const index = SCHEMA_MODES.indexOf(mode);
  return index >= 0 && index < SCHEMA_MODES.length - 1 ? SCHEMA_MODES[index + 1] : null;
}

// “这个路由没有”与“这个参数不支持”是两件事。404/405 说的是前者：这家服务
// 没实现这种线上形状，那就换另一种再试，而不是降 schema 档位——后者在一个
// 不存在的路由上重试多少次都是 404。判定顺序因此是“先看有没有点名参数，
// 再看是不是路由缺失”：前者更具体，它要求错误文本里真的提到了那个字段。
function isProtocolMissing(error) {
  if (!(error instanceof ProviderHttpError)) return false;
  return error.statusCode === 404 || error.statusCode === 405;
}

function nextProtocol(protocol) {
  const index = PROTOCOLS.indexOf(protocol);
  return index >= 0 && index < PROTOCOLS.length - 1 ? PROTOCOLS[index + 1] : null;
}

module.exports = {
  SCHEMA_MODES,
  STRICT_UNSUPPORTED,
  strictSchema,
  requiredModel,
  schemaAsPrompt,
  buildChatRequest,
  buildResponsesRequest,
  buildRequest,
  extractMessageText,
  extractResponsesText,
  extractText,
  isSchemaModeRejection,
  isProtocolMissing,
  nextSchemaMode,
  nextProtocol
};
