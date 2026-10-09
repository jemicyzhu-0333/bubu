'use strict';

const { MAX_SERIALIZED_BYTES } = require('../breakdown-proposal');
const { ENERGY_LEVELS } = require('../enrich-proposal');
const { isPlainObject, trimmedString } = require('../field-normalizers');
const { exactKeys, parseRawProposal } = require('./validate-steps');
const { parseJsonObject, dropUnknownKeys } = require('./repair');
const { FIELD_SEMANTICS_NOTE, truncatedString } = require('./task-contract-shared');

const MAX_UNSTICK_ACTION = 60;

const MAX_UNSTICK_WHY = 80;

const MAX_UNSTICK_SPLIT_STEPS = 3;

// 卡了多久属于一次专注会话的事实，卡住建议这一层读不到它：这个字段从来没有过值，所以不在这里，也不在披露里。
const UNSTICK_FIELDS = Object.freeze(['title', 'steps', 'note', 'taskEnergyDemand']);

const UNSTICK_INSTRUCTION = [
  'Give one concrete next action for the task the person is stuck on.',
  'Use only the supplied unfinished steps and note. taskEnergyDemand is the effort required by the task, not the person\'s current energy or a self-report.',
  'No current self-report or planning estimate is supplied. Do not infer either from taskEnergyDemand, mood, or missing activity.',
  'The next action and fallback must be observable actions, not advice, reassurance or an apology.',
  'Keep the answer small enough to act on immediately. Do not diagnose, praise or moralise.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const UNSTICK_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['nextAction', 'why', 'fallbackAction', 'splitSteps'],
  properties: {
    nextAction: { type: 'string', minLength: 1, maxLength: MAX_UNSTICK_ACTION },
    why: { type: 'string', maxLength: MAX_UNSTICK_WHY },
    fallbackAction: { type: 'string', maxLength: MAX_UNSTICK_ACTION },
    splitSteps: {
      type: 'array', minItems: 0, maxItems: MAX_UNSTICK_SPLIT_STEPS,
      items: { type: 'string', minLength: 1, maxLength: MAX_UNSTICK_ACTION }
    }
  }
});

function normalizeOutboundSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 100).map(step => ({
    title: trimmedString(step && step.title, '', 200),
    done: Boolean(step && step.done)
  }));
}

function validateUnstickResult(raw) {
  const result = parseRawProposal(raw);
  if (!isPlainObject(result)) throw new TypeError('unstick result must be an object');
  exactKeys(result, ['nextAction', 'why', 'fallbackAction', 'splitSteps'], 'unstick result');
  if (!Array.isArray(result.splitSteps)) throw new TypeError('splitSteps must be an array');
  const splitSteps = result.splitSteps.slice(0, MAX_UNSTICK_SPLIT_STEPS).map((step, index) => (
    truncatedString(step, `splitSteps[${index}]`, MAX_UNSTICK_ACTION, { required: true })
  ));
  return Object.freeze({
    nextAction: truncatedString(result.nextAction, 'nextAction', MAX_UNSTICK_ACTION, { required: true }),
    why: truncatedString(result.why, 'why', MAX_UNSTICK_WHY),
    fallbackAction: truncatedString(result.fallbackAction, 'fallbackAction', MAX_UNSTICK_ACTION),
    splitSteps: Object.freeze(splitSteps)
  });
}

const UNSTICK_TASK = Object.freeze({
  name: 'unstick',
  schemaName: 'focuspix_unstick',
  instruction: UNSTICK_INSTRUCTION,
  fields: UNSTICK_FIELDS,
  buildSchema: () => UNSTICK_JSON_SCHEMA,
  buildInput: payload => ({
    title: payload.title,
    steps: normalizeOutboundSteps(payload.steps),
    note: trimmedString(payload.note, null, 500),
    taskEnergyDemand: ENERGY_LEVELS.includes(payload.taskEnergyDemand) ? payload.taskEnergyDemand : null
  }),
  repair(raw) {
    const result = dropUnknownKeys(parseJsonObject(raw, MAX_SERIALIZED_BYTES), [
      'nextAction', 'why', 'fallbackAction', 'splitSteps'
    ]);
    return result;
  },
  validate: validateUnstickResult
});

module.exports = {
  MAX_UNSTICK_ACTION,
  MAX_UNSTICK_WHY,
  MAX_UNSTICK_SPLIT_STEPS,
  UNSTICK_INSTRUCTION,
  UNSTICK_FIELDS,
  validateUnstickResult,
  UNSTICK_TASK
};
