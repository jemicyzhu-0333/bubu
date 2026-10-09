'use strict';

// ARCHITECTURE「AI 与 LLM」: only bounded, locally recognized validator text
// may leave generation. A provider error's stage/message are not provenance.
// Only generation and local collaboration validation mint these details;
// omit model text, values and getters.
const details = new WeakMap();
const TASKS = new Set(['breakdown', 'enrich', 'collaborate']);
const MESSAGES = new Set([
  'proposal is not valid JSON', 'proposal exceeds 8 KB',
  'proposal must be an object', 'proposal contains unknown or missing fields',
  'enrich proposal must be an object', 'enrich proposal contains unknown or missing fields',
  'proposal must contain 3–7 steps', 'the final step must be a safe stop',
  'clarifyingQuestion is invalid', 'completionCriteria is invalid',
  'energy is invalid', 'estimateMinutes is invalid',
  'tags must contain at most 3 entries', 'tags may only reuse existing tags'
]);
const STEP_MESSAGE = /^steps\[[0-6]\](?: must be an object| contains unknown or missing fields|\.title is invalid|\.dependsOn must reference an earlier step|\.safeStopAfter must be boolean)$/;
const COLLABORATION_MESSAGES = new Set([
  'collaboration-envelope-invalid', 'collaboration-envelope-branch-invalid',
  'collaboration-json-invalid', 'collaboration-output-budget', 'collaboration-answer-invalid',
  'collaboration-draft-invalid', 'collaboration-draft-title-invalid', 'collaboration-draft-steps-invalid',
  'collaboration-draft-estimate-invalid', 'collaboration-draft-energy-invalid', 'collaboration-draft-notes-invalid',
  'collaboration-step-invalid', 'collaboration-step-title-invalid', 'collaboration-step-dependency-invalid',
  'collaboration-step-stop-invalid', 'collaboration-step-final-stop-required',
  'collaboration-read-invalid', 'collaboration-read-name-invalid', 'collaboration-read-args-invalid',
  'collaboration-read-id-invalid', 'collaboration-read-query-invalid', 'collaboration-read-limit-invalid',
  'collaboration-read-cursor-invalid', 'collaboration-read-fields-invalid', 'collaboration-read-kinds-invalid',
  'collaboration-read-range-invalid', 'collaboration-change-proposal-invalid',
  'collaboration-change-operations-invalid', 'collaboration-planning-preference-candidate-invalid'
]);
const COLLABORATION_FIELDS = /^collaboration (?:envelope|draft|step|read|read-args|change-proposal) contains unknown or missing fields$/;
const MAX_DETAIL_CHARS = 200;

function rememberProposalValidationDetail(error, task) {
  if (!TASKS.has(task) || !error || typeof error !== 'object') return;
  let message;
  try { message = Object.getOwnPropertyDescriptor(error, 'message')?.value; }
  catch (_) { return; }
  if (typeof message !== 'string' || message.length > MAX_DETAIL_CHARS) return;
  const recognized = task === 'collaborate'
    ? COLLABORATION_MESSAGES.has(message) || COLLABORATION_FIELDS.test(message)
    : MESSAGES.has(message) || STEP_MESSAGE.test(message);
  if (!recognized) return;
  details.set(error, message);
}

function proposalValidationDetail(error) {
  return error && typeof error === 'object' ? details.get(error) || null : null;
}

module.exports = { rememberProposalValidationDetail, proposalValidationDetail };
