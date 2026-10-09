'use strict';

const { chatCompletionsEndpoint, protocolEndpoint, PROTOCOLS, DEFAULT_BASE_URL } = require('./endpoint');
const { requiredModel } = require('./openai');
const { generateStructured } = require('./generate');
const { COLLABORATION_TASK, validateCollaborationResult, validateTaskDraft } = require('./contracts');
const { TASKS, describeClarifyFields, CLARIFY_MEMORY_FIELDS } = require('./tasks');
const { resolveTimeout, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } = require('./transport');
const { createLlmTrace, NO_LLM_TRACE } = require('./trace');
const { probeConnection, connectionFailure } = require('./connection-probe');
const { proposalValidationDetail } = require('./proposal-validation-detail');

// LLM Provider 运行时的公开出口；纯静态契约另由 contracts.js 提供。
// 四层内部结构仍不向调用方开放。
//
// 只有一种远程 client：一个 OpenAI 兼容端点。早先按 `aiProvider` 分成 'api' 和
// 'local' 两条路，后者强制 loopback 却同样要求 https——而本机推理服务几乎都跑
// 明文 http，那条路从未真正可用，只是让每个函数多一个参数、多一条没人走过的
// 分支。现在“连哪儿”完全由 base URL 决定，不由一个模式开关决定。

function taskByName(name) {
  const task = TASKS[name];
  if (!task) throw new TypeError(`unknown llm task: ${name}`);
  return task;
}

// 会发送哪些字段是任务的属性，不是传输层的属性。它和 buildInput() 在同一个
// 对象里定义，所以“披露的字段”和“实际发送的字段”是同一份来源——旧实现把这句
// 承诺挂在 provider 上，两者能各自演化。
function describeFields(name) {
  return taskByName(name).fields;
}

function createApiClient(options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const model = requiredModel(options.model);
  const getCredential = options.getCredential;
  const trace = options.trace || NO_LLM_TRACE;
  const timeoutMs = resolveTimeout(options.timeoutMs);
  if (typeof getCredential !== 'function') throw new TypeError('getCredential is required');
  // 协议记忆由调用方传进来（main.js 持一份），不在这里做模块级全局：
  // 后者会让测试变成有顺序的，而这个 client 本身每次请求都会重建。
  const negotiation = options.negotiation;
  return Object.freeze({
    id: 'api',
    // 面板披露当前已协商协议的完整地址；尚未协商时使用默认协议。
    // ARCHITECTURE「AI 与 LLM」：trace 只记录白名单元数据，不记录端点或正文。
    endpoint: protocolEndpoint(baseUrl, negotiation && PROTOCOLS.includes(negotiation.get(baseUrl))
      ? negotiation.get(baseUrl)
      : PROTOCOLS[0]),
    timeoutMs,
    describeFields,
    async run(name, payload, { signal, beforeRequest, maxOutputChars, maxRepairAttempts, onUsage } = {}) {
      const task = taskByName(name);
      // 没有凭据就不出网。等对面回 401 也能知道，但那要先烧掉一次往返和用户
      // 的一段等待，而“还没保存 API 密钥”这件事在本机就是已知的。
      const apiKey = getCredential();
      if (!apiKey) throw new Error('provider-credential-missing');
      return generateStructured({
        task,
        payload,
        model,
        baseUrl,
        apiKey,
        signal,
        timeoutMs,
        trace,
        negotiation,
        lookup: options.lookup,
        post: options.post,
        providerId: 'api',
        beforeRequest,
        onUsage,
        maxOutputChars,
        maxRepairAttempts: maxRepairAttempts === undefined ? options.maxRepairAttempts : maxRepairAttempts
      });
    }
  });
}

// 关掉 AI 不等于把功能变成一张空表单。确定性路径复用应用在别处已经信任的本地
// 规则，所以回退是一个真答案，而不是一句道歉。
function createDeterministicClient(builders = {}) {
  const builderByTask = Object.freeze({
    breakdown: builders.breakdown,
    enrich: builders.enrich,
    unstick: builders.unstick,
    clarify: builders.clarify
  });
  if (typeof builderByTask.breakdown !== 'function') {
    throw new TypeError('deterministic breakdown builder is required');
  }
  return Object.freeze({
    id: 'deterministic',
    endpoint: null,
    timeoutMs: 0,
    describeFields,
    async run(name, payload) {
      const task = taskByName(name);
      const builder = builderByTask[name];
      if (typeof builder !== 'function') {
        throw new TypeError(`deterministic ${name} builder is required`);
      }
      return task.validate(builder(payload), payload);
    }
  });
}

// 校验失败要和网络失败区分开再交给界面。两者都会回退，但一个说明“模型答得
// 不合约定”，另一个说明“根本没连上”——用户按前者去查密钥和 Base URL 是白查。
function failureReason(error) {
  let stage, message;
  try {
    stage = Object.getOwnPropertyDescriptor(error, 'stage')?.value;
    message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
  } catch (_) { return 'provider-failed'; }
  if (stage === 'validate') {
    const detail = proposalValidationDetail(error);
    return detail ? `proposal-rejected|${detail}` : 'proposal-rejected';
  }
  return typeof message === 'string' && message ? message : 'provider-failed';
}

module.exports = {
  probeConnection, connectionFailure,
  DEFAULT_AI_BASE_URL: DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  PROTOCOLS,
  chatCompletionsEndpoint,
  protocolEndpoint,
  createLlmTrace,
  describeFields,
  // Clarify is the one task whose outbound keys depend on a setting, so it also
  // exposes a per-request variant. describeFields() stays the static answer for
  // every task; this one is derived from the payload that is about to be sent.
  describeClarifyFields,
  CLARIFY_MEMORY_FIELDS,
  createApiClient,
  COLLABORATION_TASK,
  validateCollaborationResult,
  validateTaskDraft,
  createDeterministicClient,
  failureReason
};
