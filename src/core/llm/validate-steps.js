'use strict';

// Shared step validation for LLM proposal outputs.
// Both breakdown-proposal and enrich-proposal validate steps with the same
// shape (title, dependsOn, safeStopAfter) and the same structural rules (bounded
// text, 0-based dependency index, boolean safeStopAfter). This module
// is the single source of truth; the two proposal files import it so a
// rule change in one place cannot drift from the other.

const { isPlainObject, trimmedString } = require('../field-normalizers');

const MIN_STEPS = 3;
const MAX_STEPS = 7;
const MAX_STEP_TITLE = 200;
const MAX_SERIALIZED_BYTES = 8 * 1024;

// 每个字段的语义写在 schema 的 description 里，不写在散文提示词里。
//
// 这不是文档洁癖：`dependsOn` 的"0 起数组下标"这个约定原先只存在于校验器，
// 提示词里那句"只在真的不能先开始时才设置"完全没提编号方式。模型于是按人类
// 习惯给了 1-based，steps[1].dependsOn=1 变成自己依赖自己，一份可用的建议整份
// 作废。字段说明是唯一一定会跟着请求一起上线的东西——json_schema 档位由协议
// 传给模型，降级到 json_object 时被整段贴进提示词。放在这里，两条路都盖住。
const DEPENDS_ON_DESCRIPTION = [
  'Zero-based index of an earlier step in this same steps array.',
  "It must be strictly less than this step's own index, so the first step is always null.",
  'Use null whenever a step can be started without waiting for another one;',
  'set a number only where the work genuinely cannot begin before that earlier step is done.'
].join(' ');

const SAFE_STOP_DESCRIPTION = [
  'True when stopping right after this step leaves the work in a state the person can come back to',
  'without losing progress or having to redo it. The final step must always be true.'
].join(' ');

const STEP_TITLE_DESCRIPTION = [
  'One concrete action, naming the actual file, app, page, document or person involved.',
  'Write it in the same language as the task title.'
].join(' ');

function buildStepsJsonSchema() {
  return {
    type: 'array', minItems: MIN_STEPS, maxItems: MAX_STEPS,
    description: `Between ${MIN_STEPS} and ${MAX_STEPS} steps, in the order they should be done.`,
    items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'dependsOn', 'safeStopAfter'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_STEP_TITLE, description: STEP_TITLE_DESCRIPTION },
        dependsOn: {
          anyOf: [{ type: 'null' }, { type: 'integer', minimum: 0, maximum: MAX_STEPS - 2 }],
          description: DEPENDS_ON_DESCRIPTION
        },
        safeStopAfter: { type: 'boolean', description: SAFE_STOP_DESCRIPTION }
      }
    }
  };
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} contains unknown or missing fields`);
  }
}

function parseRawProposal(raw) {
  if (typeof raw !== 'string') return raw;
  if (Buffer.byteLength(raw, 'utf8') > MAX_SERIALIZED_BYTES) throw new RangeError('proposal exceeds 8 KB');
  try { return JSON.parse(raw); } catch (_) { throw new TypeError('proposal is not valid JSON'); }
}

/**
 * Validate a raw steps array from an LLM proposal.
 *
 * Both breakdown and enrich proposals share the same step shape, bounded text,
 * dependency rules and safeStopAfter contract. No wording is judged here.
 * This single implementation applies rule changes to both proposal kinds.
 *
 * @param {Array} rawSteps — raw proposal.steps array
 * @param {object} options
 * @param {number} [options.maxStepTitle=200] — max title length
 * @returns {Array<{title: string, dependsOn: number|null, safeStopAfter: boolean}>}
 */
function validateSteps(rawSteps, options = {}) {
  const maxStepTitle = Number.isInteger(options.maxStepTitle) ? options.maxStepTitle : MAX_STEP_TITLE;

  if (!Array.isArray(rawSteps) || rawSteps.length < MIN_STEPS || rawSteps.length > MAX_STEPS) {
    throw new RangeError(`proposal must contain ${MIN_STEPS}–${MAX_STEPS} steps`);
  }

  const steps = rawSteps.map((rawStep, index) => {
    if (!isPlainObject(rawStep)) throw new TypeError(`steps[${index}] must be an object`);
    exactKeys(rawStep, ['title', 'dependsOn', 'safeStopAfter'], `steps[${index}]`);

    const title = trimmedString(rawStep.title, null, maxStepTitle);
    if (!title || rawStep.title.trim().length > maxStepTitle) {
      throw new RangeError(`steps[${index}].title is invalid`);
    }

    const dependsOn = rawStep.dependsOn;
    if (dependsOn !== null && (!Number.isInteger(dependsOn) || dependsOn < 0 || dependsOn >= index)) {
      throw new RangeError(`steps[${index}].dependsOn must reference an earlier step`);
    }

    if (typeof rawStep.safeStopAfter !== 'boolean') {
      throw new TypeError(`steps[${index}].safeStopAfter must be boolean`);
    }

    return Object.freeze({ title, dependsOn, safeStopAfter: rawStep.safeStopAfter });
  });
  if (!steps.at(-1).safeStopAfter) {
    throw new RangeError('the final step must be a safe stop');
  }
  return steps;
}

module.exports = {
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
};
