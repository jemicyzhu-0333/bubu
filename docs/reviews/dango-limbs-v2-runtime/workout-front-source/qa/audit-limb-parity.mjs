import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { root, out } from './qa-paths.mjs';

const variant = process.argv.find(v => v.startsWith('--variant='))?.slice(10);
const times = [2125, 2656.25, 1500, 6400];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (variant) {
  const { sources, fixture, createRenderHarness, directorModule } = await import('./production-fixture.mjs');
  assert.equal(fixture.artistConfiguration.genericLimbsEnabled, variant !== 'unloaded');
  const result = { variant, configuration: fixture.artistConfiguration, frames: [], cacheStats: {} };
  for (const mode of variant === 'failed' ? ['failedLeft', 'failedRight'] : ['actual', 'legacy']) {
    const h = createRenderHarness(sources[mode], { skin: 'pink', outfit: false, dpr: 2,
      facing: -1, blink: false, director: { module: directorModule, source: 'interaction' } });
    h.select('action', 'workout');
    for (const now of times) {
      fixture.traces[mode].length = 0;
      h.draw(now);
      const art = fixture.traces[mode].at(-1);
      assert.equal(art.sourceContactPose === 'workout-front-support-v4', mode === 'actual');
      const raw = h.body.getContext('2d').getImageData(0, 0, h.body.width, h.body.height).data;
      const filename = `${mode}-${now}.png`;
      fs.writeFileSync(path.join(out, filename), h.body.toBuffer('image/png'));
      result.frames.push({ mode, now, sourceSelected: mode === 'actual',
        pixelSHA256: digest(raw), stage: [h.body.width, h.body.height], filename });
    }
    result.cacheStats[mode] = fixture.artists[mode].cacheStats();
    if (variant === 'failed') assert.ok(fixture.failureAttempts[mode] > 0 && result.cacheStats[mode].source.failed === 1, 'Each mode must truly fail exactly one source PNG');
    if (variant !== 'unloaded') assert.ok(result.cacheStats[mode].limbs, 'Real generic limb painter must be enabled');
    h.dispose();
  }
  for (const artist of Object.values(fixture.artists)) artist.dispose();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result, null, 2) + '\n');
} else {
  const reports = {};
  const failureOnly = process.argv.includes('--failure-only');
  for (const value of ['unloaded', 'loaded', 'failed']) {
    if (!failureOnly || value === 'failed') {
    const result = spawnSync(process.execPath, ['--max-old-space-size=384', fileURLToPath(import.meta.url),
      '--repo=' + root, '--out=' + path.join(out, value), '--variant=' + value],
      { stdio: 'inherit', env: { ...process.env, WORKOUT_QA_LIMBS: value !== 'unloaded' ? '1' : '0', WORKOUT_QA_FAILURES: value === 'failed' ? '1' : '0' } });
    if (result.error || result.status !== 0) throw new Error('Parity variant failed: ' + value);
    }
    reports[value] = JSON.parse(fs.readFileSync(path.join(out, value, 'report.json'), 'utf8'));
  }
  const comparisons = reports.unloaded.frames.map((frame, index) => {
    const other = reports.loaded.frames[index];
    assert.equal(frame.mode, other.mode); assert.equal(frame.now, other.now);
    assert.equal(frame.pixelSHA256, other.pixelSHA256, `Loaded generic limbs changed ${frame.mode} at ${frame.now}`);
    return { mode: frame.mode, now: frame.now, pixelSHA256: frame.pixelSHA256, identical: true };
  });
  const failedComparisons = reports.failed.frames.map(frame => {
    const baseline = reports.loaded.frames.find(other => other.mode === 'legacy' && other.now === frame.now);
    assert.equal(frame.pixelSHA256, baseline.pixelSHA256, `Real-limb failed source differs from real-limb disabled baseline: ${frame.mode} ${frame.now}`);
    return { mode: frame.mode, now: frame.now, pixelSHA256: frame.pixelSHA256, baseline: 'loaded generic limbs; source-disabled legacy', identical: true };
  });
  const report = { scope: 'DPR2 facing -1. Two source extrema plus matrix frames 90/384. Both integrated source and source-disabled legacy fallback compared byte-for-byte, with and without real generic limbs and production walk adapter.',
    comparisons, failedComparisons, variants: reports, failures: 0 };
  fs.writeFileSync(path.join(out, 'parity.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ comparisons: comparisons.length, failedComparisons: failedComparisons.length, failures: 0 }));
}
