'use strict';

const { isPlainObject, trimmedString } = require('./field-normalizers');
const {
  MIN_STEPS,
  MAX_STEPS,
  MAX_SERIALIZED_BYTES,
  buildStepsJsonSchema,
  exactKeys,
  parseRawProposal,
  validateSteps
} = require('./llm/validate-steps');

// An enrich proposal answers a different question than a breakdown: not only
// "what are the steps" but "what would this task look like if someone filled in
// the optional fields for me". It stays a read-only suggestion — every field is
// still edited and confirmed by the user before any task transaction runs.
//
// Title is deliberately absent. The title is the one fact the user wrote down;
// a model rewriting it would replace the thing being planned with its own guess.

const ENERGY_LEVELS = Object.freeze(['low', 'medium', 'high']);
const MAX_COMPLETION_CRITERIA = 200;
const MAX_SUGGESTED_TAGS = 3;
const AI_ENRICH_MIN_ESTIMATE_MINUTES = 5;
const AI_ENRICH_MAX_ESTIMATE_MINUTES = 480;

// Tags are locked to the tag set the user already uses. A model inventing new
// tags turns a small personal vocabulary into a pile of near-synonyms, and the
// user pays that cost forever while the suggestion was only a guess. The empty
// candidate set collapses to `maxItems: 0`, because `enum: []` is not valid
// JSON Schema and would silently disable strict validation.
//
// 字段语义一律写在 description 里（步骤三个字段直接复用 breakdown 的那三句）：
// 两份 schema 对同名字段各写一遍说明，就是两边开始漂的方式。
function buildEnrichJsonSchema(allowedTags = []) {
  const tags = normalizeAllowedTags(allowedTags);
  const tagsSchema = tags.length === 0
    ? {
        type: 'array', maxItems: 0, items: { type: 'string' },
        description: 'The user has no tags yet, so this must be an empty array.'
      }
    : {
        type: 'array', maxItems: MAX_SUGGESTED_TAGS, items: { type: 'string', enum: tags },
        description: [
          `At most ${MAX_SUGGESTED_TAGS} tags, copied verbatim from this enum and nothing else.`,
          'Never invent, translate, split or pluralise a tag.',
          'An empty array is the correct answer whenever none of them genuinely fit, and that is the common case.'
        ].join(' ')
      };
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['steps', 'completionCriteria', 'energy', 'estimateMinutes', 'tags'],
    properties: {
      steps: buildStepsJsonSchema(),
      completionCriteria: {
        anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: MAX_COMPLETION_CRITERIA }],
        description: [
          'One observable end state in a single sentence: what will be true when they stop.',
          'Not a feeling, not "done properly". Use null when the situation does not let you name one.'
        ].join(' ')
      },
      energy: {
        anyOf: [{ type: 'null' }, { type: 'string', enum: [...ENERGY_LEVELS] }],
        description: [
          'How much executive effort the work needs:',
          'low for mechanical or already-decided work, high for sustained decision making.',
          'Use null when unclear.'
        ].join(' ')
      },
      estimateMinutes: {
        anyOf: [{ type: 'null' }, { type: 'integer', minimum: AI_ENRICH_MIN_ESTIMATE_MINUTES, maximum: AI_ENRICH_MAX_ESTIMATE_MINUTES }],
        description: [
          `Total minutes for the steps listed, between ${AI_ENRICH_MIN_ESTIMATE_MINUTES} and ${AI_ENRICH_MAX_ESTIMATE_MINUTES}.`,
          'ADHD time estimates run optimistic, so do not shave the number to look encouraging;',
          'use null rather than guessing wildly.'
        ].join(' ')
      },
      tags: tagsSchema
    }
  });
}

function normalizeAllowedTags(allowedTags) {
  if (!Array.isArray(allowedTags)) return [];
  const seen = new Set();
  for (const raw of allowedTags) {
    const tag = trimmedString(raw, null, 20);
    if (tag && !seen.has(tag)) seen.add(tag);
  }
  return [...seen];
}

// exactKeys, parseRawProposal and validateSteps are shared with breakdown-proposal.js
// via core/llm/validate-steps.js — a rule change there applies to both proposal kinds.

