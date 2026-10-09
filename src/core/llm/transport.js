'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { MAX_AI_REQUEST_URL_LENGTH } = require('./endpoint');
const { NO_LLM_SPAN } = require('./trace');

// L1：出网层。这一层不认识 LLM——它只知道“把一个 JSON POST 到一个公网 https
// 端点，并且不许被诱导去访问本机或内网”。协议、schema、重试都在上层。
//
// 这里的价值全部集中在“不许”那半句上：端点来自用户设置，也就是来自一个可以
// 被粘贴任意字串的输入框。没有这一层，一个 `https://169.254.169.254/...` 就能
// 让应用去读云元数据；一个解析到 127.0.0.1 的公网域名就能打到用户本机的其他
// 服务上。所以域名先解析、结果先过黑名单、然后把地址钉死再连接——三步缺一步，
// DNS rebinding 就能在校验通过之后把地址换掉。
//
// 只有一种网络策略：公网。早先还有一档 loopback（给“本机模型”用），但它同时
// 要求 https，而本机推理服务几乎都跑在明文 http 上，那条路因此从未真正可用，
// 只是让每个函数多带一个参数、多一条没人走过的分支。

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 180_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
// 报错体只留够定位的量。网关经常把整段提示词回显在错误里，全收下来等于把
// 一次失败变成几十 KB 日志。
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_ERROR_DETAIL_CHARS = 240;

// 云端模型把一整段提示词读完、再按严格 schema 吐出 JSON，正常就是十几到几十秒。
// 截止线不能取消：草稿面板在等这一个回答，没有上限就等于按钮永远转圈。所以
// 分成两个数——默认等多久（调用方可调）和谁都不得超过的硬上限。
function resolveTimeout(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(requested)));
}

const NON_PUBLIC_IPV4 = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]) NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4');

const NON_PUBLIC_IPV6 = new net.BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
]) NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6');

function bareIpAddress(address) {
  if (typeof address !== 'string') return '';
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

// `::ffff:127.0.0.1` 和 `::ffff:7f00:1` 是同一个地址的两种写法，而只查 IPv6
// 黑名单会把后者放过去。两种写法都先折回点分十进制再判。
function mappedIpv4Address(address) {
  const value = bareIpAddress(address).toLowerCase();
  const dotted = value.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];
  const hexadecimal = value.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function isPublicIpAddress(address) {
  const normalizedAddress = bareIpAddress(address);
  const mapped = mappedIpv4Address(normalizedAddress);
  if (mapped) return isPublicIpAddress(mapped);
  const family = net.isIP(normalizedAddress);
  if (!family) return false;
  return family === 4
    ? !NON_PUBLIC_IPV4.check(normalizedAddress, 'ipv4')
    : !NON_PUBLIC_IPV6.check(normalizedAddress, 'ipv6');
}

// 这些主机名不需要解析就知道不该去：`.local` / `.internal` 是内网命名，
// `metadata.google.internal` 是云元数据服务的固定名字。
function isForbiddenHostname(hostname) {
  return !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname === 'metadata.google.internal';
}

function parseEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_AI_REQUEST_URL_LENGTH || /\s/.test(raw)) {
    throw new TypeError('invalid-provider-endpoint');
  }
  const url = new URL(raw);
  // 用户名密码写在 URL 里就会进日志和进设置文件；凭据只走 OS 加密存储。
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('invalid-provider-endpoint');
  if (url.port && url.port !== '443') throw new TypeError('provider-endpoint-port-not-allowed');
  const hostname = url.hostname.toLowerCase();
  if (isForbiddenHostname(hostname)) throw new TypeError('provider-endpoint-host-not-allowed');
  const addressHost = bareIpAddress(hostname);
  if (net.isIP(addressHost) && !isPublicIpAddress(addressHost)) {
    throw new TypeError('provider-endpoint-address-not-allowed');
  }
  return url;
}

// 一个域名可以解析出多条记录，其中一条是私网就足够构成风险：留一条能走通的
// 路，攻击者只需要让那一条被选中。所以是 `some` 而不是 `every`。
async function resolvePublicAddress(hostname, lookup = dns.lookup) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(item => !isPublicIpAddress(item.address))) {
    throw new Error('provider-endpoint-resolves-private');
  }
  return addresses[0];
}

