'use strict';

// ARCHITECTURE「AI 与 LLM」: a model may suggest a chosen time band, never
// assert an energy measurement or grant itself permission to persist anything.
const { closed, id, jsonValue } = require('./ai-change-protocol');
const FIELDS = Object.freeze(['id', 'startMinute', 'endMinute', 'demand', 'scope']);
const DEMANDS = Object.freeze(['low', 'medium', 'high']);
const SCOPES = Object.freeze(['today', '7days', 'saved']);
const minute = (value, min, max) => Number.isSafeInteger(value) && !Object.is(value, -0)
  && value >= min && value <= max;

function validatePlanningPreferenceCandidate(input) {
  if (!jsonValue(input) || !closed(input, FIELDS) || Object.keys(input).length !== FIELDS.length
    || (input.id !== null && !id(input.id)) || !minute(input.startMinute, 0, 1439)
    || !minute(input.endMinute, 1, 1440) || input.endMinute <= input.startMinute
    || !DEMANDS.includes(input.demand) || !SCOPES.includes(input.scope)) {
    throw new TypeError('collaboration-planning-preference-candidate-invalid');
  }
  return { id: input.id, startMinute: input.startMinute, endMinute: input.endMinute,
    demand: input.demand, scope: input.scope };
}

const object = properties => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
const planningPreferenceCandidateSchema = Object.freeze(object({ planningPreference: object({
  id: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 200,
    pattern: '^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$' }] },
  startMinute: { type: 'integer', minimum: 0, maximum: 1439 },
  endMinute: { type: 'integer', minimum: 1, maximum: 1440,
    description: 'Must be strictly greater than startMinute; the band does not cross midnight.' },
  demand: { type: 'string', enum: DEMANDS }, scope: { type: 'string', enum: SCOPES }
}) }));

module.exports = { validatePlanningPreferenceCandidate, planningPreferenceCandidateSchema };
