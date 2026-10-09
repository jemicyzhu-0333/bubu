'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildEnergyCurve } = require('../src/core/energy-curve');
const { localDayStart } = require('../src/core/calendar');

test('follow-up O: an unrelated future-day anchor cannot promote unchanged historical samples', () => {
  const input = { dayKey: '2026-02-17', now: localDayStart('2026-02-20') };
  const without = buildEnergyCurve(input);
  const unrelated = buildEnergyCurve({ ...input, checkIns: [{ at: localDayStart('2026-02-19'), level: 80 }] });
  assert.equal(JSON.stringify(unrelated.samples), JSON.stringify(without.samples));
  assert.equal(unrelated.confidence, without.confidence);
  assert.equal(unrelated.confidence, 'low');
});

function verifyBaseline(kind, dayKey) {
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { buildEnergyCurve } = require('./src/core/energy-curve');
  const { localDayKey } = require('./src/core/calendar');
  const fixture = require('./test/fixtures/energy-history-confidence-baseline.json');
  const values = require('./test/fixtures/energy-history-confidence-values.json');
  const { assertEnergyBaseline } = require('./test/helpers/assert-energy-baseline');
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const rows = fixture.zones[process.env.TZ].filter(row => row.kind === kind && row.input.dayKey === dayKey);
  assert.equal(rows.length, kind === 'historical' ? 4 : 3);
  let largest = { maxAbsoluteDeviation: 0, path: 'none (identical)', budgetAtPath: 0 };
  let largestScaled = { maxScaledEpsilons: 0, scaledPath: 'none (identical)' };
  for (const row of rows) {
    const curve = buildEnergyCurve(row.input), { confidence, ...rest } = curve;
    const hash = kind === 'historical' ? row.nonConfidenceSha256 : row.curveSha256;
    const stored = values.curves[hash];
    assert.ok(stored, row.label + ': authenticated baseline exists');
    const expected = { ...stored, samples: values.samples[stored.samples] };
    // Authenticate expanded numbers against the ORIGINAL pre-fix golden hashes.
    // Never bless live platform output by replacing those hashes. Math.exp/sin/
    // cos may differ in the last bits; only derived energy fields get a bounded
    // roundoff allowance. Dates, counts, identities and categories stay exact.
    assert.equal(digest(expected), hash, row.label + ': expanded baseline integrity');
    const report = assertEnergyBaseline(kind === 'historical' ? rest : curve, expected, row.label);
    if (report.maxAbsoluteDeviation > largest.maxAbsoluteDeviation) largest = report;
    if (report.maxScaledEpsilons > largestScaled.maxScaledEpsilons) largestScaled = report;
    if (kind === 'historical') {
      // These hashes were captured before the fix on 605e695. Only confidence
      // may change; fixed-96 sampling on DST days is deliberately not certified.
      assert.equal(digest(expected.samples), row.samplesSha256, row.label + ': expanded samples integrity');
      assert.equal(localDayKey(row.input.checkIns[0].at) === dayKey, ['day-first-ms', 'day-last-ms'].includes(row.label));
    }
    assert.equal(confidence, row.expectedConfidence, process.env.TZ + '/' + dayKey + '/' + row.label);
  }
  console.log(`${process.env.TZ}/${dayKey}/${kind}: max numeric deviation ${largest.maxAbsoluteDeviation} at ${largest.path}; budget ${largest.budgetAtPath}; max scaled epsilons ${largestScaled.maxScaledEpsilons}/64 at ${largestScaled.scaledPath}`);
}

for (const timeZone of ['UTC', 'America/New_York']) {
  for (const dayKey of ['2026-02-17', '2026-03-08', '2026-11-01']) {
    for (const kind of ['historical', 'today']) {
      test(`follow-up O ${kind}: ${timeZone} ${dayKey} preserves baseline semantics and numeric precision`, () => {
        const output = execFileSync(process.execPath, ['-e', `(${verifyBaseline})(${JSON.stringify(kind)}, ${JSON.stringify(dayKey)})`], {
          cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: timeZone }, stdio: 'pipe', encoding: 'utf8'
        });
        console.log(output.trim());
      });
    }
  }
}
