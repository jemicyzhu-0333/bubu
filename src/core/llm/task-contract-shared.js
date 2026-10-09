'use strict';

const { dropUnknownKeys, repairStepDependencies } = require('./repair');

const MAX_IMPULSE_ENERGY_TEXT = 500;

// 提示词里描述的是**行为**（难启动、常被打断），不是诊断：使用者是否有某种状况是他自己的事，
// 模型不需要知道，也不该被告知。test/llm-tasks.test.js 断言任何发出去的提示词都不含诊断名称。
const START_FRICTION_CONTEXT = [
  'The person using this app finds it hard to get started and is often interrupted. Their bottleneck is starting, not understanding.',
  'Optimise every step for activation cost, not for completeness:',
  '- Step 1 must be startable in under two minutes with no decision left inside it. Name the concrete file, app, page, document or person. "Open X" beats "prepare for X".',
  '- Prefer physical or on-screen actions over mental ones. Never let think about, consider, research, plan, review, organise, understand or familiarise yourself with be the whole action.',
  '- Every step must be finishable in one sitting of roughly 5 to 30 minutes and be safe to abandon afterwards, because interruption is expected rather than exceptional.',
  '- When the blocker is perfectionism, lower the bar out loud: a rough, ugly or incomplete first pass is allowed and should be stated as allowed.',
  '- Do not add steps for planning the plan, building a system, tidying the workspace first, or getting motivated.',
  'Never speculate about why the task is hard for the user or explain their situation back to them, and never coach, praise, encourage or moralise. No exclamation marks. Describe the work and nothing else.',
  'Write in the same language as the task title.'
].join('\n');

const SCENARIO_CONTEXT = [
  'Split the work as it exists in this specific situation, not as a generic template for its verb.',
  'Read the description and clarification for the real artefacts, tools, people and constraints, and name them in the steps.',
  'If the situation is thin, stay small and literal instead of inventing project structure, stakeholders or deliverables that were never mentioned.'
].join('\n');

const FIELD_SEMANTICS_NOTE = 'Every field is described in the schema you were given. Follow those descriptions exactly, including how indexes are counted.';

function truncatedString(value, label, max, { required = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim().slice(0, max);
  if (required && !normalized) throw new TypeError(`${label} must be a non-empty string`);
  return normalized;
}

function repairProposalSteps(steps) {
  return repairStepDependencies(Array.isArray(steps)
    ? steps.map(step => dropUnknownKeys(step, ['title', 'dependsOn', 'safeStopAfter']))
    : steps);
}

module.exports = {
  MAX_IMPULSE_ENERGY_TEXT,
  START_FRICTION_CONTEXT,
  SCENARIO_CONTEXT,
  FIELD_SEMANTICS_NOTE,
  truncatedString,
  repairProposalSteps
};
