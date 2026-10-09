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
  const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const rows = fixture.zones[process.env.TZ].filter(row => row.kind === kind && row.input.dayKey === dayKey);
  assert.equal(rows.length, kind === 'historical' ? 4 : 3);
  for (const row of rows) {
    const curve = buildEnergyCurve(row.input), { confidence, ...rest } = curve;
    if (kind === 'historical') {
      // These hashes were captured before the fix on 605e695. Only confidence
      // may change; fixed-96 sampling on DST days is deliberately not certified.
      assert.equal(digest(curve.samples), row.samplesSha256, row.label + ': samples changed');
      assert.equal(digest(rest), row.nonConfidenceSha256, row.label + ': non-confidence fields changed');
      assert.equal(localDayKey(row.input.checkIns[0].at) === dayKey, ['day-first-ms', 'day-last-ms'].includes(row.label));
    } else assert.equal(digest(curve), row.curveSha256, row.label + ': today output changed');
    assert.equal(confidence, row.expectedConfidence, process.env.TZ + '/' + dayKey + '/' + row.label);
  }
}

for (const timeZone of ['UTC', 'America/New_York']) {
  for (const dayKey of ['2026-02-17', '2026-03-08', '2026-11-01']) {
    for (const kind of ['historical', 'today']) {
      test(`follow-up O ${kind}: ${timeZone} ${dayKey} preserves baseline bytes`, () => {
        execFileSync(process.execPath, ['-e', `(${verifyBaseline})(${JSON.stringify(kind)}, ${JSON.stringify(dayKey)})`], {
          cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: timeZone }, stdio: 'pipe'
        });
      });
    }
  }
}