// 地址钉死在已经过审的那一个，任何第二次解析都换不进私网地址。两种回调形状
// 都要照顾：`autoSelectFamily` 打开时（Node 20 起的默认）连接路径会带 `all`
// 并遍历数组，此时递一个裸字串会让 Node 去遍历这个字串的字符，请求在建立
// socket 之前就以 `Invalid IP address: undefined` 失败。
function pinnedLookup(resolved) {
  return (_hostname, lookupOptions, callback) => (lookupOptions && lookupOptions.all
    ? callback(null, [{ address: resolved.address, family: resolved.family }])
    : callback(null, resolved.address, resolved.family));
}

function errorDetail(text) {
  let detail = '';
  try {
    const parsed = JSON.parse(text);
    const error = parsed && parsed.error;
    detail = error && typeof error.message === 'string'
      ? error.message
      : (typeof parsed.message === 'string' ? parsed.message : '');
  } catch (_) {
    detail = text.trim();
  }
  return detail.replace(/\s+/g, ' ').slice(0, MAX_ERROR_DETAIL_CHARS);
}

// 非 2xx 带着状态码和对面那句话一起抛出来：上层要靠这两样东西区分
// “换个 response_format 再试”和“这条路彻底不通”。
class ProviderHttpError extends Error {
  constructor(statusCode, detail) {
    super(`provider-http-${statusCode}${detail ? `|${detail}` : ''}`);
    this.name = 'ProviderHttpError';
    this.statusCode = statusCode;
    this.detail = detail || '';
  }
}

async function postJson(endpoint, body, options = {}) {
  if (options.signal?.aborted) throw new Error('provider-request-aborted');
  const span = options.span || NO_LLM_SPAN;
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey : '';
  span.request({ endpoint, timeoutMs, authorization: apiKey ? 'Bearer ***' : undefined, body });
  const url = parseEndpoint(endpoint);
  const hostname = bareIpAddress(url.hostname);
  const serialized = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let settled = false, request = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      request?.setTimeout(0);
      callback(value);
    };
    const stop = error => {
      finish(reject, error);
      request?.destroy(error);
    };
    const onAbort = () => stop(new Error('provider-request-aborted'));
    // This deadline also covers DNS; a lookup may finish later but cannot send.
    const timer = setTimeout(() => stop(new Error('provider-timeout')), timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    resolvePublicAddress(hostname, options.lookup || dns.lookup).then(resolved => {
      if (settled) return;
      if (options.signal?.aborted) { onAbort(); return; }
      span.resolved(resolved.address, resolved.family);
      if (settled || options.signal?.aborted) { onAbort(); return; }
      const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(serialized) };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      request = https.request(url, {
        method: 'POST', servername: net.isIP(hostname) ? undefined : hostname,
        lookup: pinnedLookup(resolved), headers
      }, response => {
        if (settled) { response.destroy(); return; }
        span.status(response.statusCode, response.headers && response.headers['content-type']);
        const failed = response.statusCode < 200 || response.statusCode >= 300;
        const limit = failed ? MAX_ERROR_BYTES : MAX_RESPONSE_BYTES;
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size <= limit) chunks.push(chunk);
          else if (!failed) stop(new RangeError('provider-response-too-large'));
        });
        response.on('error', error => finish(reject, error));
        response.on('end', () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString('utf8');
          span.body(text);
          if (failed) return finish(reject, new ProviderHttpError(response.statusCode, errorDetail(text)));
          try { finish(resolve, JSON.parse(text)); }
          catch (_) { finish(reject, new TypeError('provider-response-invalid-json')); }
        });
      });
      request.once('error', error => finish(reject, error));
      if (settled || options.signal?.aborted) { onAbort(); return; }
      request.setTimeout(timeoutMs, () => stop(new Error('provider-timeout')));
      if (settled || options.signal?.aborted) { onAbort(); return; }
      request.end(serialized);
    }).catch(error => finish(reject, error));
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  ProviderHttpError,
  resolveTimeout,
  isPublicIpAddress,
  isForbiddenHostname,
  parseEndpoint,
  resolvePublicAddress,
  pinnedLookup,
  postJson
};
