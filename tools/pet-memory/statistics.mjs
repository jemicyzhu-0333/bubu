import { BASELINE } from './scenario.mjs';

// Fixed allocation: histogram collection must not itself retain one object per frame.
export function createTimingHistogram({ binMs = 0.1, maxMs = 10_000 } = {}) {
  const bins = new Uint32Array(Math.ceil(maxMs / binMs) + 1);
  let count = 0, sum = 0, maximum = 0;
  function percentile(fraction) {
    if (!count) return null;
    const rank = Math.ceil(count * fraction); let cumulative = 0;
    for (let i = 0; i < bins.length; i++) {
      cumulative += bins[i];
      if (cumulative >= rank) return i === bins.length - 1 ? maximum : Number((i * binMs).toFixed(3));
    }
    return maximum;
  }
  return Object.freeze({
    add(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new TypeError('timing must be finite and nonnegative');
      bins[Math.min(bins.length - 1, Math.ceil(ms / binMs))]++;
      count++; sum += ms; maximum = Math.max(maximum, ms);
    },
    snapshot: () => ({ count, meanMs: count ? sum / count : null, p95Ms: percentile(.95),
      p99Ms: percentile(.99), maxMs: count ? maximum : null, percentileUpperBoundResolutionMs: binMs }),
    reset() { bins.fill(0); count = 0; sum = 0; maximum = 0; }
  });
}

export function memoryTrend(points) {
  if (points.length < 3 || points.some(point => !Number.isFinite(point.minutes)
    || !Number.isFinite(point.bytes) || point.bytes < 0)) return null;
  const n = points.length, x = points.reduce((s, p) => s + p.minutes, 0) / n;
  const y = points.reduce((s, p) => s + p.bytes, 0) / n;
  const xx = points.reduce((s, p) => s + (p.minutes - x) ** 2, 0);
  if (!xx) return null;
  const slope = points.reduce((s, p) => s + (p.minutes - x) * (p.bytes - y), 0) / xx;
  const residual = points.reduce((s, p) => s + (p.bytes - y - slope * (p.minutes - x)) ** 2, 0);
  const total = points.reduce((s, p) => s + (p.bytes - y) ** 2, 0);
  const positiveSteps = points.slice(1).filter((p, i) => p.bytes > points[i].bytes).length;
  const rSquared = total ? 1 - residual / total : 1;
  const deltaBytes = points.at(-1).bytes - points[0].bytes;
  const finalGrowthFraction = points[0].bytes > 0 ? deltaBytes / points[0].bytes : null;
  const allStepsPositive = slope > 0 && positiveSteps === n - 1;
  const positiveSlopeHighRSquared = slope > 0 && total > 0 && rSquared >= BASELINE.linearGrowthRSquared;
  const exceedsFinalGrowthGuard = finalGrowthFraction !== null && finalGrowthFraction > BASELINE.maxFinalGrowthFraction;
  return { samples: n, n, window: { firstMinute: points[0].minutes, lastMinute: points.at(-1).minutes,
    durationMinutes: points.at(-1).minutes - points[0].minutes },
    slopeBytesPerMinute: slope, slopeMiBPerMinute: slope / 1_048_576,
    rSquared, positiveSteps, totalSteps: n - 1,
    firstBytes: points[0].bytes, lastBytes: points.at(-1).bytes,
    deltaBytes, deltaMiB: deltaBytes / 1_048_576,
    finalGrowthFraction, finalGrowthPercent: finalGrowthFraction === null ? null : finalGrowthFraction * 100,
    allStepsPositive, positiveSlopeHighRSquared, exceedsFinalGrowthGuard,
    thresholds: { linearGrowthRSquared: BASELINE.linearGrowthRSquared,
      maxFinalGrowthPercent: BASELINE.maxFinalGrowthFraction * 100 },
    interpretation: 'R² describes OLS fit quality, not confidence or cause; these conservative triggers do not establish a leak.',
    // The same frozen boolean rule; diagnostics do not introduce a noise allowance.
    sustainedGrowth: allStepsPositive || positiveSlopeHighRSquared };
}
