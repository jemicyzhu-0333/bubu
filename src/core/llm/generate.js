'use strict';

const { postJson, resolveTimeout } = require('./transport');
const { protocolEndpoint, PROTOCOLS } = require('./endpoint');
const {
  buildRequest,
  extractText,
  isSchemaModeRejection,
  isProtocolMissing,
  nextSchemaMode,
  nextProtocol,
  SCHEMA_MODES
} = require('./openai');
const { NO_LLM_TRACE } = require('./trace');
const { responseUsage } = require('./usage');
const { rememberProposalValidationDetail } = require('./proposal-validation-detail');
const { createDiagnosticObservation, diagnosticRejection, diagnosticTransport } = require('./diagnostic-observation');

// L3b：一次结构化生成的编排。这一层决定“失败之后做什么”，而这正是旧实现里
// 完全缺失的一格：一次校验不过就整份回退本地模板，一个整数的起点约定因此拥有
// 一票否决权。
//
// 四种失败要区别对待，混在一起处理就会既浪费额度又修不好问题：
//   1. 对面没有这个路由（404/405）——换另一种线上形状重发，并把 schema 档位重置
//      到最严：上一种协议根本不存在，我们对它的 schema 能力一无所知。
//   2. 对面看不懂 response_format —— 降一档 schema 下发方式重发。
//   3. 产物过不了校验 —— 把校验器那句话原文回灌，让模型改。这是唯一模型能
//      据此自我修正的失败，也是业界（Instructor 的 reask、PydanticAI 的
//      ModelRetry）唯一真正会重试的一类。
//   4. 超时、取消、401、429、5xx —— 立刻停。这些重发一次也不会变好，只会让
//      用户在转圈里多等一轮。
//
// 前两种都不计入重试次数：模型还没有机会答错任何东西。真正的重试次数是 1，
// 不是 3：这里有一个正在转圈的按钮和一条 180 秒的截止线，而截止线由调用方的
// signal 统一持有——所有尝试共享同一条，重试因此不会把等待时间翻倍。

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const VALIDATE_STAGE = 'validate';

// 校验失败的错误对象上打个记号，附带模型原文。靠 message 字串猜“这是校验错误
// 还是网络错误”会在新增一条校验规则时静默失效。
function markValidationFailure(error, modelText) {
  const marked = error instanceof Error ? error : new Error(String(error));
  marked.stage = VALIDATE_STAGE;
  marked.modelText = modelText;
  return marked;
}

function isValidationFailure(error) {
  return Boolean(error && error.stage === VALIDATE_STAGE);
}

// 回灌的就是校验器抛出的那一句原文。它已经点名了哪个字段、第几步、以及期望
// 什么——这正是模型能照着改的形状，所以不要在这里改写它。
function repairPrompt(message) {
  return [
    'Your previous answer was rejected by the schema validator with this error:',
    message,
    'Return the corrected JSON object. Fix only what the error names, keep everything else byte-identical,',
    'and output nothing but the JSON.'
  ].join('\n');
}

// schema 档位和协议一样要记住：只记协议不记档位时，一个不支持 json_schema 的
// 网关每次请求都先吃一个 400 再降档，白跑一轮往返。档位按协议分开记，因为同一
// 个 base URL 下两种线上形状的能力可以不同。键与协议共用同一个 Map：
// `baseUrl` → 协议，`baseUrl#schema-mode:<protocol>` → 档位。
function schemaModeKey(baseUrl, protocol) {
  return `${baseUrl}#schema-mode:${protocol}`;
}

function rememberedMode(negotiation, baseUrl, protocol) {
  const mode = negotiation ? negotiation.get(schemaModeKey(baseUrl, protocol)) : null;
  return SCHEMA_MODES.includes(mode) ? mode : SCHEMA_MODES[0];
}

function abortReason(signal) {
  return signal && signal.aborted;
}

