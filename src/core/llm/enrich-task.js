'use strict';

const { MAX_SERIALIZED_BYTES } = require('../breakdown-proposal');
const {
  ENERGY_LEVELS,
  buildEnrichJsonSchema,
  normalizeAllowedTags,
  validateEnrichProposal
} = require('../enrich-proposal');
const {
  parseJsonObject,
  dropUnknownKeys,
  coerceInteger,
  coerceEnum,
  keepAllowed
} = require('./repair');
const {
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  FIELD_SEMANTICS_NOTE,
  repairProposalSteps
} = require('./task-contract-shared');

const ENRICH_FIELDS = Object.freeze(['title', 'description', 'clarification', 'existingTags']);

const ENRICH_INSTRUCTION = [
  'Fill in the optional planning fields for one task the user has already written down, and split it into steps.',
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  'Never restate, translate or rewrite the task title, and never diagnose the user.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const ENRICH_TASK = Object.freeze({
  name: 'enrich',
  schemaName: 'im_adhder_enrich',
  instruction: ENRICH_INSTRUCTION,
  fields: ENRICH_FIELDS,
  buildSchema: payload => buildEnrichJsonSchema(payload.existingTags),
  buildInput: payload => ({
    title: payload.title,
    description: payload.description || null,
    clarification: payload.clarification || null,
    existingTags: normalizeAllowedTags(payload.existingTags)
  }),
  repair(raw, payload = {}) {
    const allowedTags = normalizeAllowedTags(payload.existingTags);
    const keys = ['steps', 'completionCriteria', 'energy', 'estimateMinutes', 'tags'];
    const proposal = dropUnknownKeys(parseJsonObject(raw, MAX_SERIALIZED_BYTES), keys);
    if (!proposal || typeof proposal !== 'object') return proposal;
    return {
      steps: repairProposalSteps(proposal.steps),
      completionCriteria: proposal.completionCriteria === undefined ? null : proposal.completionCriteria,
      energy: proposal.energy === undefined ? null : coerceEnum(proposal.energy, ENERGY_LEVELS),
      estimateMinutes: proposal.estimateMinutes === undefined ? null : coerceInteger(proposal.estimateMinutes),
      tags: proposal.tags === undefined ? [] : keepAllowed(proposal.tags, allowedTags)
    };
  },
  validate: (proposal, payload = {}) => validateEnrichProposal(proposal, {
    allowedTags: normalizeAllowedTags(payload.existingTags)
  })
});

module.exports = { ENRICH_INSTRUCTION, ENRICH_FIELDS, ENRICH_TASK };