function validateEnrichProposal(raw, options = {}) {
  const proposal = parseRawProposal(raw);
  if (!isPlainObject(proposal)) throw new TypeError('enrich proposal must be an object');
  exactKeys(proposal, ['steps', 'completionCriteria', 'energy', 'estimateMinutes', 'tags'], 'enrich proposal');

  const steps = validateSteps(proposal.steps);

  let completionCriteria = null;
  if (proposal.completionCriteria !== null) {
    completionCriteria = trimmedString(proposal.completionCriteria, null, MAX_COMPLETION_CRITERIA);
    if (!completionCriteria || proposal.completionCriteria.trim().length > MAX_COMPLETION_CRITERIA) {
      throw new RangeError('completionCriteria is invalid');
    }
  }

  const energy = proposal.energy;
  if (energy !== null && !ENERGY_LEVELS.includes(energy)) throw new TypeError('energy is invalid');

  const estimateMinutes = proposal.estimateMinutes;
  if (estimateMinutes !== null && (!Number.isInteger(estimateMinutes)
      || estimateMinutes < AI_ENRICH_MIN_ESTIMATE_MINUTES || estimateMinutes > AI_ENRICH_MAX_ESTIMATE_MINUTES)) {
    throw new RangeError('estimateMinutes is invalid');
  }

  // The schema already constrains tags with an enum, but a provider that
  // ignores the schema must not be able to widen the user's tag vocabulary.
  const allowed = new Set(normalizeAllowedTags(options.allowedTags));
  if (!Array.isArray(proposal.tags) || proposal.tags.length > MAX_SUGGESTED_TAGS) {
    throw new RangeError(`tags must contain at most ${MAX_SUGGESTED_TAGS} entries`);
  }
  const tags = [];
  for (const rawTag of proposal.tags) {
    const tag = trimmedString(rawTag, null, 20);
    if (!tag || !allowed.has(tag)) throw new TypeError('tags may only reuse existing tags');
    if (!tags.includes(tag)) tags.push(tag);
  }

  const normalized = { steps, completionCriteria, energy, estimateMinutes, tags };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new RangeError('proposal exceeds 8 KB');
  }
  return Object.freeze(normalized);
}

// Turning AI off must not turn the feature into a blank form. The deterministic
// path reuses the same local rules the app already trusts elsewhere, so the
// fallback is a real answer rather than an apology.
function buildDeterministicEnrich(input = {}) {
  const source = Array.isArray(input.steps) ? input.steps.slice(0, MAX_STEPS) : [];
  while (source.length < MIN_STEPS) source.push({ title: '检查当前结果' });
  const estimate = Number.isInteger(input.estimateMinutes)
    ? Math.min(AI_ENRICH_MAX_ESTIMATE_MINUTES, Math.max(AI_ENRICH_MIN_ESTIMATE_MINUTES, input.estimateMinutes))
    : null;
  return validateEnrichProposal({
    steps: source.map((step, index) => {
      const title = typeof step === 'string' ? step : step.title;
      return {
        title,
        dependsOn: index === 0 ? null : index - 1,
        safeStopAfter: index === source.length - 1
      };
    }),
    completionCriteria: null,
    energy: ENERGY_LEVELS.includes(input.energy) ? input.energy : null,
    estimateMinutes: estimate,
    tags: []
  }, { allowedTags: [] });
}

module.exports = {
  ENERGY_LEVELS,
  MAX_COMPLETION_CRITERIA,
  MAX_SUGGESTED_TAGS,
  MIN_ESTIMATE_MINUTES: AI_ENRICH_MIN_ESTIMATE_MINUTES,
  MAX_ESTIMATE_MINUTES: AI_ENRICH_MAX_ESTIMATE_MINUTES,
  AI_ENRICH_MIN_ESTIMATE_MINUTES,
  AI_ENRICH_MAX_ESTIMATE_MINUTES,
  buildEnrichJsonSchema,
  normalizeAllowedTags,
  validateEnrichProposal,
  buildDeterministicEnrich
};
