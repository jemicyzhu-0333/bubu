'use strict';

const { MAX_SERIALIZED_BYTES, PROPOSAL_JSON_SCHEMA } = require('../breakdown-proposal');
const {
  ENERGY_LEVELS,
  AI_ENRICH_MIN_ESTIMATE_MINUTES,
  AI_ENRICH_MAX_ESTIMATE_MINUTES
} = require('../enrich-proposal');
const { isPlainObject, trimmedString } = require('../field-normalizers');
const { exactKeys, parseRawProposal, validateSteps } = require('./validate-steps');
const { parseJsonObject, dropUnknownKeys, coerceInteger, coerceEnum } = require('./repair');
const {
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  FIELD_SEMANTICS_NOTE,
  repairProposalSteps
} = require('./task-contract-shared');

const MAX_TURNS = 6;

const MAX_CLARIFY_QUESTION = 60;

const MAX_CLARIFY_MISSING = 3;

const MAX_CLARIFY_MISSING_ITEM = 60;

const MAX_CLARIFY_TITLE = 100;

const MAX_CLARIFY_NOTES = 1000;

const MAX_CLARIFY_MEMORIES = 8;

const MAX_CLARIFY_MEMORY_BODY = 500;

const MAX_CLARIFY_MEMORY_SUBJECT = 200;

const MAX_CLARIFY_TOP_TASKS = 5;

const CLARIFY_FIELDS = Object.freeze(['transcript', 'turnIndex', 'maxTurns']);

// Clarify is the one task whose outbound keys depend on a setting: long-term
// memory is off by default (ARCHITECTURE「AI 与 LLM」), and when it is off these two keys are
// *absent* from the payload rather than present-and-empty. So CLARIFY_FIELDS
// stays the always-sent set and these are declared separately — a caller that
// wants the honest per-request list calls describeClarifyFields(payload).
const CLARIFY_MEMORY_FIELDS = Object.freeze(['memories', 'activityDigest']);

const CLARIFY_DIGEST_FIELDS = Object.freeze([
  'days', 'focusMinutes', 'sessionCount', 'completedTaskCount', 'abandonedSessionCount',
  'streakDays', 'topTasks'
]);

const CLARIFY_INSTRUCTION = [
  'Help turn a short multi-turn conversation into one task proposal.',
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  'Return need-more only when exactly one missing fact prevents a concrete proposal, and ask exactly one question.',
  'Always return all four fields. Fields that do not apply to the chosen status are null.',
  'turnIndex is zero-based. maxTurns is the total turn budget. On the final allowed turn, return ready rather than another question.',
  'When ready, use only facts in the transcript. Do not invent people, files, deadlines or deliverables.',
  'memories and activityDigest, when present, describe this person\'s own history. Use them to avoid asking what is already known, never as facts about the task itself: a remembered preference is not a requirement the user stated here.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const CLARIFY_READY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['title', 'steps', 'estimateMinutes', 'energy', 'notes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MAX_CLARIFY_TITLE },
    steps: PROPOSAL_JSON_SCHEMA.properties.steps,
    estimateMinutes: {
      anyOf: [{ type: 'null' }, {
        type: 'integer',
        minimum: AI_ENRICH_MIN_ESTIMATE_MINUTES,
        maximum: AI_ENRICH_MAX_ESTIMATE_MINUTES
      }]
    },
    energy: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...ENERGY_LEVELS] }] },
    notes: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: MAX_CLARIFY_NOTES }] }
  }
});

// The root must be an object: OpenAI strict mode (and Azure's structured
// outputs) reject a oneOf/anyOf root, so a oneOf of the two result shapes cost
// every clarify turn a 400 and a downgrade to json_object. Both shapes are laid
// out flat instead, with the fields that do not apply to a status set to null.
// repair() folds this back into the internal need-more / ready shape.
const CLARIFY_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'question', 'missing', 'proposal'],
  properties: {
    status: {
      type: 'string', enum: ['need-more', 'ready'],
      description: 'need-more: one missing fact blocks a concrete proposal. ready: the proposal can be written now.'
    },
    question: {
      description: 'need-more only: the single question to ask. null when status is ready.',
      anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: MAX_CLARIFY_QUESTION }]
    },
    missing: {
      description: 'need-more only: the facts still missing, at most three. null when status is ready.',
      anyOf: [{ type: 'null' }, {
        type: 'array', maxItems: MAX_CLARIFY_MISSING,
        items: { type: 'string', minLength: 1, maxLength: MAX_CLARIFY_MISSING_ITEM }
      }]
    },
    proposal: {
      description: 'ready only: the task proposal. null when status is need-more.',
      anyOf: [{ type: 'null' }, CLARIFY_READY_SCHEMA]
    }
  }
});

