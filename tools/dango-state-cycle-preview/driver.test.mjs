import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CYCLE_PHASES, CYCLE_DURATION_MS, phaseAt } from './driver.mjs';
import { EXPRESSIONS } from '../../src/content/expressions.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
const { PET_STATES } = createRequire(import.meta.url)('../../src/capabilities/companion/index.js');

test('continuous preview uses only production states and expressions', () => {
  const expressions = new Set(EXPRESSIONS.map(expression => expression.id));
  for (const phase of CYCLE_PHASES) {
    assert.ok(PET_STATES.includes(phase.state), `Unknown production state: ${phase.state}`);
    assert.ok(expressions.has(phase.expression), `Unknown production expression: ${phase.expression}`);
  }
  assert.equal(CYCLE_PHASES.find(phase => phase.expression === 'work.focus').state,
    SESSION_ACTIVITIES['focus-read'].state);
});

test('continuous preview has one complete ordered timeline with exact boundaries', () => {
  assert.equal(CYCLE_PHASES[0].start, 0);
  assert.equal(CYCLE_PHASES.at(-1).end, CYCLE_DURATION_MS);
  for (const [index, phase] of CYCLE_PHASES.entries()) {
    assert.ok(phase.end > phase.start);
    assert.equal(phaseAt(phase.start), phase);
    assert.equal(phaseAt(phase.end - .001), phase);
    if (index) assert.equal(CYCLE_PHASES[index - 1].end, phase.start);
  }
});
