'use strict';

const { MAX_SERIALIZED_BYTES } = require('../breakdown-proposal');
const { isPlainObject } = require('../field-normalizers');
const { exactKeys, parseRawProposal } = require('./validate-steps');
const { parseJsonObject, dropUnknownKeys, coerceInteger, coerceEnum } = require('./repair');
const {
  MAX_IMPULSE_ENERGY_TEXT,
  FIELD_SEMANTICS_NOTE,
  truncatedString
} = require('./task-contract-shared');

// 随手记分拣（ARCHITECTURE「AI 与 LLM」）：一句话属于哪一类、该去哪儿。模型只给建议，
// 任何会改数据的去向都要本人确认一次；情绪类不影响能量。state 类给一个五档自评档位，
// 确认后走和手动自评同一条路。
const CAPTURE_TRIAGE_CATEGORIES = Object.freeze(['task', 'routine', 'log', 'state', 'feeling', 'note']);

const CAPTURE_TRIAGE_ROUTINE_KINDS = Object.freeze([
  'medication', 'stimulant', 'meal', 'snack', 'movement', 'rest', 'meeting', 'custom'
]);

const CAPTURE_TRIAGE_LEVELS = Object.freeze([20, 35, 50, 65, 80]);

const MAX_CAPTURE_TRIAGE_TITLE = 80;

const MAX_CAPTURE_TRIAGE_REASON = 60;

const CAPTURE_TRIAGE_FIELDS = Object.freeze(['impulseText']);

const CAPTURE_TRIAGE_INSTRUCTION = [
  'Sort one private quick-capture note, written in a hurry by the person themselves, into exactly one category.',
  'task: something the person intends or needs to do once (including reminders to themselves). routine: something they want to do repeatedly on a schedule. log: a life event that just happened or is happening now (ate, drank coffee, took a walk, napped, a meeting). state: a first-person report of their current energy or ability to engage (tired, wired, clear-headed). feeling: an emotion, frustration or venting that is not mainly about energy and asks for no action. note: an idea, thought or reference to keep.',
  'Do not prefer task merely because a verb appears. Require a clear future action intent. A life event is log only when explicitly done or happening, never merely planned. Repeated habits are routine, feelings without action are feeling. Use note with confidence below 60 when unsure.',
  'Examples: “我吃完晚饭了” is log/meal; “我去吃晚饭啦” is task (intended, not done); “每天晚上散步” is routine/movement; “睡觉睡觉” is ambiguous, use note with confidence below 60; “应该睡觉但是不困” is note, not a completed rest or a numeric energy report; “今天好委屈” is feeling. Never infer completion or energy level from the presence of a sleep or meal keyword.',
  'title: for task and routine only, a short imperative title in the note\'s own language, at most 80 characters, keeping the person\'s wording where possible; otherwise null.',
  'routineKind: for routine and log only, the closest kind (medication, stimulant for caffeine and similar, meal, snack, movement, rest, meeting, custom); otherwise null.',
  'level: for state only, the closest of 20 (very low), 35 (low), 50 (okay), 65 (good), 80 (very good); otherwise null.',
  'confidence is 0 to 100 and measures only how clearly the note supports the category. The reason is a short generic explanation that never quotes private details.',
  FIELD_SEMANTICS_NOTE
].join('\n');

const CAPTURE_TRIAGE_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'title', 'routineKind', 'level', 'reason'],
  properties: {
    category: { type: 'string', enum: [...CAPTURE_TRIAGE_CATEGORIES] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    title: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: MAX_CAPTURE_TRIAGE_TITLE }] },
    routineKind: { anyOf: [{ type: 'null' }, { type: 'string', enum: [...CAPTURE_TRIAGE_ROUTINE_KINDS] }] },
    level: { anyOf: [{ type: 'null' }, { type: 'integer', enum: [...CAPTURE_TRIAGE_LEVELS] }] },
    reason: { type: 'string', minLength: 1, maxLength: MAX_CAPTURE_TRIAGE_REASON }
  }
});

function validateCaptureTriageResult(raw) {
  const result = parseRawProposal(raw);
  if (!isPlainObject(result)) throw new TypeError('capture triage result must be an object');
  exactKeys(result, ['category', 'confidence', 'title', 'routineKind', 'level', 'reason'], 'capture triage result');
  if (!CAPTURE_TRIAGE_CATEGORIES.includes(result.category)) throw new TypeError('capture triage category is invalid');
  if (!Number.isInteger(result.confidence) || result.confidence < 0 || result.confidence > 100) {
    throw new RangeError('capture triage confidence is invalid');
  }
  const wantsTitle = result.category === 'task' || result.category === 'routine';
  const title = typeof result.title === 'string' ? result.title.trim() : null;
  if (wantsTitle && (!title || title.length > MAX_CAPTURE_TRIAGE_TITLE)) throw new TypeError('capture triage title is required');
  const wantsKind = result.category === 'routine' || result.category === 'log';
  if (wantsKind && !CAPTURE_TRIAGE_ROUTINE_KINDS.includes(result.routineKind)) {
    throw new TypeError('capture triage routineKind is required');
  }
  if (result.category === 'state' && !CAPTURE_TRIAGE_LEVELS.includes(result.level)) {
    throw new TypeError('capture triage level is required');
  }
  const reason = typeof result.reason === 'string' ? result.reason.trim() : '';
  if (!reason || reason.length > MAX_CAPTURE_TRIAGE_REASON) throw new TypeError('capture triage reason is invalid');
  // 不属于这一类的字段一律归零，而不是报错：模型多填了不该填的，按类别裁掉就是。
  return Object.freeze({
    category: result.category,
    confidence: result.confidence,
    title: wantsTitle ? title : null,
    routineKind: wantsKind ? result.routineKind : null,
    level: result.category === 'state' ? result.level : null,
    reason
  });
}

const CAPTURE_TRIAGE_TASK = Object.freeze({
  name: 'capture-triage',
  schemaName: 'focuspix_capture_triage',
  instruction: CAPTURE_TRIAGE_INSTRUCTION,
  fields: CAPTURE_TRIAGE_FIELDS,
  buildSchema: () => CAPTURE_TRIAGE_JSON_SCHEMA,
  buildInput: payload => ({
    impulseText: truncatedString(payload && payload.impulseText, 'impulseText', MAX_IMPULSE_ENERGY_TEXT, { required: true })
  }),
  repair(raw) {
    const result = dropUnknownKeys(parseJsonObject(raw, MAX_SERIALIZED_BYTES), [
      'category', 'confidence', 'title', 'routineKind', 'level', 'reason'
    ]);
    if (!isPlainObject(result)) return result;
    const level = coerceInteger(result.level);
    return {
      ...result,
      category: coerceEnum(result.category, [...CAPTURE_TRIAGE_CATEGORIES]),
      confidence: coerceInteger(result.confidence),
      routineKind: result.routineKind === null ? null : coerceEnum(result.routineKind, [...CAPTURE_TRIAGE_ROUTINE_KINDS]),
      level: result.level === null ? null : level,
      title: result.title === undefined ? null : result.title
    };
  },
  validate: validateCaptureTriageResult
});

module.exports = {
  CAPTURE_TRIAGE_TASK,
  CAPTURE_TRIAGE_CATEGORIES,
  CAPTURE_TRIAGE_LEVELS,
  CAPTURE_TRIAGE_FIELDS,
  validateCaptureTriageResult
};
