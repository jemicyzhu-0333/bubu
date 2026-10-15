'use strict';
// Test-only observation. The original gate, process arguments, result object,
// and error identity are preserved. No logging happens inside its wait budget.
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const NATIVE_STAGE = /^config-admission-acl:(streams|modules|input|identity|item|acl(?:-access-denied|-module-load|-command-not-found|-path-not-found|-parameter|-other)?|descriptor|aces|serialize)$/;
const CODES = new Set(['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS', 'EINVAL']);
const SIGNALS = new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT']);
const GATE_STAGES = new Set(['modules', 'paths', 'system-root', 'spawn', 'timeout', 'process-exit', 'stderr', 'stdout', 'json',
  'acl-access-denied', 'acl-module-load', 'acl-command-not-found', 'acl-path-not-found', 'acl-parameter', 'acl-other',
  'acl-shape', 'acl-count', 'acl-owner', 'acl-dacl', 'acl-reparse', 'acl-type', 'acl-ace', 'acl-grant',
  'streams', 'input', 'identity', 'item', 'acl', 'descriptor', 'aces', 'serialize', 'membership', 'file-type', 'mode', 'file-drift', 'filesystem']);
const milliseconds = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
const bytes = value => typeof value === 'string' ? Buffer.byteLength(value) : Buffer.isBuffer(value) ? value.length : null;
const errorCode = error => error ? CODES.has(error.code) ? error.code : 'other' : null;

function observeNativePermission(invoke, { run = spawnSync, now = () => performance.now() } = {}) {
  const entered = now(), native = [];
  let value, error, failed = false, exited;
  function observedRun(...args) {
    const start = now();
    let result, thrown, didReturn = false;
    try {
      result = run(...args);
      didReturn = true;
      return result;
    } catch (cause) {
      thrown = cause;
      throw cause;
    } finally {
      // Retain the raw result only until the existing gate settles. Do not parse,
      // stringify, call diagnostics, or copy stdout/stderr inside its budget.
      native.push({ start, end: now(), result, thrown, didReturn, timeoutMs: args[2]?.timeout });
    }
  }
  try { value = invoke(observedRun); }
  catch (cause) { failed = true; error = cause; }
  finally { exited = now(); }
  const report = {
    label: 'host-native-permission-boundary',
    outcome: failed ? 'rejected' : 'accepted',
    gateStage: GATE_STAGES.has(error?.diagnostic) ? error.diagnostic : failed ? 'other' : null,
    elapsedMs: milliseconds(exited - entered),
    nativeCalls: native.length,
    processes: native.map(sample => ({
      enterOffsetMs: milliseconds(sample.start - entered),
      returnOffsetMs: milliseconds(sample.end - entered),
      elapsedMs: milliseconds(sample.end - sample.start),
      timeoutMs: Number.isInteger(sample.timeoutMs) && sample.timeoutMs >= 0 ? sample.timeoutMs : null,
      didReturn: sample.didReturn,
      status: Number.isInteger(sample.result?.status) ? sample.result.status : null,
      signal: SIGNALS.has(sample.result?.signal) ? sample.result.signal : sample.result?.signal ? 'other' : null,
      errorCode: errorCode(sample.thrown || sample.result?.error),
      stage: typeof sample.result?.stderr === 'string' ? NATIVE_STAGE.exec(sample.result.stderr)?.[1] || null : null,
      stdoutBytes: bytes(sample.result?.stdout),
      stderrBytes: bytes(sample.result?.stderr)
    }))
  };
  return { failed, value, error, report };
}

module.exports = { observeNativePermission };
