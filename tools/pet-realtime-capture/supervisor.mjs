import { spawn as spawnProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { LIMITS } from './options.mjs';

const validPID = pid => Number.isInteger(pid) && pid > 1;
const cleanError = error => sanitizeDiagnosticText(String(error?.message ?? error)).slice(0, 512);
export function sanitizeDiagnosticText(text) {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|(?:access[_-]?)?token|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s"']+)/gi, '$1[redacted]')
    .replace(/(\b[a-z][a-z\d+.-]{0,31}:\/\/)[^\s/:]+:[^\s@]+@/gi, '$1[redacted]@');
}
const utf8Prefix = (text, bytes) => new TextDecoder().decode(Buffer.from(text).subarray(0, bytes), { stream: true });

/** Owns only its spawned child/private group; callbacks receive final sanitized logs, never raw chunks. */
export async function runOwnedProcess(command, args, {
  cwd, env = {}, timeoutMs, signal, onStdout, onStderr,
  spawn = spawnProcess, platform = process.platform,
  killProcess = process.kill.bind(process), now = () => performance.now(),
  killGraceMs = 1_000, cleanupMs = 5_000,
} = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string'))
    throw new TypeError('A command and string argument array are required');
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('An explicit environment record is required');
  if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    throw new TypeError('A valid abort signal is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > LIMITS.preparationMs)
    throw new RangeError('A bounded positive process timeout is required');
  if (![killGraceMs, cleanupMs].every(value => Number.isFinite(value) && value >= 0) || cleanupMs <= killGraceMs || cleanupMs > 10_000)
    throw new RangeError('Cleanup requires a bounded escalation window of at most 10000ms');
  const startTimeMs = now(), chunks = { stdout: [], stderr: [] }, truncated = { stdout: false, stderr: false };
  const cleanup = { requested: false, confirmed: false, errors: [] };
  let captured = 0, child, ownedPID = null, settled = false, rootClosed = false, rootExited = false;
  let stopReason = null, code = null, exitSignal = null, startError = null;
  let processTimer, escalation, cleanupTimer, probeTimer, helperTimer, helper = null, helperClosed = true, groupGone = false;
  const error = cause => { if (cleanup.errors.length < 8) cleanup.errors.push(cleanError(cause)); };
  return new Promise(resolve => {
    function capture(stream, chunk) {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)), remaining = LIMITS.maxLogsBytes - captured;
      if (bytes.length > remaining) truncated[stream] = true;
      if (remaining > 0) { const kept = Buffer.from(bytes.subarray(0, remaining)); chunks[stream].push(kept); captured += kept.length; }
    }
    function finish() {
      if (settled) return;
      settled = true;
      for (const timer of [processTimer, escalation, cleanupTimer, probeTimer, helperTimer]) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child?.stdout?.removeListener('data', stdout); child?.stderr?.removeListener('data', stderr);
      if (!rootClosed) { child?.stdout?.destroy?.(); child?.stderr?.destroy?.(); }
      const output = {}; let remaining = LIMITS.maxLogsBytes;
      for (const stream of ['stdout', 'stderr']) {
        const clean = sanitizeDiagnosticText(Buffer.concat(chunks[stream]).toString('utf8'));
        output[stream] = utf8Prefix(clean, remaining);
        if (Buffer.byteLength(clean) > remaining) truncated[stream] = true;
        remaining -= Buffer.byteLength(output[stream]);
        try { (stream === 'stdout' ? onStdout : onStderr)?.(output[stream]); } catch (cause) { error(cause); }
      }
      const endTimeMs = now();
      resolve({ code, signal: exitSignal, startTimeMs, endTimeMs, elapsedMs: Math.max(0, endTimeMs - startTimeMs),
        stopReason, startError, ...output, stdoutTruncated: truncated.stdout, stderrTruncated: truncated.stderr,
        timeoutMs, cleanupMs, maximumElapsedMs: timeoutMs + cleanupMs,
        cleanup: { ...cleanup, rootReaped: rootClosed,
          descendantsEvidence: platform === 'win32' && !helper && validPID(ownedPID) && rootClosed
            ? 'normal-Windows-descendants-unverified' : cleanup.confirmed ? 'owned-group-or-taskkill-observed' : 'unconfirmed',
          errors: [...cleanup.errors] } });
    }
    function maybeFinish() {
      if (settled || !rootClosed) return;
      if (platform === 'win32' ? helperClosed : groupGone) {
        if (platform === 'win32' && !helper && validPID(ownedPID)) error('Windows descendants unverified after root exit; retain owned directories');
        cleanup.confirmed = cleanup.errors.length === 0;
        finish();
      }
    }
    function unixSignal(kind) {
      if (!validPID(ownedPID) || groupGone || settled) return;
      try { killProcess(-ownedPID, kind); }
      catch (cause) { if (cause?.code === 'ESRCH') groupGone = true; else error(cause); }
    }
    function probe() {
      clearTimeout(probeTimer); probeTimer = null;
      if (settled || platform === 'win32') return;
      unixSignal(0); maybeFinish();
      if (!settled && !groupGone) probeTimer = setTimeout(probe, 25);
    }
    function windowsKill() {
      // A PID can be reused after observed exit. Never launch taskkill then.
      if (!validPID(ownedPID) || rootExited || helper) return;
      try {
        helperClosed = false;
        helper = spawn('taskkill.exe', ['/PID', String(ownedPID), '/T', '/F'],
          { cwd, env, shell: false, windowsHide: true, stdio: 'ignore' });
        helperTimer = setTimeout(() => {
          if (helperClosed || settled) return;
          error('Owned taskkill helper timed out');
          try { helper.kill('SIGKILL'); } catch (cause) { error(cause); }
        }, Math.min(2_000, Math.max(1, cleanupMs - 1)));
        helper.on('error', cause => { if (!settled) error(cause); });
        helper.once('close', status => {
          if (settled) return;
          helperClosed = true; clearTimeout(helperTimer);
          if (status !== 0) error(`taskkill exited ${status}`);
          maybeFinish();
        });
      } catch (cause) { helperClosed = true; error(cause); }
    }
    function requestStop(reason) {
      if (settled || cleanup.requested) return;
      stopReason = reason; cleanup.requested = true; clearTimeout(processTimer);
      cleanupTimer = setTimeout(() => {
        if (!rootClosed) error('Owned child close was not confirmed after termination');
        if (!helperClosed) error('Owned taskkill helper close was not confirmed');
        if (platform !== 'win32' && !groupGone) error('Owned process group termination was not confirmed');
        cleanup.confirmed = false; finish();
      }, cleanupMs);
      if (!validPID(ownedPID)) { groupGone = true; maybeFinish(); return; }
      if (platform === 'win32') windowsKill();
      else {
        unixSignal('SIGTERM');
        escalation = setTimeout(() => { unixSignal('SIGKILL'); probe(); }, killGraceMs);
        probe();
      }
      maybeFinish();
    }
    function abort() { requestStop('aborted'); }
    function stdout(chunk) { capture('stdout', chunk); }
    function stderr(chunk) { capture('stderr', chunk); }
    if (signal?.aborted) { stopReason = 'aborted-before-start'; cleanup.confirmed = true; finish(); return; }
    try {
      child = spawn(command, args, { cwd, env, shell: false, detached: platform !== 'win32',
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      ownedPID = validPID(child.pid) ? child.pid : null;
      child.stdout?.on('data', stdout); child.stderr?.on('data', stderr);
      child.on('error', cause => {
        if (settled) return;
        startError = cleanError(cause);
        if (!validPID(ownedPID)) { stopReason = 'start-failed'; cleanup.confirmed = true; finish(); }
        else requestStop('process-error');
      });
      child.once('exit', (status, cause) => {
        if (settled) return;
        rootExited = true; code = status; exitSignal = cause;
        if (platform !== 'win32') requestStop(stopReason ?? 'exited');
      });
      child.once('close', (status, cause) => {
        if (settled) return;
        rootClosed = true; rootExited = true; code = status; exitSignal = cause;
        requestStop(stopReason ?? 'exited'); maybeFinish();
      });
      processTimer = setTimeout(() => requestStop('timeout'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    } catch (cause) {
      startError = cleanError(cause);
      if (validPID(ownedPID)) requestStop('process-error');
      else { stopReason = 'start-failed'; cleanup.confirmed = true; finish(); }
    }
  });
}
