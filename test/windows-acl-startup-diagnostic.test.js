'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, probe, CHILD_MS, TOTAL_MS } = require('../scripts/diagnose-windows-acl-startup.cjs');
test('ACL startup diagnostics contain only bounded fields, never native text', () => {
  const result = summarize({ elapsedMs: 12.4, status: null, signal: 'private-signal', errorCode: 'private-error',
    stdout: 'stage:input\nprivate-path-and-SID', stderr: 'private-account' });
  assert.deepEqual(result, { elapsedMs: 12, timeoutMs: 15000, status: null, signal: 'other', errorCode: 'other',
    stage: null, version: null, expectedOutput: false, stderrPresent: true });
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test('ACL startup diagnostics recognize only fixed stage and numeric version protocols', () => {
  assert.equal(summarize({ elapsedMs: 1, stdout: 'stage:timeout' }).stage, 'timeout');
  assert.equal(summarize({ elapsedMs: 1, stdout: 'version:5.1.26100.1234' }).version, '5.1.26100.1234');
  for (const stdout of ['version:5.1.2\nprivate', 'version:5.1.1234567', 'stage:input\n']) {
    const result = summarize({ elapsedMs: 1, stdout });
    assert.equal(result.version, null); assert.equal(result.stage, null); assert.equal(result.expectedOutput, false);
  }
  assert.equal(CHILD_MS, 15000); assert.equal(TOTAL_MS, 150000);
});
test('diagnostic child output is sanitized without hiding failure status', async () => {
  const result = await probe(process.execPath, ['-e', "process.stdout.write('PRIVATE');process.stderr.write('PRIVATE');process.exitCode=7"], '', process.env, CHILD_MS);
  assert.equal(result.status, 7); assert.equal(result.expectedOutput, false); assert.equal(result.stderrPresent, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
test('diagnostic child respects the remaining budget and is terminated', async () => {
  const result = await probe(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', process.env, 50);
  assert.equal(result.errorCode, 'ETIMEDOUT'); assert.notEqual(result.status, 0);
});

const fs = require('node:fs');
const path = require('node:path');
const { traceProgram, traceCollector, coldTrace, TRACE_SEQUENCE } = require('../scripts/diagnose-windows-acl-startup.cjs');
const { ACL_PROGRAM, PROBE_WAIT_BUDGET_MS } = require('../src/platform/persistence/sqlite/config-admission-permissions');
const prefix = 'BUBU_ACL_TRACE_V1';
const successfulProcess = { status: 0, signal: null, errorCode: null, stderrPresent: false, elapsedMs: 300 };
function traceLines(sequence = TRACE_SEQUENCE) {
  return [`${prefix}|entry`, ...sequence.map(([phase, index], n) => `${prefix}|${phase}|${index}|${n * 100}|1000|${(n + 1) * 500000}`)].join('\r\n') + '\r\n';
}
test('cold trace instruments a copy, preserves ACL reads, and suppresses private serialization output', () => {
  const original = ACL_PROGRAM, program = traceProgram(original);
  assert.equal(ACL_PROGRAM, original);
  assert.equal(PROBE_WAIT_BUDGET_MS, 15000);
  for (const line of original.split('\n').filter(line => /Import-Module|Get-Item|Get-Acl|RawSecurityDescriptor|ConvertTo-Json/.test(line))) {
    assert.ok(program.includes(line), `production read preserved: ${line.trim().split(' ')[0]}`);
  }
  assert.equal(program.match(/Import-Module -Name/g).length, 1);
  assert.equal(program.match(/Get-Acl -LiteralPath/g).length, 1);
  assert.ok(program.indexOf(`${prefix}|entry`) < program.indexOf('Import-Module'));
  assert.ok(program.includes('$traceProcess.TotalProcessorTime.Ticks'));
  assert.ok(program.includes('[System.Diagnostics.Stopwatch]::Frequency'));
  assert.doesNotMatch(program, /\$writer\.Write\(\$json\)|Set-Acl|ExecutionPolicy|Start-Process|Add-Type|Get-Process|Start-Sleep/i);
  assert.ok(program.includes("Write-AclTrace 'input-read' -1"));
  assert.ok(program.includes("Write-AclTrace 'input-json' -1"));
  assert.ok(program.includes("Write-AclTrace 'input-validate' -1"));
  for (const changed of [original.replace("$stage = 'modules'", "$stage = 'changed'"), original + '\n  $writer.Write($json)']) {
    assert.throws(() => traceProgram(changed), /trace-source-drift/);
  }
});
test('cold trace accepts chunked fixed markers and computes child phase wall and CPU deltas', () => {
  const trace = traceCollector(), text = traceLines(); trace.spawn(2);
  for (let i = 0; i < text.length; i += 7) trace.stdout(text.slice(i, i + 7), 50 + i / 10);
  const report = trace.finish(successfulProcess);
  assert.equal(report.complete, true); assert.equal(report.invalidProtocol, false);
  assert.equal(report.admissionEvidence, false); assert.equal(report.timeoutMs, 15000);
  assert.equal(report.samples.length, TRACE_SEQUENCE.length);
  assert.equal(report.samples[3].phase, 'import-utility');
  assert.equal(report.samples[3].phaseWallMs, 100); assert.equal(report.samples[3].phaseCpuMs, 50);
  assert.equal(report.samples.at(-1).phaseWallMs, null); assert.equal(report.unfinished, null);
});
test('cold trace rejects unknown, reordered, missing, duplicate, unbounded and private text', () => {
  const bad = [
    `${prefix}|entry\nPRIVATE-PATH S-1-5-21-123\n`,
    `${prefix}|entry\n${prefix}|complete|-1|0|1000|100\n`,
    `${prefix}|entry\n${prefix}|ready|-1|0|0|100\n`,
    `${prefix}|entry\n${prefix}|ready|-1|999999999999999|1|100\n`,
    traceLines(TRACE_SEQUENCE.slice(1)), traceLines() + `${prefix}|entry\n`,
    traceLines().replace('|ready|-1|0|1000|500000', '|ready|-1|0|1000|99999999999'),
    'PRIVATE'.repeat(1000), traceLines().trimEnd()
  ];
  for (const text of bad) {
    const trace = traceCollector(); trace.stdout(text, 20);
    const report = trace.finish(successfulProcess);
    assert.equal(report.complete, false); assert.equal(report.invalidProtocol, true);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE|S-1-5-21-123/);
  }
});
test('cold trace does not turn a timed-out stage or late successful output into acceptance', () => {
  const trace = traceCollector(); trace.spawn(2);
  trace.stdout(traceLines(TRACE_SEQUENCE.slice(0, 4)), 200); trace.stopping(15001);
  const report = trace.finish({ ...successfulProcess, status: null, signal: 'SIGKILL', errorCode: 'ETIMEDOUT', elapsedMs: 15100 });
  assert.equal(report.complete, false); assert.equal(report.invalidProtocol, false);
  assert.deepEqual(report.unfinished, { phase: 'import-utility', index: -1, parentWallSinceLastMarkerMs: 14801, cpuMs: null });
  assert.equal(report.samples.at(-1).phaseCpuMs, null);
  const late = traceCollector(); late.stdout(traceLines(), 15001);
  assert.equal(late.finish({ ...successfulProcess, errorCode: 'ETIMEDOUT' }).complete, false);
  assert.equal(late.finish({ ...successfulProcess, elapsedMs: 15000 }).complete, false);
});
test('cold trace reports no entry or timing initialization separately without inventing CPU', () => {
  for (const [text, phase] of [['', 'process-startup'], [`${prefix}|entry\n`, 'trace-initialization']]) {
    const trace = traceCollector(); trace.stdout(text, 10);
    const report = trace.finish({ ...successfulProcess, status: null, errorCode: 'ETIMEDOUT', elapsedMs: 15001 });
    assert.equal(report.unfinished.phase, phase); assert.equal(report.unfinished.cpuMs, null);
  }
});
test('cold trace stream observer keeps partial stage markers when its single child times out', async () => {
  const trace = traceCollector();
  const text = traceLines(TRACE_SEQUENCE.slice(0, 4));
  const result = await probe(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(text)});setInterval(()=>{},1000)`], '', process.env, 250, trace);
  const report = trace.finish(result);
  assert.equal(report.errorCode, 'ETIMEDOUT'); assert.equal(report.complete, false);
  assert.equal(report.unfinished.phase, 'import-utility'); assert.ok(report.stopAtMs >= 200);
});
test('manual cold mode uses a separate job and no prior PowerShell, dependency install or production gate', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/diagnose-windows-startup.yml'), 'utf8');
  assert.match(workflow, /default: released-first-launch/);
  assert.match(workflow, /if: \$\{\{ inputs\.mode != 'cold-stage-trace' \}\}/);
  const cold = workflow.slice(workflow.indexOf('\n  cold-stage-trace:'));
  assert.match(cold, /runs-on: windows-latest/); assert.match(cold, /shell: cmd/);
  assert.match(cold, /node scripts\/diagnose-windows-acl-startup\.cjs --cold-stage-trace/);
  assert.equal((cold.match(/\brun:/g) || []).length, 1);
  assert.match(cold, /actions\/setup-node@v4\s+with:\s+node-version: '22'/);
  assert.ok(cold.indexOf('actions/setup-node') < cold.indexOf('shell: cmd'));
  assert.doesNotMatch(cold, /npm (ci|test|run)|shell: (pwsh|powershell)|continue-on-error|secrets\./);
});

test('cold mode invokes one target process with a synthetic two-path stdin and no warm-up', async t => {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cold-trace-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0, output = '';
  const env = { SystemRoot: 'C:\\Windows' };
  const report = await coldTrace('fixed-powershell-target', env, directory, {
    async run(executable, args, input, childEnv, timeout, observer) {
      calls++;
      assert.equal(executable, 'fixed-powershell-target'); assert.equal(childEnv, env);
      assert.equal(timeout, 15000);
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(args.length, 5); assert.doesNotMatch(args[4], /cold-trace-test-/);
      const paths = JSON.parse(input);
      assert.equal(paths.length, 2); assert.equal(paths[0], directory);
      assert.equal(path.dirname(paths[1]), directory); assert.equal(fs.readFileSync(paths[1], 'utf8'), 'synthetic');
      observer.spawn(1); observer.stdout(traceLines(), 20);
      return successfulProcess;
    },
    write(text) { output = text; }
  });
  assert.equal(calls, 1); assert.equal(report.complete, true);
  assert.equal(report.transport, 'spawn-streaming'); assert.equal(report.productionTransport, 'spawnSync');
  assert.equal(report.nodeVersion, process.version);
  assert.doesNotMatch(output, /cold-trace-test-|synthetic\.sqlite|S-1-/);
});
