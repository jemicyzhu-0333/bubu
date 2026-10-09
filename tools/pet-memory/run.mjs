import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseOptions } from './scenario.mjs';
import { initialReport, assessReport } from './report.mjs';
import { writeReport, hostMetadata, sourceIdentity } from './host-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = parseOptions(process.argv.slice(2));
const out = path.resolve(options.out || path.join(root, 'dist/pet-memory', new Date().toISOString().replaceAll(':', '-')));
if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error('Choose a fresh empty --out directory; existing evidence will not be overwritten.');
fs.mkdirSync(out, { recursive: true });
let report = initialReport(options);
writeReport(out, report);
const requestPath = path.join(out, 'request.json');
fs.writeFileSync(requestPath, JSON.stringify({ out, options }, null, 2));
let child;
try {
  report.environment = { ...hostMetadata(), ...sourceIdentity(root) }; writeReport(out, report);
  const electron = createRequire(import.meta.url)('electron');
  child = spawn(electron, [path.join(root, 'tools/pet-memory/electron-main.js'), `--request=${requestPath}`],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = fs.createWriteStream(path.join(out, 'stdout.log'));
  const stderr = fs.createWriteStream(path.join(out, 'stderr.log'));
  child.stdout.on('data', data => { stdout.write(data); process.stdout.write(data); });
  child.stderr.on('data', data => { stderr.write(data); process.stderr.write(data); });
  let killTimer, stopReason = null;
  const stop = reason => {
    if (stopReason) return;
    stopReason = reason; child.kill('SIGTERM');
    killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
  const timeout = setTimeout(() => stop('duration plus startup grace exceeded'), options.durationMs + 120_000);
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  }).finally(() => { clearTimeout(timeout); clearTimeout(killTimer); stdout.end(); stderr.end(); });
  report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  report.launch = { ...result, stopReason };
  if (stopReason) { report.status = 'interrupted'; report.errors.push(`Launcher stopped its child: ${stopReason}`); }
  if (!['completed', 'smoke-completed', 'failed', 'interrupted'].includes(report.status)) {
    report.status = 'launch-failed'; report.errors.push(`Electron did not finish: exit=${result.code}, signal=${result.signal}`);
  }
  report.gate = assessReport(report); writeReport(out, report);
  console.log(`${report.gate.verdict}; report: ${path.join(out, 'report.json')}`);
  process.exitCode = report.gate.verdict === 'PASSED' ? 0 : 2;
} catch (error) {
  child?.kill(); report.status = 'launch-failed'; report.errors.push(String(error?.stack || error));
  report.gate = assessReport(report); writeReport(out, report);
  console.error(`NOT PASSED: ${error.message}\nReport: ${path.join(out, 'report.json')}`); process.exitCode = 2;
}
