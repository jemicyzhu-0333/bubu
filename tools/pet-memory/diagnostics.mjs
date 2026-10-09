// Reporting only. GATE_VERSION and the measurement acceptance thresholds stay fixed.
export const DIAGNOSTICS_VERSION = 1;

export function classifyExecution(report, { measurementReasons, captureComplete, requireLauncherExit }) {
  if (!requireLauncherExit) return { outcome: 'pending/launcher-verification', reasons: [] };
  const launch = report.launch;
  if (!launch || !['code', 'signal', 'stopReason'].every(key => Object.hasOwn(launch, key))
    || (launch.signal !== null && typeof launch.signal !== 'string')
    || (launch.stopReason !== null && typeof launch.stopReason !== 'string')) {
    return { outcome: 'execution-unverified/missing-launch-evidence', reasons: ['Verified launcher exit evidence is missing or incomplete.'] };
  }
  if (launch.signal !== null || launch.stopReason !== null
    || (Number.isInteger(launch.code) && ![0, 2].includes(launch.code))) {
    return { outcome: 'execution-failed/abnormal-exit', reasons: [
      `Abnormal execution exit: code=${launch.code}, signal=${launch.signal}, stopReason=${launch.stopReason}.`
    ] };
  }
  if (!Number.isInteger(launch.code)) return { outcome: 'execution-unverified/missing-launch-evidence', reasons: ['A numeric launcher exit code is missing.'] };
  if (!captureComplete) return { outcome: 'execution-failed/incomplete-capture', reasons: ['Execution did not produce a complete 30-minute capture.'] };
  if (launch.code === 2 && measurementReasons.length === 0) {
    return { outcome: 'execution-failed/inconsistent-exit-code', reasons: ['Exit code 2 conflicts with otherwise-passing measurement evidence.'] };
  }
  return { outcome: measurementReasons.length ? 'completed/gate-rejected' : 'completed/gate-passed', reasons: [] };
}

export function describeGrowthRejection(name, trend) {
  const triggers = [];
  if (trend.allStepsPositive) triggers.push(`all ${trend.positiveSteps}/${trend.samples - 1} post-warmup steps increased`);
  if (trend.positiveSlopeHighRSquared) triggers.push(`positive OLS slope with R²=${trend.rSquared.toFixed(6)} >= ${trend.thresholds.linearGrowthRSquared}`);
  if (trend.exceedsFinalGrowthGuard) triggers.push(`final growth ${trend.finalGrowthPercent.toFixed(6)}% > ${trend.thresholds.maxFinalGrowthPercent}%`);
  if (trend.finalGrowthFraction === null) triggers.push('final growth fraction is unavailable');
  return `${name} blocked by ${triggers.join('; ')}.`;
}