function normalizeTurnIndex(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_TURNS) : 0;
}

function atClarifyTurnLimit(payload = {}) {
  // turnIndex is zero-based, so index 5 is the sixth and final allowed turn.
  return normalizeTurnIndex(payload.turnIndex) + 1 >= MAX_TURNS;
}

function normalizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  // 六个来回：两边的消息都要带上，所以是 2 × MAX_TURNS 条。
  return transcript.slice(-MAX_TURNS * 2).map(message => ({
    role: message && message.role === 'assistant' ? 'assistant' : 'user',
    content: trimmedString(message && message.content, '', 2000)
  })).filter(message => message.content);
}

// A remembered fact leaves this machine as one bounded line: kind + subject +
// body, nothing else. Ids, timestamps, confidence and use counts stay local —
// they are bookkeeping for selection, not content the model needs.
function normalizeClarifyMemories(memories) {
  if (!Array.isArray(memories)) return [];
  return memories.slice(0, MAX_CLARIFY_MEMORIES).map(memory => ({
    kind: trimmedString(memory && memory.kind, '', 40),
    subject: trimmedString(memory && memory.subject, '', MAX_CLARIFY_MEMORY_SUBJECT),
    body: trimmedString(memory && memory.body, '', MAX_CLARIFY_MEMORY_BODY)
  })).filter(memory => memory.body);
}

