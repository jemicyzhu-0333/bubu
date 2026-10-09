'use strict';

const { isPlainObject, timestampOrNull, trimmedString } = require('../../../core/field-normalizers');
const { taskModel } = require('../../work');
const { ENERGY_LEVELS, EDIT_SCOPES, LIMITS } = taskModel;
const { createCapabilityCodec, emptyPayload } = require('../../../shared/ipc-validation');
const { describeRoutes } = require('../../../shared/ipc-routes');
const { CONFIRMABLE_KINDS } = require('../domain/memory-confirmation');

function decodeAiPreview(validation, includeBlocker) {
  const object = validation.requireObject();
  if (!object) return undefined;
  const allowed = ['title', 'description', 'clarification', 'taskId'];
  if (includeBlocker) allowed.push('blocker');
  validation.rejectUnknown(object, allowed);
  const title = validation.validateBoundedString(object.title, 'title', LIMITS.TITLE);
  const description = object.description === undefined || object.description === null || object.description === ''
    ? null : validation.validateBoundedString(object.description, 'description', LIMITS.DESCRIPTION);
  const clarification = object.clarification === undefined || object.clarification === null || object.clarification === ''
    ? null : validation.validateBoundedString(object.clarification, 'clarification', 200);
  let blocker = null;
  if (includeBlocker && object.blocker !== undefined && object.blocker !== null && object.blocker !== '') {
    blocker = validation.validateBoundedString(object.blocker, 'blocker', LIMITS.BLOCKER);
  }
  const value = { title, description, clarification, taskId: validation.validateTaskId(object.taskId) };
  if (includeBlocker) value.blocker = blocker;
  return value;
}

// 「针对这件事的下一步」只带两个字段:哪件事、卡在哪。标题与步骤由主进程按
// taskId 自己读,所以这里不接也不允许渲染层传任务内容。
function decodeSuggestUnstick(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['taskId', 'note']);
  const note = object.note === undefined || object.note === null || object.note === ''
    ? null : validation.validateBoundedString(object.note, 'note', 500);
  return { taskId: validation.validateTaskId(object.taskId), note };
}

function decodeApplyProposal(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['proposalId', 'steps', 'targetTaskId', 'scope']);
  const proposalId = validation.validateId(object.proposalId, 'proposalId');
  let steps = [];
  if (!Array.isArray(object.steps) || object.steps.length < 1 || object.steps.length > LIMITS.STEPS) {
    validation.fail(`steps must be an array with 1 to ${LIMITS.STEPS} entries`);
  } else {
    steps = object.steps.map((step, index) => {
      if (!isPlainObject(step)) {
        validation.fail(`steps[${index}] must be an object`);
        return null;
      }
      validation.rejectUnknown(step, ['title']);
      const title = validation.validateBoundedString(step.title, `steps[${index}].title`, LIMITS.STEP_TITLE);
      return title ? { title } : null;
    }).filter(Boolean);
  }
  let scope;
  if (object.scope !== undefined && object.scope !== null) {
    if (!EDIT_SCOPES.includes(object.scope)) validation.fail(`scope must be one of: ${EDIT_SCOPES.join(', ')}`);
    else scope = object.scope;
  }
  return { proposalId, steps, targetTaskId: validation.validateTaskId(object.targetTaskId), scope };
}

function decodeReviewResolve(validation) {
  const object = validation.requireObject();
  if (!object) return undefined;
  validation.rejectUnknown(object, ['id', 'action', 'progress', 'confirmedTaskIds']);
  const id = validation.validateId(object.id, 'reviewId');
  if (!['done', 'dismissed', 'progress'].includes(object.action)) validation.fail('review action is invalid');
  if (object.progress !== undefined
      && (!Number.isInteger(object.progress) || object.progress < 0 || object.progress > 100)) {
    validation.fail('progress must be an integer from 0 to 100');
  }
  let confirmedTaskIds = [];
  if (object.confirmedTaskIds !== undefined) {
    if (!Array.isArray(object.confirmedTaskIds) || object.confirmedTaskIds.length > 3) {
      validation.fail('confirmedTaskIds must contain at most 3 task ids');
    } else {
      confirmedTaskIds = object.confirmedTaskIds.map((taskId, index) => (
        validation.validateId(taskId, `confirmedTaskIds[${index}]`)
      ));
    }
  }
  return { id, action: object.action, progress: object.progress, confirmedTaskIds };
}

