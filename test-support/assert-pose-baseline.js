'use strict';

const assert = require('node:assert/strict');

// A pose contains composed IEEE-754 matrix products and transcendental outputs.
// Permit at most 128 scaled machine epsilons (2.85e-14 at unit scale), not an
// art-unit/pixel tolerance. Even a 100-unit coordinate has a <3e-12 budget.
// Record identity, sample progress, keys, arrays and prop IDs are exact outside
// this numeric-payload comparator. No production value is rounded or changed.
const ROUND_OFF_ULPS = 128;
function comparePoseValues(actual, expected, label, report = { maxAbsolute: 0, maxScaledEpsilons: 0, path: null }) {
  function visit(a, b, path) {
    if (typeof b === 'number') {
      assert.ok(typeof a === 'number' && Number.isFinite(a) && Number.isFinite(b), `${path}: finite number required`);
      const absolute = Math.abs(a - b);
      const scaledEpsilons = absolute / (Number.EPSILON * Math.max(1, Math.abs(b)));
      if (absolute > report.maxAbsolute) { report.maxAbsolute = absolute; report.path = path; }
      report.maxScaledEpsilons = Math.max(report.maxScaledEpsilons, scaledEpsilons);
      assert.ok(scaledEpsilons <= ROUND_OFF_ULPS,
        `${path}: ${a} vs ${b}; abs=${absolute}, scaled epsilons=${scaledEpsilons}, limit=${ROUND_OFF_ULPS}`);
    } else if (b && typeof b === 'object') {
      assert.ok(a && typeof a === 'object', `${path}: object required`);
      assert.equal(Array.isArray(a), Array.isArray(b), `${path}: array/object kind changed`);
      assert.deepEqual(Object.keys(a), Object.keys(b), `${path}: keys/order/length changed`);
      for (const key of Object.keys(b)) visit(a[key], b[key], `${path}.${key}`);
    } else assert.equal(a, b, `${path}: nonnumeric value changed`);
  }
  visit(actual, expected, label);
  return report;
}

module.exports = { comparePoseValues, ROUND_OFF_ULPS };
