'use strict';

const { PET_MEAL_TASK } = require('./pet-meal-task');
const { COLLABORATION_TASK } = require('./collaboration-task');
const {
  BREAKDOWN_INSTRUCTION,
  BREAKDOWN_FIELDS,
  OUTBOUND_BLOCKERS,
  normalizeOutboundBlocker,
  BREAKDOWN_TASK
} = require('./breakdown-task');
const { ENRICH_INSTRUCTION, ENRICH_FIELDS, ENRICH_TASK } = require('./enrich-task');
const {
  MAX_UNSTICK_ACTION,
  MAX_UNSTICK_WHY,
  MAX_UNSTICK_SPLIT_STEPS,
  UNSTICK_INSTRUCTION,
  UNSTICK_FIELDS,
  validateUnstickResult,
  UNSTICK_TASK
} = require('./unstick-task');
const {
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
} = require('./clarify-task');
const {
  MAX_IMPULSE_ENERGY_REASON,
  IMPULSE_ENERGY_INSTRUCTION,
  IMPULSE_ENERGY_FIELDS,
  validateImpulseEnergyResult,
  IMPULSE_ENERGY_TASK
} = require('./impulse-energy-task');
const {
  CAPTURE_TRIAGE_TASK,
  CAPTURE_TRIAGE_CATEGORIES,
  CAPTURE_TRIAGE_LEVELS,
  CAPTURE_TRIAGE_FIELDS,
  validateCaptureTriageResult
} = require('./capture-triage-task');
const {
  MAX_IMPULSE_ENERGY_TEXT,
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT
} = require('./task-contract-shared');

// Closed task registry. Each owner keeps prompt, disclosure, input, repair and validation together.
const TASKS = Object.freeze({
  'pet-meal': PET_MEAL_TASK,
  collaborate: COLLABORATION_TASK,
  breakdown: BREAKDOWN_TASK,
  enrich: ENRICH_TASK,
  unstick: UNSTICK_TASK,
  clarify: CLARIFY_TASK,
  'impulse-energy': IMPULSE_ENERGY_TASK,
  'capture-triage': CAPTURE_TRIAGE_TASK
});

module.exports = {
  MAX_TURNS,
  MAX_UNSTICK_ACTION,
  MAX_UNSTICK_WHY,
  MAX_UNSTICK_SPLIT_STEPS,
  MAX_CLARIFY_QUESTION,
  MAX_CLARIFY_MISSING,
  MAX_CLARIFY_MEMORIES,
  MAX_CLARIFY_MEMORY_BODY,
  MAX_IMPULSE_ENERGY_TEXT,
  MAX_IMPULSE_ENERGY_REASON,
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  BREAKDOWN_INSTRUCTION,
  ENRICH_INSTRUCTION,
  UNSTICK_INSTRUCTION,
  CLARIFY_INSTRUCTION,
  IMPULSE_ENERGY_INSTRUCTION,
  BREAKDOWN_FIELDS,
  ENRICH_FIELDS,
  UNSTICK_FIELDS,
  CLARIFY_FIELDS,
  CLARIFY_MEMORY_FIELDS,
  IMPULSE_ENERGY_FIELDS,
  CLARIFY_DIGEST_FIELDS,
  OUTBOUND_BLOCKERS,
  normalizeOutboundBlocker,
  normalizeTurnIndex,
  atClarifyTurnLimit,
  normalizeClarifyMemories,
  normalizeClarifyActivityDigest,
  describeClarifyFields,
  validateUnstickResult,
  validateClarifyResult,
  validateImpulseEnergyResult,
  BREAKDOWN_TASK,
  ENRICH_TASK,
  UNSTICK_TASK,
  CLARIFY_TASK,
  IMPULSE_ENERGY_TASK,
  CAPTURE_TRIAGE_TASK,
  CAPTURE_TRIAGE_CATEGORIES,
  CAPTURE_TRIAGE_LEVELS,
  CAPTURE_TRIAGE_FIELDS,
  validateCaptureTriageResult,
  TASKS
};