const codec = createCapabilityCodec({
  'tasks:pickOne': validation => {
    if (validation.payload === undefined || validation.payload === null) return { limit: 2, explain: true };
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['limit', 'explain']);
    const limit = object.limit === undefined ? 2 : object.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 2) validation.fail('limit must be an integer from 1 to 2');
    if (object.explain !== undefined && typeof object.explain !== 'boolean') validation.fail('explain must be boolean');
    return { limit, explain: object.explain !== false };
  },
  'tasks:preview-breakdown': validation => {
    const value = trimmedString(validation.payload, null, 100);
    if (typeof validation.payload !== 'string' || !value || validation.payload.trim().length > 100) {
      validation.fail('title must be a non-empty string of at most 100 characters');
    }
    return value;
  },
  'ai:credential-status': emptyPayload,
  'ai:credential-import': validation => {
    if (validation.payload === undefined || validation.payload === null) return undefined;
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['secret']);
    const secret = typeof object.secret === 'string' ? object.secret.trim() : '';
    if (!secret) validation.fail('secret must be a non-empty string');
    else if (secret.length > 4096) validation.fail('secret must be at most 4096 characters');
    else if (/\s/.test(secret)) validation.fail('secret must not contain whitespace');
    else return { secret };
    return undefined;
  },
  'ai:clear-credential': emptyPayload,
  'ai:preview-breakdown': validation => decodeAiPreview(validation, true),
  'ai:preview-enrich': validation => decodeAiPreview(validation, false),
  // 弹窗关掉时掰断还在等的拆解 / 补全请求。没有参数：只能取消，不能指定别人的请求。
  'ai:cancel': emptyPayload,
  'ai:suggest-unstick': decodeSuggestUnstick,
  // ARCHITECTURE「AI 与 LLM」: 多轮澄清。没有 conversationId = 开一个新会话;有就必须是这个渲染进程
  // 自己开的那个(归属由主进程按 sender 校验,渲染层递不出别人的会话)。
  // 提交仍然走既有的 tasks:add-with-breakdown —— 这里不收任务内容,所以也不存在
  // 「澄清出来的任务绕过任务创建的那套不变量」这条路。
  'ai:draft-turn': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['conversationId', 'message']);
    const conversationId = object.conversationId === undefined || object.conversationId === null
      ? null : validation.validateId(object.conversationId, 'conversationId');
    return { conversationId, message: validation.validateBoundedString(object.message, 'message', 2000) };
  },
  'ai:draft-discard': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['conversationId']);
    return { conversationId: validation.validateId(object.conversationId, 'conversationId') };
  },
  'tasks:apply-proposal': decodeApplyProposal,
  'tasks:dismiss-proposal': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['proposalId']);
    return { proposalId: validation.validateId(object.proposalId, 'proposalId') };
  },
  'strategy:request': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['phase', 'taskId']);
    const phases = ['pre-start', 'distraction', 'working-memory', 'time-visibility', 'recovery'];
    if (!phases.includes(object.phase)) validation.fail(`phase must be one of: ${phases.join(', ')}`);
    return { phase: object.phase, taskId: validation.validateTaskId(object.taskId) };
  },
  'strategy:feedback': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['strategyId', 'helpful']);
    const strategyId = validation.validateId(object.strategyId, 'strategyId');
    if (typeof object.helpful !== 'boolean') validation.fail('helpful must be boolean');
    return { strategyId, helpful: object.helpful };
  },
  'reviews:open': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['id']);
    return { id: validation.validateId(object.id, 'reviewId') };
  },
  'reviews:resolve': decodeReviewResolve,
  'energy:check-in': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['level', 'state', 'timestamp']);
    if (!Number.isInteger(object.level) || object.level < 10 || object.level > 90) {
      validation.fail('level must be an integer from 10 to 90');
    }
    if (!ENERGY_LEVELS.includes(object.state)) validation.fail('state must be low, medium, or high');
    const timestamp = typeof object.timestamp === 'number' && Number.isFinite(object.timestamp)
      ? timestampOrNull(object.timestamp) : null;
    if (timestamp === null || timestamp > Date.now() + 5 * 60 * 1000) {
      validation.fail('timestamp must be a valid current timestamp');
    }
    return { level: object.level, state: object.state, timestamp };
  },
  // 今天几点起的。minutes 为 null 是“问过了，跳过”；日期永远是主进程的今天，渲染端不能指定。
  'energy:set-wake': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['minutes']);
    const minutes = object.minutes;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 14 * 60 - 1)) {
      validation.fail('minutes must be null or a whole number of minutes since midnight, before 14:00');
    }
    return { minutes };
  },
  'mood:delete': validation => validation.validateId(validation.payload),
  'energy:adjust': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['direction']);
    if (!Object.prototype.hasOwnProperty.call({ lower: true, same: true, higher: true }, object.direction)) {
      validation.fail('direction must be lower, same, or higher');
    }
    return { direction: object.direction };
  },
  // ARCHITECTURE「日常与能量」's way back. No payload: "丢掉学到的东西" has no parameters, and a
  // channel that took the profile to discard would let a surface decide what the
  // model knows.
  'energy:reset-calibration': emptyPayload,
  // ARCHITECTURE「事实流与长期记忆」: long-term memory the user can see and delete. guidance owns the
  // memory contract (it is the only decider of what is worth remembering); the
  // Legacy mutation contracts remain registered for fail-closed compatibility.
  // Versioned management reads and reviewed writes have a focused closed codec.
  'memory:forget': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['memoryId']);
    return { memoryId: validation.validateId(object.memoryId, 'memoryId') };
  },
  'memory:clear': emptyPayload,
  // ARCHITECTURE「事实流与长期记忆」: 记忆的写入者只有 guidance,而 user-confirmed 的入口就是这里。渲染层
  // 只递「记什么」(kind/subject/body);source、confidence、是否过期一律由 domain
  // 的 confirmMemory 定死,渲染层无从伪造成一条「用户说过」的事实。
  'memory:remember': validation => {
    const object = validation.requireObject();
    if (!object) return undefined;
    validation.rejectUnknown(object, ['kind', 'subject', 'body']);
    if (!CONFIRMABLE_KINDS.includes(object.kind)) {
      validation.fail(`kind must be one of: ${CONFIRMABLE_KINDS.join(', ')}`);
    }
    const subject = validation.validateBoundedString(object.subject, 'subject', 200);
    const body = validation.validateBoundedString(object.body, 'body', 500);
    return { kind: object.kind, subject, body };
  }
});

const surfaces = Object.fromEntries(codec.channels.map(channel => [channel, ['popover']]));
const ipcRoutes = describeRoutes('guidance', codec, surfaces, [
  'tasks:pickOne', 'tasks:preview-breakdown', 'ai:credential-status',
  'ai:preview-breakdown', 'ai:preview-enrich'
]);

module.exports = { ipcRoutes: Object.freeze([...ipcRoutes, ...require('./collaboration-codec').ipcRoutes, ...require('./change-codec').ipcRoutes, ...require('./planning-codec').ipcRoutes, ...require('./memory-management-codec').ipcRoutes]) };
