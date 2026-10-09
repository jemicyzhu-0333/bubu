'use strict';

// L0：地址词表。请求路径的名字、由 base URL 拼出完整端点的规则，以及 URL 的长度上限。
//
// 这些东西先前分在两处：路径名和拼接住在 openai.js，还原（把用户粘来的完整 endpoint
// 剥回 base URL）和长度上限住在 capabilities/preferences 的设置契约里，于是 core 要朝外
// 去取一个配置模块。更实际的代价是两边各留了一份请求路径清单——协议层一张路由表，设置
// 那边一条手写正则。加一种协议只会改到其中一份：另一份从此认不出用户粘来的新形状，于是
// 把它整段当成 base URL 再叠一层路径，拼出一个不可能存在的地址，而请求失败时界面上没有
// 一句话解释为什么。
//
// 出网层（transport）与协议层（openai）都要用到这里的东西，而协议层本来就依赖出网层的
// 错误类型，所以这份词表必须是一个谁都能进来取、自己不依赖任何人的叶子模块。

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// 书写顺序即探测顺序。Chat Completions 在前面：它是实现得最广的一个，且 OpenAI 自己、
// 各家网关、本地推理服务都认它。
const PROTOCOL_PATHS = Object.freeze({
  'chat-completions': 'chat/completions',
  responses: 'responses'
});

// 阶梯不再另抄一份协议名：两份清单里只改一份，探测顺序与能拼出的路径就会不一致，而
// 不一致的那一档在运行时表现为“对面说没有这个路由”，看起来像对面的问题。
const PROTOCOLS = Object.freeze(Object.keys(PROTOCOL_PATHS));

// 我们自己从不发 `/completions`（那是补全时代的形状），但用户会从别家文档里粘到它。
// 还原认得越宽，能救回来的粘贴越多；发送仍然只走上面那两种。
const RECOGNIZED_REQUEST_PATHS = Object.freeze([...Object.values(PROTOCOL_PATHS), 'completions']
  // 长的排前面：`/v1/chat/completions` 若先被 `completions` 削掉，剩下的 `/v1/chat` 不再
  // 匹配任何形状，循环就此停住，base URL 里凭空多出一段 `chat`。
  .sort((left, right) => right.length - left.length));

// 存得下的 URL 上限，与出网时那一条的上限。后者只比前者多出我们自己会附加的那段路径：
// 先前它写成“前者 + 32”，而 32 与真正会附加的路径没有关系——换一种更长的协议路径时它不
// 会跟着变，于是一个刚好合法的设置会在出网前被判成非法。
const MAX_AI_CANONICAL_URL_LENGTH = 2048;
const MAX_AI_REQUEST_URL_LENGTH = MAX_AI_CANONICAL_URL_LENGTH + 1
  + Math.max(...Object.values(PROTOCOL_PATHS).map(requestPath => requestPath.length));

function stripRequestPath(pathname) {
  for (const requestPath of RECOGNIZED_REQUEST_PATHS) {
    if (pathname.endsWith(`/${requestPath}`)) return pathname.slice(0, -(requestPath.length + 1));
  }
  return pathname;
}

// base URL 是每条请求路径挂靠的那一截，所以跟着粘进来的请求路径要剥回去。会写这个字段
// 的有两种来源：base URL 出现之前的旧设置（存的是 `…/v1/responses`），以及用户从服务商
// 文档里粘来的任意 endpoint。把 `/responses` 接到 `…/v1/chat/completions` 后面会造出一个
// 不可能存在的地址，而失败时界面上没有一句话解释为什么。
function baseUrlFromEndpoint(endpoint) {
  const parsed = new URL(endpoint.trim());
  let pathname = parsed.pathname;
  let previous;
  // 用与 isHttpsEndpoint 相同的 WHATWG 解析器。特殊 scheme 接受 `https:/host/path` 这类
  // 写法，也接受反斜杠；在原始字串上按 `://` 切会对“哪几个字节是 authority”给出不同判
  // 断，可能把最终请求指到别处。跑到不动点也让误粘的 `.../responses/responses` 在第一次
  // 归一化之后就稳定下来。
  do {
    previous = pathname;
    pathname = stripRequestPath(pathname.replace(/\/+$/, ''));
  } while (pathname !== previous);
  return `${parsed.origin}${pathname}${parsed.search}`;
}

// 设置里存的是 base URL 而不是完整 endpoint：每家服务的文档都写 base URL，那才是用户能
// 复制的东西；往后拼哪个路径是我们的实现细节，不是他们的。
function protocolEndpoint(baseUrl, protocol = PROTOCOLS[0]) {
  const requestPath = PROTOCOL_PATHS[protocol];
  if (!requestPath) throw new TypeError(`unknown protocol: ${protocol}`);
  const given = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : DEFAULT_BASE_URL;
  const base = baseUrlFromEndpoint(given);
  const suffixIndex = base.search(/[?#]/);
  const address = suffixIndex === -1 ? base : base.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : base.slice(suffixIndex);
  return `${address}/${requestPath}${suffix}`;
}

function chatCompletionsEndpoint(baseUrl) {
  return protocolEndpoint(baseUrl, 'chat-completions');
}

module.exports = {
  DEFAULT_BASE_URL,
  PROTOCOLS,
  MAX_AI_CANONICAL_URL_LENGTH,
  MAX_AI_REQUEST_URL_LENGTH,
  baseUrlFromEndpoint,
  protocolEndpoint,
  chatCompletionsEndpoint
};
