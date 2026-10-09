'use strict';

const { MAX_SERIALIZED_BYTES } = require('../breakdown-proposal');
const { isPlainObject, trimmedString } = require('../field-normalizers');
const { exactKeys, parseRawProposal } = require('./validate-steps');
const { parseJsonObject, dropUnknownKeys, coerceInteger, coerceEnum } = require('./repair');
const {
  MAX_IMPULSE_ENERGY_TEXT,
  FIELD_SEMANTICS_NOTE,
  truncatedString
} = require('./task-contract-shared');

const MAX_IMPULSE_ENERGY_REASON = 120;

const IMPULSE_ENERGY_FIELDS = Object.freeze(['impulseText']);

const IMPULSE_ENERGY_INSTRUCTION = [
  'Classify whether one private quick-capture note is an explicit first-person report of current or very recent subjective energy or ability to engage.',
  'This is a non-clinical correction to an estimated daily energy curve, not a diagnosis, sentiment score, productivity score or judgment of the person.',
  'Use up only for an explicit present/recent report such as feeling rested, recovered, alert or able to engage. Use down only for an explicit present/recent report such as feeling exhausted, unable to start, depleted or unable to engage.',
  'Plans, future intentions, task ideas, reminders, food or sleep plans, third-person statements, general opinions, and ambiguous wording must be neutral with delta 0.',
  'A past event may count only when the note explicitly connects it to the person\'s state now, for example sleeping at noon and feeling restored now.',
  'Keep non-neutral magnitude conservative: 1 to 12. Confidence measures only whether the note explicitly supports this classification. If confidence is below 70, prefer neutral.',
  'The reason must be a short generic category-level explanation. Never quote or closely paraphrase private details from the note.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const IMPULSE_ENERGY_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['direction', 'delta', 'confidence', 'reason'],
  properties: {
    direction: { type: 'string', enum: ['down', 'neutral', 'up'] },
    delta: { type: 'integer', minimum: -12, maximum: 12 },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    reason: { type: 'string', minLength: 1, maxLength: MAX_IMPULSE_ENERGY_REASON }
  }
});

function validateImpulseEnergyResult(raw) {
  const result = parseRawProposal(raw);
  if (!isPlainObject(result)) throw new TypeError('impulse energy result must be an object');
  exactKeys(result, ['direction', 'delta', 'confidence', 'reason'], 'impulse energy result');
  if (!['down', 'neutral', 'up'].includes(result.direction)) {
    throw new TypeError('impulse energy direction is invalid');
  }
  if (!Number.isInteger(result.delta) || result.delta < -12 || result.delta > 12) {
    throw new RangeError('impulse energy delta is invalid');
  }
  if ((result.direction === 'neutral' && result.delta !== 0)
      || (result.direction === 'up' && result.delta <= 0)
      || (result.direction === 'down' && result.delta >= 0)) {
    throw new TypeError('impulse energy direction and delta disagree');
  }
  if (!Number.isInteger(result.confidence) || result.confidence < 0 || result.confidence > 100) {
    throw new RangeError('impulse energy confidence is invalid');
  }
  const reason = trimmedString(result.reason, null, MAX_IMPULSE_ENERGY_REASON);
  if (!reason || typeof result.reason !== 'string'
      || result.reason.trim().length > MAX_IMPULSE_ENERGY_REASON) {
    throw new RangeError('impulse energy reason is invalid');
  }
  return Object.freeze({
    direction: result.direction,
    delta: result.delta,
    confidence: result.confidence,
    reason
  });
}

const IMPULSE_ENERGY_TASK = Object.freeze({
  name: 'impulse-energy',
  schemaName: 'bubu_impulse_energy',
  instruction: IMPULSE_ENERGY_INSTRUCTION,
  fields: IMPULSE_ENERGY_FIELDS,
  buildSchema: () => IMPULSE_ENERGY_JSON_SCHEMA,
  buildInput: payload => ({
    impulseText: truncatedString(
      payload && payload.impulseText,
      'impulseText',
      MAX_IMPULSE_ENERGY_TEXT,
      { required: true }
    )
  }),
  repair(raw) {
    const result = dropUnknownKeys(parseJsonObject(raw, MAX_SERIALIZED_BYTES), [
      'direction', 'delta', 'confidence', 'reason'
    ]);
    if (!isPlainObject(result)) return result;
    return {
      ...result,
      direction: coerceEnum(result.direction, ['down', 'neutral', 'up']),
      delta: coerceInteger(result.delta),
      confidence: coerceInteger(result.confidence)
    };
  },
  validate: validateImpulseEnergyResult
});

module.exports = {
  MAX_IMPULSE_ENERGY_REASON,
  IMPULSE_ENERGY_INSTRUCTION,
  IMPULSE_ENERGY_FIELDS,
  validateImpulseEnergyResult,
  IMPULSE_ENERGY_TASK
};