function wholeCount(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

// The digest is counts plus a handful of task titles. Returning null (rather than
// a zeroed object) keeps "memory is off" and "the last week was empty" distinct:
// the first omits the key, the second sends zeros the model can reason about.
function normalizeClarifyActivityDigest(digest) {
  if (!isPlainObject(digest)) return null;
  return {
    days: Math.min(30, Math.max(1, wholeCount(digest.days) || 7)),
    focusMinutes: wholeCount(digest.focusMinutes),
    sessionCount: wholeCount(digest.sessionCount),
    completedTaskCount: wholeCount(digest.completedTaskCount),
    abandonedSessionCount: wholeCount(digest.abandonedSessionCount),
    streakDays: wholeCount(digest.streakDays),
    topTasks: (Array.isArray(digest.topTasks) ? digest.topTasks : [])
      .slice(0, MAX_CLARIFY_TOP_TASKS)
      .map(task => trimmedString(typeof task === 'string' ? task : task && task.title, '', 100))
      .filter(Boolean)
  };
}

function validateClarifyReady(raw) {
  if (!isPlainObject(raw)) throw new TypeError('clarify proposal must be an object');
  exactKeys(raw, ['title', 'steps', 'estimateMinutes', 'energy', 'notes'], 'clarify proposal');
  const title = trimmedString(raw.title, null, MAX_CLARIFY_TITLE);
  if (!title || typeof raw.title !== 'string' || raw.title.trim().length > MAX_CLARIFY_TITLE) {
    throw new RangeError('clarify proposal title is invalid');
  }
  const steps = validateSteps(raw.steps);
  const estimateMinutes = raw.estimateMinutes;
  if (estimateMinutes !== null && (!Number.isInteger(estimateMinutes)
      || estimateMinutes < AI_ENRICH_MIN_ESTIMATE_MINUTES
      || estimateMinutes > AI_ENRICH_MAX_ESTIMATE_MINUTES)) {
    throw new RangeError('clarify proposal estimateMinutes is invalid');
  }
  if (raw.energy !== null && !ENERGY_LEVELS.includes(raw.energy)) {
    throw new TypeError('clarify proposal energy is invalid');
  }
  let notes = null;
  if (raw.notes !== null) {
    notes = trimmedString(raw.notes, null, MAX_CLARIFY_NOTES);
    if (!notes || typeof raw.notes !== 'string' || raw.notes.trim().length > MAX_CLARIFY_NOTES) {
      throw new RangeError('clarify proposal notes is invalid');
    }
  }
  return Object.freeze({ title, steps, estimateMinutes, energy: raw.energy, notes });
}

function validateClarifyResult(raw) {
  const result = parseRawProposal(raw);
  if (!isPlainObject(result)) throw new TypeError('clarify result must be an object');
  if (result.status === 'need-more') {
    exactKeys(result, ['status', 'question', 'missing'], 'clarify need-more result');
    const question = trimmedString(result.question, null, MAX_CLARIFY_QUESTION);
    if (!question || typeof result.question !== 'string' || result.question.trim().length > MAX_CLARIFY_QUESTION) {
      throw new RangeError('clarify question is invalid');
    }
    if ((question.match(/[?？]/g) || []).length > 1) {
      throw new TypeError('clarify question must ask exactly one question');
    }
    if (!Array.isArray(result.missing) || result.missing.length > MAX_CLARIFY_MISSING) {
      throw new RangeError(`clarify missing must contain at most ${MAX_CLARIFY_MISSING} entries`);
    }
    const missing = result.missing.map((item, index) => {
      const normalized = trimmedString(item, null, MAX_CLARIFY_MISSING_ITEM);
      if (!normalized || typeof item !== 'string' || item.trim().length > MAX_CLARIFY_MISSING_ITEM) {
        throw new RangeError(`clarify missing[${index}] is invalid`);
      }
      return normalized;
    });
    return Object.freeze({ status: 'need-more', question, missing: Object.freeze(missing) });
  }
  if (result.status === 'ready') {
    exactKeys(result, ['status', 'proposal'], 'clarify ready result');
    return Object.freeze({ status: 'ready', proposal: validateClarifyReady(result.proposal) });
  }
  throw new TypeError('clarify status must be need-more or ready');
}

const CLARIFY_TASK = Object.freeze({
  name: 'clarify',
  schemaName: 'focuspix_clarify',
  instruction: CLARIFY_INSTRUCTION,
  fields: CLARIFY_FIELDS,
  buildSchema: () => CLARIFY_JSON_SCHEMA,
  buildInput: payload => {
    const input = {
      transcript: normalizeTranscript(payload.transcript),
      turnIndex: normalizeTurnIndex(payload.turnIndex),
      maxTurns: MAX_TURNS
    };
    // Absent, not empty: with memory off the payload must not carry a memory key
    // at all, so nobody can read an empty array as "we looked and found nothing".
    const memories = normalizeClarifyMemories(payload.memories);
    if (memories.length) input.memories = memories;
    const activityDigest = normalizeClarifyActivityDigest(payload.activityDigest);
    if (activityDigest) input.activityDigest = activityDigest;
    return input;
  },
  repair(raw) {
    const result = parseJsonObject(raw, MAX_SERIALIZED_BYTES);
    if (!isPlainObject(result)) return result;
    if (result.status === 'need-more') {
      const repaired = dropUnknownKeys(result, ['status', 'question', 'missing']);
      return repaired.missing === null ? { ...repaired, missing: [] } : repaired;
    }
    if (result.status === 'ready') {
      const repaired = dropUnknownKeys(result, ['status', 'proposal']);
      const proposal = dropUnknownKeys(repaired.proposal, ['title', 'steps', 'estimateMinutes', 'energy', 'notes']);
      if (!isPlainObject(proposal)) return { ...repaired, proposal };
      return {
        ...repaired,
        proposal: {
          ...proposal,
          steps: repairProposalSteps(proposal.steps),
          estimateMinutes: proposal.estimateMinutes === null ? null : coerceInteger(proposal.estimateMinutes),
          energy: proposal.energy === null ? null : coerceEnum(proposal.energy, ENERGY_LEVELS),
          notes: proposal.notes === undefined ? null : proposal.notes
        }
      };
    }
    return result;
  },
  validate(proposal, payload = {}) {
    const validated = validateClarifyResult(proposal);
    if (validated.status === 'need-more' && atClarifyTurnLimit(payload)) {
      throw new RangeError('clarify must return ready at the turn limit');
    }
    return validated;
  }
});

// The honest per-request disclosure: exactly the keys buildInput produced, in
// the order it produced them. Derived from buildInput rather than kept beside it,
// so the two cannot drift when a field becomes conditional.
function describeClarifyFields(payload = {}) {
  return Object.freeze(Object.keys(CLARIFY_TASK.buildInput(payload)));
}

module.exports = {
  MAX_TURNS,
  MAX_CLARIFY_QUESTION,
  MAX_CLARIFY_MISSING,
  MAX_CLARIFY_MEMORIES,
  MAX_CLARIFY_MEMORY_BODY,
  CLARIFY_INSTRUCTION,
  CLARIFY_FIELDS,
  CLARIFY_MEMORY_FIELDS,
  CLARIFY_DIGEST_FIELDS,
  normalizeTurnIndex,
  atClarifyTurnLimit,
  normalizeClarifyMemories,
  normalizeClarifyActivityDigest,
  describeClarifyFields,
  validateClarifyResult,
  CLARIFY_TASK
};
