'use strict';
const assert = require('node:assert/strict');

// Only derived energy magnitudes may vary across Math implementations. The
// 64-epsilon scale budget is about 1.3e-12 at the model's 90-point ceiling;
// minutes, array lengths, object keys and categorical values remain exact.
const ENERGY_FIELDS = new Set([
  'level', 'modelLevel', 'slope', 'baseline', 'clampedBy', 'delta',
  'nowLevel', 'nowModelLevel', 'peak'
]);

function assertEnergyBaseline(actual, expected, label = 'curve') {
  const report = { maxAbsoluteDeviation: 0, path: label, budgetAtPath: 0, maxScaledEpsilons: 0, scaledPath: label };
  function visit(a, e, path, key) {
    if (typeof e === 'number' && ENERGY_FIELDS.has(key)) {
      assert.equal(typeof a, 'number', path + ': numeric type');
      assert.ok(Number.isFinite(a) && Number.isFinite(e), path + ': finite energy');
      const deviation = Math.abs(a - e);
      const scale = Number.EPSILON * Math.max(1, Math.abs(e));
      const budget = 64 * scale;
      if (deviation / scale > report.maxScaledEpsilons) {
        report.maxScaledEpsilons = deviation / scale;
        report.scaledPath = path;
      }
      if (deviation > report.maxAbsoluteDeviation) {
        report.maxAbsoluteDeviation = deviation;
        report.path = path;
        report.budgetAtPath = budget;
      }
      assert.ok(deviation <= budget,
        `${path}: ${a} differs from ${e} by ${deviation}, budget ${budget}`);
    } else if (Array.isArray(e)) {
      assert.ok(Array.isArray(a), path + ': array type');
      assert.equal(a.length, e.length, path + ': array length');
      e.forEach((value, index) => visit(a[index], value, `${path}[${index}]`, String(index)));
    } else if (e !== null && typeof e === 'object') {
      assert.ok(a !== null && typeof a === 'object' && !Array.isArray(a), path + ': object type');
      assert.deepEqual(Object.keys(a), Object.keys(e), path + ': exact keys');
      for (const field of Object.keys(e)) visit(a[field], e[field], `${path}.${field}`, field);
    } else {
      assert.equal(a, e, path);
    }
  }
  visit(actual, expected, label, '');
  return report;
}

module.exports = { assertEnergyBaseline };
