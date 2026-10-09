'use strict';

const { isPlainObject, trimmedString } = require('./field-normalizers');
const {
  MIN_STEPS,
  MAX_STEPS,
  MAX_STEP_TITLE,
  MAX_SERIALIZED_BYTES,
  DEPENDS_ON_DESCRIPTION,
  SAFE_STOP_DESCRIPTION,
  STEP_TITLE_DESCRIPTION,
  buildStepsJsonSchema,
  exactKeys,
  parseRawProposal,
  validateSteps
} = require('./llm/validate-steps');

const MAX_QUESTION = 200;
const MAX_PROPOSALS = 5;
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

const PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['steps', 'clarifyingQuestion'],
  properties: {
    steps: buildStepsJsonSchema(),
    clarifyingQuestion: {
      anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: MAX_QUESTION }],
      description: [
        'One question to ask only when the task cannot be split without it.',
        'Use null when the steps stand on their own, which is the common case.'
      ].join(' ')
    }
  }
});

// exactKeys, parseRawProposal and validateSteps are shared with enrich-proposal.js
// via core/llm/validate-steps.js — a rule change there applies to both proposal kinds.

function validateProposal(raw) {
  const proposal = parseRawProposal(raw);
  if (!isPlainObject(proposal)) throw new TypeError('proposal must be an object');
  exactKeys(proposal, ['steps', 'clarifyingQuestion'], 'proposal');
  const steps = validateSteps(proposal.steps);
  let clarifyingQuestion = null;
  if (proposal.clarifyingQuestion !== null) {
    clarifyingQuestion = trimmedString(proposal.clarifyingQuestion, null, MAX_QUESTION);
    if (!clarifyingQuestion || proposal.clarifyingQuestion.trim().length > MAX_QUESTION) {
      throw new RangeError('clarifyingQuestion is invalid');
    }
  }
  const normalized = { steps, clarifyingQuestion };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new RangeError('proposal exceeds 8 KB');
  }
  return Object.freeze(normalized);
}

function buildDeterministicProposal(steps) {
  const source = Array.isArray(steps) ? steps.slice(0, MAX_STEPS) : [];
  while (source.length < MIN_STEPS) source.push({ title: '检查当前结果' });
  return validateProposal({
    steps: source.map((step, index) => ({
      title: typeof step === 'string' ? step : step.title,
      dependsOn: index === 0 ? null : index - 1,
      safeStopAfter: index === source.length - 1
    })),
    clarifyingQuestion: null
  });
}

module.exports = {
  MIN_STEPS,
  MAX_STEPS,
  MAX_STEP_TITLE,
  MAX_SERIALIZED_BYTES,
  MAX_PROPOSALS,
  PROPOSAL_TTL_MS,
  DEPENDS_ON_DESCRIPTION,
  SAFE_STOP_DESCRIPTION,
  STEP_TITLE_DESCRIPTION,
  PROPOSAL_JSON_SCHEMA,
  validateProposal,
  buildDeterministicProposal
};
