'use strict';
// Diagnostic only: run after the native gate failed, never in place of that gate.
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
function probe(executable, args, input, env, remainingMs) {
  return new Promise(resolve => {
    const started = performance.now(); let stdout = '', stderr = '', errorCode = null, settled = false, stopping = false;
    const child = spawn(executable, args, { cwd: path.resolve(__dirname, '..'), env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    function stop(code) {
      if (stopping) return; stopping = true;
      errorCode = code;
      // Only this freshly spawned process and its descendants, never a name-based kill.
      if (child.pid && process.platform === 'win32') spawnSync(path.win32.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore', timeout: 1000 });
      child.kill('SIGKILL');
    }
    const timer = setTimeout(() => stop('ETIMEDOUT'), Math.min(CHILD_MS, remainingMs));
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 65536) { stdout = ''; stop('ENOBUFS'); } });
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
async function main() {
  if (process.platform !== 'win32') { console.log(JSON.stringify({ diagnostic: 'windows-only' })); return; }
  const root = process.env.SystemRoot;
  if (typeof root !== 'string' || !/^[A-Za-z]:\\[^\\]/.test(root) || path.win32.normalize(root) !== root) throw Error('system-root');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-acl-diagnostic-'));
  const started = performance.now();
  try {
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
module.exports = { summarize, probe, CHILD_MS, TOTAL_MS };
