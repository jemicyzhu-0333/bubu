import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FRONT_PHASES, FRONT_DURATION_MS, frontPhaseAt } from './driver.mjs';
import { EXPRESSIONS } from '../../src/content/expressions.mjs';
import { SESSION_ACTIVITIES } from '../../src/content/session-activities.mjs';
const { PET_STATES } = createRequire(import.meta.url)('../../src/capabilities/companion/index.js');

test('front-first preview uses only production states and expressions', () => {
  const expressions = new Set(EXPRESSIONS.map(expression => expression.id));
  for (const phase of FRONT_PHASES) {
    assert.ok(PET_STATES.includes(phase.state), `Unknown production state: ${phase.state}`);
    assert.ok(expressions.has(phase.expression), `Unknown production expression: ${phase.expression}`);
  }
  assert.equal(FRONT_PHASES.find(phase => phase.expression === 'work.focus').state,
    SESSION_ACTIVITIES['focus-read'].state);
});

test('front-first preview has one complete ordered timeline with exact boundaries', () => {
  assert.equal(FRONT_PHASES[0].start, 0);
  assert.equal(FRONT_PHASES.at(-1).end, FRONT_DURATION_MS);
  for (const [index, phase] of FRONT_PHASES.entries()) {
    assert.ok(phase.end > phase.start);
    assert.equal(frontPhaseAt(phase.start), phase);
    assert.equal(frontPhaseAt(phase.end - .001), phase);
    if (index) assert.equal(FRONT_PHASES[index - 1].end, phase.start);
  }
});
