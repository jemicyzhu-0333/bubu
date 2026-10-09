'use strict';

const {
  MAX_SERIALIZED_BYTES,
  PROPOSAL_JSON_SCHEMA,
  validateProposal
} = require('../breakdown-proposal');
const { parseJsonObject, dropUnknownKeys } = require('./repair');
const {
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  FIELD_SEMANTICS_NOTE,
  repairProposalSteps
} = require('./task-contract-shared');

// Every task discloses exactly the keys returned by buildInput().
const BREAKDOWN_FIELDS = Object.freeze(['title', 'description', 'clarification', 'blocker']);

const OUTBOUND_BLOCKERS = Object.freeze([
  'unclear', 'too-big', 'boring', 'anxious', 'low-energy', 'interrupted'
]);

function normalizeOutboundBlocker(blocker) {
  return OUTBOUND_BLOCKERS.includes(blocker) ? blocker : null;
}

const BREAKDOWN_INSTRUCTION = [
  'Split one task the user has already written down into steps they can execute.',
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  'When blocker is present, it names why this person is stuck right now: unclear means they cannot see what the work actually is, too-big means the scope is paralysing, boring means there is no traction, anxious means the stakes feel loud, low-energy means executive capacity is spent, interrupted means the thread was lost. Choose the first step that dissolves that specific blocker, and let the remaining steps follow from it.',
  'The title is the fact the user wrote down. Never restate, translate, reword or improve it.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const BREAKDOWN_TASK = Object.freeze({
  name: 'breakdown',
  schemaName: 'im_adhder_breakdown',
  instruction: BREAKDOWN_INSTRUCTION,
  fields: BREAKDOWN_FIELDS,
  buildSchema: () => PROPOSAL_JSON_SCHEMA,
  buildInput: payload => ({
    title: payload.title,
    description: payload.description || null,
    clarification: payload.clarification || null,
    blocker: normalizeOutboundBlocker(payload.blocker)
  }),
  repair(raw) {
    const proposal = dropUnknownKeys(parseJsonObject(raw, MAX_SERIALIZED_BYTES), ['steps', 'clarifyingQuestion']);
    if (!proposal || typeof proposal !== 'object') return proposal;
    return {
      ...proposal,
      steps: repairProposalSteps(proposal.steps),
      clarifyingQuestion: proposal.clarifyingQuestion === undefined ? null : proposal.clarifyingQuestion
    };
  },
  validate: proposal => validateProposal(proposal)
});

module.exports = {
  BREAKDOWN_INSTRUCTION,
  BREAKDOWN_FIELDS,
  OUTBOUND_BLOCKERS,
  normalizeOutboundBlocker,
  BREAKDOWN_TASK
};
