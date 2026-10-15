'use strict';
// Diagnostic only, never an admission gate. Default mode runs after gate failure.
// --cold-stage-trace is a single instrumented observation on a separate fresh job.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const CHILD_MS = 15000, TOTAL_MS = 150000;
const PS_FLAGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'];
const INPUT_PROGRAM = `$ErrorActionPreference='Stop'; $r=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false,$true),$false); [void](ConvertFrom-Json -InputObject ($r.ReadToEnd())); [Console]::Out.Write('ready')`;
const ACL_PROGRAM = `const fs=require('node:fs');const {verifyWindowsProbePermissions}=require('./src/platform/persistence/sqlite/config-admission-permissions');try{verifyWindowsProbePermissions(JSON.parse(fs.readFileSync(0,'utf8')),[]);process.stdout.write('ready')}catch(e){process.stdout.write('stage:'+e.diagnostic);process.exitCode=1}`;
const STAGES = new Set(['modules', 'paths', 'system-root', 'spawn', 'timeout', 'process-exit', 'stderr', 'stdout', 'json', 'streams', 'input', 'identity', 'item', 'acl', 'descriptor', 'aces', 'serialize', 'acl-access-denied', 'acl-module-load', 'acl-command-not-found', 'acl-path-not-found', 'acl-parameter', 'acl-other', 'acl-shape', 'acl-count', 'acl-owner', 'acl-dacl', 'acl-reparse', 'acl-type', 'acl-ace', 'acl-grant']);
function summarize(result) {
  const stage = result.stdout?.startsWith('stage:') ? result.stdout.slice(6) : null;
  const version = /^version:(\d{1,3}\.\d{1,3}\.\d{1,6}(?:\.\d{1,6})?)$/.exec(result.stdout || '')?.[1] || null;
  return { elapsedMs: Math.max(0, Math.round(result.elapsedMs)), timeoutMs: CHILD_MS,
    status: Number.isInteger(result.status) ? result.status : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(result.signal) ? result.signal : result.signal ? 'other' : null,
    errorCode: ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS', 'EINVAL'].includes(result.errorCode) ? result.errorCode : result.errorCode ? 'other' : null,
    stage: STAGES.has(stage) ? stage : null, version,
    expectedOutput: result.stdout === 'ready' || version !== null,
    stderrPresent: Boolean(result.stderr) };
}
function probe(executable, args, input, env, remainingMs, observer = {}) {
  return new Promise(resolve => {
    const started = performance.now(); let stdout = '', stderr = '', errorCode = null, settled = false, stopping = false;
    const child = spawn(executable, args, { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    function stop(code) {
      if (stopping) return; stopping = true;
      errorCode = code;
      observer.stopping?.(performance.now() - started);
      // Only this freshly spawned process and its descendants, never a name-based kill.
      if (child.pid && process.platform === 'win32') spawnSync(path.win32.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', timeout: 1000 });
      child.kill('SIGKILL');
    }
    const timer = setTimeout(() => stop('ETIMEDOUT'), Math.min(CHILD_MS, remainingMs));
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 65536) { stdout = ''; stop('ENOBUFS'); }
      else observer.stdout?.(String(chunk), performance.now() - started);
    });
    child.on('spawn', () => observer.spawn?.(performance.now() - started));
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 65536) { stderr = 'present'; stop('ENOBUFS'); } });
    child.stdin.on('error', () => {});
    child.on('error', error => { errorCode = error.code || 'other'; });
    child.on('close', (status, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve(summarize({ status, signal, errorCode, stdout, stderr, elapsedMs: performance.now() - started }));
    });
    child.stdin.end(input);
  });
}
// Use the exact production program as a read-only in-memory template. Unique
// anchors reject source drift; no production export, parameter or file is edited.
const TRACE_PREFIX = 'BUBU_ACL_TRACE_V1';
const TRACE_SEQUENCE = [
  'ready', 'streams', 'modules', 'import-utility', 'imported-utility',
  'import-management', 'imported-management', 'import-security', 'imported-security',
  'input', 'input-read', 'input-json', 'input-validate', 'identity'
].map(phase => [phase, -1]).concat(
  [0, 1].flatMap(index => ['item', 'acl', 'descriptor', 'aces'].map(phase => [phase, index])),
  [['serialize', -1], ['complete', -1]]
);
function traceProgram(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw Error('trace-source-drift');
    source = source.replace(before, after);
  };
  for (const stage of ['streams', 'modules', 'input', 'identity', 'item', 'acl', 'descriptor', 'aces', 'serialize']) {
    const line = `$stage = '${stage}'`;
    const index = ['item', 'acl', 'descriptor', 'aces'].includes(stage) ? '$entries.Count' : '-1';
    replace(line, `${line}; Write-AclTrace '${stage}' ${index}`);
  }
  const importLine = "    Import-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules', $m, ($m + '.psd1'))) -ErrorAction Stop";
  replace(importLine, `    $traceModule = @{'Microsoft.PowerShell.Utility'='utility'; 'Microsoft.PowerShell.Management'='management'; 'Microsoft.PowerShell.Security'='security'}[$m]
    Write-AclTrace ('import-' + $traceModule) -1
${importLine}
    Write-AclTrace ('imported-' + $traceModule) -1`);
  replace('  $paths = ConvertFrom-Json -InputObject ($reader.ReadToEnd())', `  Write-AclTrace 'input-read' -1
  $traceInput = $reader.ReadToEnd()
  Write-AclTrace 'input-json' -1
  $paths = ConvertFrom-Json -InputObject $traceInput
  Write-AclTrace 'input-validate' -1`);
  // Keep serialization cost but never emit its path/SID/ACL payload.
  replace('  $writer.Write($json)', "  Write-AclTrace 'complete' -1");
  return `[Console]::Out.WriteLine('${TRACE_PREFIX}|entry'); [Console]::Out.Flush()
$traceClock = [System.Diagnostics.Stopwatch]::StartNew()
$traceProcess = [System.Diagnostics.Process]::GetCurrentProcess()
function Write-AclTrace([string]$phase, [int]$index) {
  $traceProcess.Refresh()
  $wall = $traceClock.ElapsedTicks
  $cpu = $traceProcess.TotalProcessorTime.Ticks
  [Console]::Out.WriteLine('${TRACE_PREFIX}|' + $phase + '|' + $index + '|' + $wall + '|' + [System.Diagnostics.Stopwatch]::Frequency + '|' + $cpu)
  [Console]::Out.Flush()
}
Write-AclTrace 'ready' -1
${source}`;
}
function traceCollector() {
  let pending = '', invalid = false, entryAtMs = null, spawnAtMs = null, stopAtMs = null;
  const samples = [];
  const milliseconds = value => Math.round(value * 1000) / 1000;
  function line(value, receivedAtMs) {
    if (value === `${TRACE_PREFIX}|entry` && entryAtMs === null && samples.length === 0) { entryAtMs = receivedAtMs; return; }
    const match = /^BUBU_ACL_TRACE_V1\|([a-z-]+)\|(-1|0|1)\|(\d{1,15})\|(\d{1,12})\|(\d{1,15})$/.exec(value);
    const expected = TRACE_SEQUENCE[samples.length];
    if (!match || entryAtMs === null || !expected || match[1] !== expected[0] || Number(match[2]) !== expected[1]) { invalid = true; return; }
    const [, phase, index, wall, frequency, cpu] = match;
    const wallMs = Number(wall) * 1000 / Number(frequency), cpuMs = Number(cpu) / 10000;
    const previous = samples.at(-1);
    if (Number(frequency) <= 0 || wallMs > TOTAL_MS || cpuMs > TOTAL_MS * 256
      || (previous && (wallMs < previous.wallMs || cpuMs < previous.cpuMs))
      || !Number.isFinite(receivedAtMs) || receivedAtMs < 0) { invalid = true; return; }
    samples.push({ phase, index: Number(index), receivedAtMs: milliseconds(receivedAtMs), wallMs, cpuMs });
  }
  return {
    spawn(elapsedMs) { spawnAtMs = milliseconds(elapsedMs); },
    stopping(elapsedMs) { stopAtMs = milliseconds(elapsedMs); },
    stdout(chunk, elapsedMs) {
      pending += chunk;
      if (pending.length > 4096) { pending = ''; invalid = true; return; }
      const lines = pending.split('\n'); pending = lines.pop();
      for (const value of lines) line(value.replace(/\r$/, ''), elapsedMs);
    },
    finish(result) {
      if (pending) invalid = true;
      const last = samples.at(-1);
      const complete = !invalid && last?.phase === 'complete' && result.elapsedMs < CHILD_MS
        && result.status === 0 && !result.signal && !result.errorCode && !result.stderrPresent;
      return { diagnostic: 'windows-acl-cold-stage-trace', admissionEvidence: false,
        scope: 'first-targeted-windows-powershell-in-job', timeoutMs: CHILD_MS,
        spawnAtMs, stopAtMs, scriptEntryAtMs: entryAtMs === null ? null : milliseconds(entryAtMs),
        complete, invalidProtocol: invalid, elapsedMs: result.elapsedMs,
        status: result.status, signal: result.signal, errorCode: result.errorCode, stderrPresent: result.stderrPresent,
        // Parent receive times include transport/scheduling; child wall/CPU are
        // cumulative snapshots. CPU includes process startup, wall starts in script.
        samples: samples.map((sample, index) => ({ ...sample, wallMs: milliseconds(sample.wallMs), cpuMs: milliseconds(sample.cpuMs),
          phaseWallMs: samples[index + 1] ? milliseconds(samples[index + 1].wallMs - sample.wallMs) : null,
          phaseCpuMs: samples[index + 1] ? milliseconds(samples[index + 1].cpuMs - sample.cpuMs) : null })),
        unfinished: complete ? null : { phase: last?.phase || (entryAtMs === null ? 'process-startup' : 'trace-initialization'),
          index: last?.index ?? -1, parentWallSinceLastMarkerMs: milliseconds(Math.max(0, (stopAtMs ?? result.elapsedMs) - (last?.receivedAtMs ?? entryAtMs ?? 0))),
          cpuMs: null } };
    }
  };
}
async function coldTrace(executable, env, directory, { run = probe, write = console.log } = {}) {
  const { ACL_PROGRAM: productionProgram } = require('../src/platform/persistence/sqlite/config-admission-permissions');
  const program = traceProgram(productionProgram);
  const file = path.join(directory, '探针 & $quote; [data].sqlite');
  fs.writeFileSync(file, 'synthetic', { mode: 0o600 });
  const trace = traceCollector();
  const result = await run(executable, [...PS_FLAGS, program], JSON.stringify([directory, file]), env, CHILD_MS, trace);
  const report = { ...trace.finish(result), nodeVersion: process.version, transport: 'spawn-streaming', productionTransport: 'spawnSync' };
  write(JSON.stringify(report));
  return report;
}
async function main() {
  if (process.platform !== 'win32') { console.log(JSON.stringify({ diagnostic: 'windows-only' })); return; }
  if (process.argv.length > 2 && (process.argv.length !== 3 || process.argv[2] !== '--cold-stage-trace')) throw Error('arguments');
  const root = process.env.SystemRoot;
  if (typeof root !== 'string' || !/^[A-Za-z]:\\[^\\]/.test(root) || path.win32.normalize(root) !== root) throw Error('system-root');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-acl-diagnostic-'));
  const started = performance.now();
  try {
    if (process.argv[2] === '--cold-stage-trace') {
      if (!(await coldTrace(executable, env, directory)).complete) process.exitCode = 1;
      return;
    }
    const cases = [
      ['node-startup', process.execPath, ['-e', "process.stdout.write('ready')"], ''],
      ['powershell-startup', executable, [...PS_FLAGS, "[Console]::Out.Write('version:'+$PSVersionTable.PSVersion.ToString())"], ''],
      ['powershell-input-json', executable, [...PS_FLAGS, INPUT_PROGRAM], '[]'],
      ['production-acl', process.execPath, ['-e', ACL_PROGRAM], JSON.stringify(directory)]
    ];
    for (let round = 1; round <= 2; round++) for (const [label, file, args, input] of cases) {
      const remaining = TOTAL_MS - (performance.now() - started);
      if (remaining <= 0) { console.log(JSON.stringify({ diagnostic: 'total-budget-exhausted' })); return; }
      const result = await probe(file, args, input, env, remaining);
      console.log(JSON.stringify({ round, label, ...result }));
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(() => { console.log(JSON.stringify({ diagnostic: 'runner-failure' })); process.exitCode = 1; });
module.exports = { summarize, probe, CHILD_MS, TOTAL_MS, traceProgram, traceCollector, coldTrace, TRACE_SEQUENCE };