async function generateStructured(options = {}) {
  const {
    task,
    payload = {},
    model,
    baseUrl,
    apiKey = '',
    lookup,
    signal,
    trace = NO_LLM_TRACE,
    providerId = 'api',
    // 上一次谈成的协议记在这里（一个普通 Map，key 是 base URL）。不存就意味着
    // 每次请求都要先撑一个 404：一轮白跑的往返，加一条看起来像故障的日志。
    // 它只是缓存：空的、陈旧的、被丢掉的都不影响正确性，最多多走一档阶梯。
    negotiation,
    // 传输口可注入。默认就是 L1，但这一层真正要验的是“失败之后做什么”，
    // 而那些分支靠真实网络拼不出来；依赖方向也因此是向下而不是写死的。
    post = postJson
  } = options;
  if (!task || typeof task.repair !== 'function' || typeof task.validate !== 'function') {
    throw new TypeError('task with repair and validate is required');
  }
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const maxRepairAttempts = Number.isInteger(options.maxRepairAttempts)
    ? Math.max(0, Math.min(3, options.maxRepairAttempts))
    : DEFAULT_MAX_REPAIR_ATTEMPTS;
  const schema = task.buildSchema(payload);
  const messages = [
    { role: 'system', content: task.instruction },
    { role: 'user', content: JSON.stringify(task.buildInput(payload)) }
  ];

  const remembered = negotiation ? negotiation.get(baseUrl) : null;
  let protocol = PROTOCOLS.includes(remembered) ? remembered : PROTOCOLS[0];
  let mode = rememberedMode(negotiation, baseUrl, protocol);
  let repairAttempts = 0;
  let attempt = 0;
  const observation = createDiagnosticObservation(options, signal);
  const observe = (phase, data = {}) => observation(phase, { protocol, mode, attempt, repairAttempts, ...data });
  const span = trace.begin({ kind: task.name, provider: providerId, protocol, model, mode });

  try {
    // 每一轮要么返回，要么改变状态（换协议、降档或追加回灌消息）后继续；
    // 三者都不发生就抛出，而两条阶梯都只往下走，所以这个循环不会空转。
    for (;;) {
      let text;
      try {
        if (signal && signal.aborted) throw new Error('provider-request-aborted');
        if (typeof options.beforeRequest === 'function') options.beforeRequest();
        if (signal && signal.aborted) throw new Error('provider-request-aborted');
        const endpoint = protocolEndpoint(baseUrl, protocol);
        const request = buildRequest({ protocol, model, messages, schema, schemaName: task.schemaName, mode });
        attempt += 1;
        observe('attempt');
        if (signal && signal.aborted) throw new Error('provider-request-aborted');
        const response = await post(
          endpoint,
          request,
          { apiKey, signal, timeoutMs, lookup, span }
        );
        if (signal && signal.aborted) throw new Error('provider-request-aborted');
        if (typeof options.onUsage === 'function') options.onUsage(responseUsage(protocol, response));
        text = extractText(protocol, response);
        observe('output', { text });
        if (Number.isSafeInteger(options.maxOutputChars) && [...text].length > options.maxOutputChars) {
          throw new RangeError('provider-output-budget');
        }
        span.output(text);
      } catch (error) {
        // 换协议与降档都必须让位于取消：截止线到点时对面回什么都不该让我们再发一次。
        if (abortReason(signal)) throw new Error('provider-request-aborted');
        observe('transport', diagnosticTransport(error));
        if (!abortReason(signal)) {
          // 先判“点名了参数”，再判“路由缺失”：前者更具体，而一个 404 既可能是
          // 路由不存在，也可能是网关拿 404 报“不支持 response_format”。
          if (isSchemaModeRejection(error)) {
            const downgraded = nextSchemaMode(mode);
            if (downgraded) {
              span.note(`schema mode ${mode} rejected by provider (${error.detail}); retrying as ${downgraded}`);
              mode = downgraded;
              continue;
            }
          }
          if (isProtocolMissing(error)) {
            const switched = nextProtocol(protocol);
            if (switched) {
              span.note(`${protocol} route absent (HTTP ${error.statusCode}); retrying as ${switched}`);
              protocol = switched;
              // 上一种协议根本不存在，它的降档结论对新协议没有任何参考价值；
              // 新协议自己以前谈成过的档位仍然作数。
              mode = rememberedMode(negotiation, baseUrl, protocol);
              continue;
            }
          }
        }
        throw error;
      }

      try {
        if (abortReason(signal)) throw new Error('provider-request-aborted');
        const repaired = task.repair(text, payload);
        observe('repaired', { value: repaired });
        const validated = task.validate(repaired, payload);
        if (abortReason(signal)) throw new Error('provider-request-aborted');
        observe('validated', { value: validated });
        if (abortReason(signal)) throw new Error('provider-request-aborted');
        // 只在真的拿到一份能用的答案后才记住协议。一个 200 就记下来也行，但
        // 那样一个只会回空壳的路由也会被当成“谈成了”。
        if (negotiation) {
          negotiation.set(baseUrl, protocol);
          negotiation.set(schemaModeKey(baseUrl, protocol), mode);
        }
        span.done({ protocol, mode, repairAttempts });
        return validated;
      } catch (error) {
        if (abortReason(signal)) throw new Error('provider-request-aborted');
        const failure = markValidationFailure(error, text);
        rememberProposalValidationDetail(failure, task.name);
        observe('rejected', diagnosticRejection(task.name, error));
        if (repairAttempts >= maxRepairAttempts || abortReason(signal)) throw failure;
        repairAttempts += 1;
        span.note(`validation failed (${failure.message}); feeding it back, attempt ${repairAttempts}/${maxRepairAttempts}`);
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: repairPrompt(failure.message) });
      }
    }
  } catch (error) {
    span.failed(error, { protocol, mode, repairAttempts });
    throw error;
  }
}

module.exports = {
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  schemaModeKey,
  VALIDATE_STAGE,
  isValidationFailure,
  repairPrompt,
  generateStructured
};
